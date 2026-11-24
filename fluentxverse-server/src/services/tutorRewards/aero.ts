import { encodePacked, keccak256, parseAbi, type Hex } from 'viem';
import manifest from '../../../../shared/tutorRewardsAero.json';
import compiled from '../../../../shared/tutorRewardsAeroArtifact.json';
import { pin, rewardsGateway, matchesContractRuntime, type RewardsGateway } from './gateway';
import { alchemyRewardPrices, type AlchemyRewardPrices } from './alchemy';
import { rewardAddress, RewardError, usdMicros } from './policy';

export interface AeroRewardAsset { token: string; feed: string; tokens: string[]; tickSpacings: number[] }
export interface AeroRewardManifest {
  chainId: number; network: string; factory: string; router: string; quoter: string;
  adapter: string | null; assets: AeroRewardAsset[];
}
export const aeroAdapterAbi = parseAbi(['function rewards() view returns(address)', 'function settlementToken() view returns(address)',
  'function factory() view returns(address)', 'function router() view returns(address)', 'function paused() view returns(bool)', 'function paths(address) view returns(bytes)']);
export const alchemyFeedAbi = parseAbi(['function token() view returns(address)', 'function publisher() view returns(address)',
  'function maxObservationAge() view returns(uint32)', 'function decimals() view returns(uint8)', 'function paused() view returns(bool)',
  'function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)',
  'function publish(uint192 value,uint64 timestamp,bytes32 digest)']);
export const aeroFactoryAbi = parseAbi(['function getPool(address,address,int24) view returns(address)']);
export const aeroQuoterAbi = parseAbi(['function quoteExactInput(address[] pools,address tokenIn,uint256 amountIn) returns(uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList)']);

export function aeroPath(asset: AeroRewardAsset) {
  const tokens = asset.tokens.map(rewardAddress);
  if (tokens.length < 2 || tokens.length > 4 || new Set(tokens).size !== tokens.length || tokens[0] !== pin.settlementToken
    || tokens.at(-1) !== rewardAddress(asset.token) || asset.tickSpacings.length !== tokens.length - 1
    || asset.tickSpacings.some(s => !Number.isInteger(s) || s < 1 || s > 32767)) throw new RewardError(503, 'Invalid approved Aero route.');
  const types: any[] = ['address'], args: any[] = [tokens[0]];
  for (let i = 0; i < asset.tickSpacings.length; i++) { types.push('int24', 'address'); args.push(asset.tickSpacings[i], tokens[i + 1]); }
  return encodePacked(types, args);
}

export class AeroTutorRewards {
  constructor(readonly config: AeroRewardManifest = manifest, readonly gateway: RewardsGateway = rewardsGateway,
    readonly prices: AlchemyRewardPrices = alchemyRewardPrices, readonly now = () => Date.now()) {}
  asset(token: string) {
    const address = rewardAddress(token);
    const matches = this.config.assets.filter(a => rewardAddress(a.token) === address);
    if (!this.config.adapter || this.config.chainId !== pin.chainId || this.config.network !== 'robinhood-mainnet' || matches.length !== 1) {
      throw new RewardError(409, 'This Aero reward asset has not been deployed and approved.');
    }
    const asset = matches[0]!;
    rewardAddress(asset.feed); aeroPath(asset);
    return asset;
  }
  async bindings(asset: AeroRewardAsset, active = true) {
    await this.gateway.chain();
    const c = this.gateway.client, adapter = rewardAddress(this.config.adapter), read = (address: Hex, abi: any, functionName: string, args: any[] = []) => c.readContract({ address, abi, functionName, args });
    if (!matchesContractRuntime(await c.getCode({ address: adapter }), compiled.adapter)
      || !matchesContractRuntime(await c.getCode({ address: rewardAddress(asset.feed) }), compiled.feed)) {
      throw new RewardError(503, 'Aero adapter or feed runtime differs from the approved implementation.');
    }
    for (const [fn, value] of Object.entries({ rewards: pin.contract, settlementToken: pin.settlementToken, factory: this.config.factory, router: this.config.router })) {
      if (String(await read(adapter, aeroAdapterAbi, fn)).toLowerCase() !== rewardAddress(value)) throw new RewardError(503, 'Aero adapter binding does not match.');
    }
    const feed = rewardAddress(asset.feed);
    if (String(await read(feed, alchemyFeedAbi, 'token')).toLowerCase() !== rewardAddress(asset.token)
      || String(await read(feed, alchemyFeedAbi, 'publisher')).toLowerCase() !== pin.operator
      || Number(await read(feed, alchemyFeedAbi, 'decimals')) !== 18) throw new RewardError(503, 'Alchemy reward feed binding does not match.');
    const maxAge = Number(await read(feed, alchemyFeedAbi, 'maxObservationAge'));
    if (!Number.isInteger(maxAge) || maxAge < 1 || maxAge > 3600) throw new RewardError(503, 'Invalid feed observation age.');
    const path = aeroPath(asset);
    if (active && (await read(adapter, aeroAdapterAbi, 'paused') || await read(feed, alchemyFeedAbi, 'paused')
      || String(await read(adapter, aeroAdapterAbi, 'paths', [rewardAddress(asset.token)])).toLowerCase() !== path)) {
      throw new RewardError(409, 'The approved Aero route or price feed is paused or not configured.');
    }
    return { path, maxAge };
  }
  async publication(token: string) {
    const asset = this.asset(token), { maxAge } = await this.bindings(asset, false);
    const [observation] = await this.prices.get([asset.token], maxAge);
    return { feed: rewardAddress(asset.feed), observation: observation!, args: [observation!.price.toString(), observation!.observedAt, observation!.observationHash] };
  }
  async quote(token: string, amountUsd: string) {
    const asset = this.asset(token), amount = usdMicros(amountUsd), { path, maxAge } = await this.bindings(asset);
    const status = await this.gateway.status();
    if (!status.deployed || !status.finalized) throw new RewardError(409, 'Rewards deployment is not finalized.');
    const a = await this.gateway.read('rewardAssets', [rewardAddress(token)]);
    if (!a[7] || String(a[0]).toLowerCase() !== rewardAddress(this.config.adapter) || String(a[1]).toLowerCase() !== rewardAddress(asset.feed)) {
      throw new RewardError(409, 'The rewards contract has not enabled this approved Aero asset.');
    }
    const slippage = Number(a[3]), decimals = Number(a[4]);
    if (!Number.isInteger(slippage) || slippage < 0 || slippage > 1000 || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new RewardError(503, 'Invalid reward asset settings.');
    const [observation] = await this.prices.get([token], Math.min(maxAge, Number(a[2])));
    const pools: Hex[] = [];
    for (let i = 0; i < asset.tickSpacings.length; i++) {
      const pool = rewardAddress(await this.gateway.client.readContract({ address: rewardAddress(this.config.factory), abi: aeroFactoryAbi,
        functionName: 'getPool', args: [rewardAddress(asset.tokens[i]), rewardAddress(asset.tokens[i + 1]), asset.tickSpacings[i]] }));
      const code = await this.gateway.client.getCode({ address: pool });
      if (!code || code === '0x' || await this.gateway.client.readContract({ address: pool,
        abi: parseAbi(['function liquidity() view returns(uint128)']), functionName: 'liquidity' }) === 0n) throw new RewardError(409, 'The approved Aero pool has no active liquidity.');
      pools.push(pool);
    }
    const { result } = await this.gateway.client.simulateContract({ address: rewardAddress(this.config.quoter), abi: aeroQuoterAbi,
      functionName: 'quoteExactInput', args: [pools, rewardAddress(pin.settlementToken), amount] });
    const expected = BigInt(result[0]);
    const freshOracleMin = amount * 10n ** BigInt(decimals + 18) / (observation!.price * 1_000_000n) * BigInt(10000 - slippage) / 10000n;
    const chainOracleMin = BigInt(await this.gateway.read('oracleMinimumOut', [rewardAddress(token), amount]));
    const executionMin = expected * BigInt(10000 - slippage) / 10000n;
    const minimum = [freshOracleMin, chainOracleMin, executionMin].reduce((a, b) => a > b ? a : b);
    if (minimum <= 0n || expected < minimum) throw new RewardError(409, 'Aero cannot fill this reward within the approved price limits.');
    const block = await this.gateway.client.getBlock({ blockTag: 'latest' });
    const quotedAt = Number(block.timestamp);
    if (!Number.isSafeInteger(quotedAt) || Math.abs(this.now() / 1000 - quotedAt) > 30) throw new RewardError(503, 'Reward chain clock is unavailable.');
    const feedRound = await this.gateway.client.readContract({ address: rewardAddress(asset.feed), abi: alchemyFeedAbi, functionName: 'latestRoundData' });
    const feedTimestamp = Number(feedRound[3]);
    if (!Number.isSafeInteger(feedTimestamp) || feedTimestamp <= 0 || feedTimestamp > quotedAt) throw new RewardError(503, 'Reward feed timestamp is invalid.');
    const lifetime = Math.min(120, status.maxQuoteAgeSeconds, maxAge - (quotedAt - observation!.observedAt),
      Math.min(maxAge, Number(a[2])) - (quotedAt - feedTimestamp));
    if (lifetime < 15) throw new RewardError(409, 'A newer reward price is required before quoting.');
    return { chainId: pin.chainId, contract: pin.contract, token: rewardAddress(token), amountUsd: amount.toString(),
      expectedAmountOut: expected.toString(), minAmountOut: minimum.toString(), quotedAt, deadline: quotedAt + lifetime,
      assetVersion: String(a[6]), executionEpoch: String(await this.gateway.read('executionEpoch')),
      data: path, dataHash: keccak256(path), pools, referencePrice: observation!.value, referenceObservedAt: observation!.observedAt,
      claimsPaused: status.claimsPaused };
  }
}
export const aeroTutorRewards = new AeroTutorRewards();
