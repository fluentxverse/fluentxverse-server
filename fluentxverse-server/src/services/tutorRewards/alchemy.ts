import { keccak256, stringToHex } from 'viem';
import { rewardAddress, RewardError } from './policy';

export interface AlchemyRewardPrice {
  token: `0x${string}`; value: string; price: bigint; observedAt: number; observationHash: `0x${string}`;
}
export function rewardPrice18(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,39})(\.[0-9]{1,40})?$/.test(value)) {
    throw new RewardError(503, 'Invalid reward price.');
  }
  const [whole, fraction = ''] = value.split('.');
  const price = BigInt(whole!) * 10n ** 18n + BigInt(fraction.slice(0, 18).padEnd(18, '0'));
  if (price === 0n || price >= 2n ** 192n) throw new RewardError(503, 'Reward price is out of range.');
  return price;
}

export class AlchemyRewardPrices {
  constructor(readonly fetcher: typeof fetch = fetch, readonly now = () => Date.now()) {}
  configured() { return !!process.env.TUTOR_REWARDS_ALCHEMY_API_KEY; }
  async get(addresses: string[], maxAgeSeconds = 300): Promise<AlchemyRewardPrice[]> {
    const tokens = [...new Set(addresses.map(rewardAddress))];
    if (!tokens.length || tokens.length > 25 || !Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 3600) {
      throw new RewardError(400, 'Invalid reward price request.');
    }
    const key = process.env.TUTOR_REWARDS_ALCHEMY_API_KEY;
    if (!key) throw new RewardError(503, 'Alchemy reward pricing is not configured.');
    let payload: any;
    try {
      const response = await this.fetcher('https://api.g.alchemy.com/prices/v1/tokens/by-address', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ addresses: tokens.map(address => ({ network: 'robinhood-mainnet', address })) }),
        signal: AbortSignal.timeout(15_000), redirect: 'error',
      });
      if (!response.ok) throw Error();
      const text = await response.text();
      if (text.length > 256_000) throw Error();
      payload = JSON.parse(text);
    } catch { throw new RewardError(503, 'Alchemy reward prices are unavailable. No substitute price was used.'); }
    if (!Array.isArray(payload.data)) throw new RewardError(503, 'Alchemy returned an invalid price response.');
    return tokens.map(token => {
      const entries = payload.data.filter((r: any) => r?.network === 'robinhood-mainnet' && typeof r.address === 'string' && r.address.toLowerCase() === token);
      const entry = entries[0];
      const prices = Array.isArray(entry?.prices) ? entry.prices.filter((p: any) => typeof p?.currency === 'string' && p.currency.toLowerCase() === 'usd') : [];
      if (entries.length !== 1 || entry.error || prices.length !== 1) throw new RewardError(503, 'Alchemy has no unambiguous USD price for this reward token.');
      const p = prices[0], price = rewardPrice18(p.value);
      if (typeof p.lastUpdatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(p.lastUpdatedAt)) throw new RewardError(503, 'Reward price has no valid source timestamp.');
      const time = Date.parse(p.lastUpdatedAt), now = this.now();
      if (!Number.isFinite(time) || time > now || now - time > maxAgeSeconds * 1000 || time <= 0) throw new RewardError(503, 'Reward price is stale or future-dated.');
      const observedAt = Math.floor(time / 1000);
      return { token, value: p.value, price, observedAt, observationHash: keccak256(stringToHex(JSON.stringify({
        provider: 'alchemy', network: 'robinhood-mainnet', token, currency: 'USD', value: p.value, updatedAt: p.lastUpdatedAt,
      }))) };
    });
  }
}
export const alchemyRewardPrices = new AlchemyRewardPrices();
