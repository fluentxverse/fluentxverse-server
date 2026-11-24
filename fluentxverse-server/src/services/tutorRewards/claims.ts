import { randomUUID } from 'node:crypto';
import { hashTypedData, recoverTypedDataAddress } from 'viem';
import { getDriver } from '../../db/memgraph';
import { pin, rewardsGateway as gateway } from './gateway';
import { aeroTutorRewards as aero } from './aero';
import { RewardError, rewardAddress, rewardMonth, usdMicros } from './policy';
import { tutorRewardClaimTypes } from '../../../../shared/tutorRewardClaim';

const active = ['authorizing', 'prepared', 'queued', 'submitted', 'confirming'];
async function records(cypher: string, params: Record<string, any> = {}) {
  const s = getDriver().session(); try { return (await s.run(cypher, params)).records; } finally { await s.close(); }
}
let ready: Promise<void> | undefined;
async function schema() {
  return ready ||= (async () => {
    for (const [label, property] of [['TutorRewardClaim', 'id'], ['TutorRewardClaimLock', 'tutorId']]) {
      const exists = async () => (await records('SHOW CONSTRAINT INFO')).some(r => r.get('constraint type') === 'unique' && r.get('label') === label && r.get('properties').join(',') === property);
      if (await exists()) continue;
      try { await records(`CREATE CONSTRAINT ON (n:${label}) ASSERT n.${property} IS UNIQUE`); } catch { if (!await exists()) throw new RewardError(503, 'Reward claim accounting is unavailable.'); }
    }
  })().catch(e => { ready = undefined; throw e; });
}
function publicClaim(p: any) {
  return { id: p.id, token: p.token, symbol: p.symbol, amountUsd: p.amountUsd, minAmountOut: p.minAmountOut,
    expectedAmountOut: p.expectedAmountOut, deadline: p.deadline, status: p.status, createdAt: p.createdAt,
    transactionHash: p.transactionHash || null };
}
async function identity(tutorId: string) {
  const r = (await records('MATCH(u:User {id:$id}) OPTIONAL MATCH(i:TutorRewardIdentity {tutorId:$id}) RETURN u,i', { id: tutorId }))[0];
  if (!r) throw new RewardError(403, 'Tutor account unavailable.');
  const u = r.get('u').properties, i = r.get('i')?.properties, w = u.smartWalletAddress;
  if (!i?.publicId || !w || typeof w !== 'object' || w.userId !== tutorId) return null;
  const wallet = rewardAddress(w.smartAccountAddress || w.address);
  if (String(await gateway.read('tutorWallets', [i.publicId])).toLowerCase() !== wallet) throw new RewardError(409, 'Your reward wallet needs support review.');
  const recovery = await gateway.read('recoveries', [i.publicId]);
  if (BigInt(recovery[0]) !== 0n) throw new RewardError(409, 'Reward wallet recovery is pending.');
  return { publicId: i.publicId as string, wallet };
}
async function released(publicId: string) {
  let balance = BigInt(await gateway.read('availableUsd', [publicId]));
  const periodIds: string[] = [];
  const now = Number((await gateway.client.getBlock({ blockTag: 'latest' })).timestamp);
  const months = await records('MATCH(p:TutorRewardPeriod) RETURN p.month AS month ORDER BY p.month LIMIT 120');
  for (const r of months) {
    const id = String(rewardMonth(r.get('month')).periodId);
    const p = await gateway.read('periods', [BigInt(id)]);
    if (!p[5] || Number(p[2]) > now) continue;
    const a = await gateway.read('allocations', [BigInt(id), publicId]);
    if (a[2] || BigInt(a[1]) === 0n || periodIds.length === 32) continue;
    balance += BigInt(a[1]); periodIds.push(id);
  }
  return { balance, periodIds };
}
function ensureLive(state: any) {
  if (process.env.TUTOR_REWARDS_CLAIMS_APPROVED !== 'true' || !state.deployed || !state.finalized || state.claimsPaused) throw new RewardError(409, 'Reward claims are not open yet.');
}
export const tutorRewardClaims = {
  async summary(tutorId: string) {
    await schema(); await this.reconcile(tutorId);
    const state = await gateway.status(), user = state.deployed ? await identity(tutorId) : null;
    const funds = user ? await released(user.publicId) : { balance: 0n, periodIds: [] };
    const assets = [];
    for (const asset of aero.config.assets) {
      const a = await gateway.read('rewardAssets', [rewardAddress(asset.token)]);
      if (!a[7]) continue;
      const symbol = await gateway.client.readContract({ address: rewardAddress(asset.token), abi: [{ type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }], functionName: 'symbol' });
      assets.push({ token: asset.token, symbol, decimals: Number(a[4]) });
    }
    const rows = await records('MATCH(c:TutorRewardClaim {tutorId:$id}) RETURN c ORDER BY c.createdAt DESC LIMIT 30', { id: tutorId });
    return { wallet: user?.wallet || null, availableUsd: funds.balance.toString(), claimsOpen: process.env.TUTOR_REWARDS_CLAIMS_APPROVED === 'true' && state.finalized && !state.claimsPaused,
      assets, claims: rows.map(r => publicClaim(r.get('c').properties)), explorer: pin.explorer, chainId: pin.chainId };
  },
  async quote(tutorId: string, token: string, amountUsd: string) {
    await schema(); ensureLive(await gateway.status());
    const user = await identity(tutorId); if (!user) throw new RewardError(409, 'Your reward wallet has not been registered.');
    const funds = await released(user.publicId), amount = usdMicros(amountUsd);
    if (amount > funds.balance) throw new RewardError(409, 'The amount exceeds your released rewards.');
    const count = (await records('MATCH(c:TutorRewardClaim {tutorId:$id}) WHERE c.createdAt>$since RETURN count(c) AS n', { id: tutorId, since: new Date(Date.now() - 60000).toISOString() }))[0]!.get('n');
    if (Number(count) >= 10) throw new RewardError(429, 'Please wait before requesting another reward quote.');
    const q = await aero.quote(token, amountUsd);
    const claim = { tutorId: user.publicId, wallet: user.wallet, rewardToken: q.token, amountUsd: q.amountUsd, minAmountOut: q.minAmountOut,
      nonce: String(await gateway.read('nonces', [user.publicId])), quotedAt: String(q.quotedAt), deadline: String(q.deadline), assetVersion: q.assetVersion,
      executionEpoch: q.executionEpoch, dataHash: q.dataHash };
    const symbol = await gateway.client.readContract({ address: q.token, abi: [{ type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }], functionName: 'symbol' });
    const id = randomUUID();
    const p = (await records(`CREATE(c:TutorRewardClaim {id:$id,tutorId:$tutorId,wallet:$wallet,token:$token,symbol:$symbol,amountUsd:$amountUsd,
      minAmountOut:$minimum,expectedAmountOut:$expected,deadline:$deadline,status:'quoted',createdAt:$at,claimJson:$claimJson,data:$data,periodsJson:$periods}) RETURN c`, {
      id, tutorId, wallet: user.wallet, token: q.token, symbol, amountUsd: q.amountUsd, minimum: q.minAmountOut, expected: q.expectedAmountOut,
      deadline: q.deadline, at: new Date().toISOString(), claimJson: JSON.stringify(claim), data: q.data, periods: JSON.stringify(funds.periodIds),
    }))[0]!.get('c').properties;
    return publicClaim(p);
  },
  async confirm(tutorId: string, id: string) {
    await schema(); ensureLive(await gateway.status());
    const user = await identity(tutorId); if (!user) throw new RewardError(409, 'Your reward wallet has not been registered.');
    const s = getDriver().session(); let row: any;
    try { row = await s.executeWrite(async tx => {
      await tx.run('MERGE(l:TutorRewardClaimLock {tutorId:$tutorId}) SET l.revision=coalesce(l.revision,0)+1 RETURN l', { tutorId });
      const p = (await tx.run('MATCH(c:TutorRewardClaim {id:$id,tutorId:$tutorId}) RETURN c', { id, tutorId })).records[0]?.get('c').properties;
      if (!p) throw new RewardError(404, 'Reward quote not found.');
      if (p.wallet !== user.wallet) throw new RewardError(409, 'Your reward wallet changed.');
      if (p.engineId || ['finalized', 'review_required'].includes(p.status)) return p;
      if (!p.attempted && Number(p.deadline) * 1000 <= Date.now()) throw new RewardError(410, 'This quote expired. Request a new quote.');
      const other = (await tx.run('MATCH(c:TutorRewardClaim {tutorId:$tutorId}) WHERE c.id<>$id AND c.status IN $active RETURN c LIMIT 1', { tutorId, id, active })).records[0];
      if (other) throw new RewardError(409, 'An earlier reward claim is still pending.');
      if (p.status === 'quoted') await tx.run("MATCH(c:TutorRewardClaim {id:$id}) SET c.status='authorizing' RETURN c", { id });
      return p;
    }); } finally { await s.close(); }
    if (row.engineId || ['finalized', 'review_required'].includes(row.status)) return publicClaim(row);
    const claim = JSON.parse(row.claimJson), periods = JSON.parse(row.periodsJson);
    if (claim.tutorId !== user.publicId || claim.wallet !== user.wallet) throw new RewardError(409, 'Your reward identity changed.');
    let signature = row.signature;
    if (!signature) {
      const response = await gateway.request('/v1/tutor-rewards/authorize', { userId: tutorId, wallet: user.wallet, claim, data: row.data, periodIds: periods });
      signature = response.signature;
      const typed = { domain: { name: 'FluentXVerse Tutor Rewards', version: '1', chainId: 4663, verifyingContract: rewardAddress(pin.contract) },
        types: tutorRewardClaimTypes, primaryType: 'Claim' as const, message: claim };
      if (!/^0x[0-9a-f]{130}$/i.test(signature || '') || response.digest !== hashTypedData(typed)
        || (await recoverTypedDataAddress({ ...typed, signature })).toLowerCase() !== user.wallet) throw new RewardError(503, 'Managed wallet authorization could not be verified.');
      const saved = await records("MATCH(c:TutorRewardClaim {id:$id,tutorId:$tutorId}) WHERE c.status IN ['authorizing','prepared'] AND c.signature IS NULL AND c.deadline>$now SET c.signature=$signature,c.status='prepared' RETURN c", { id, tutorId, signature, now: Math.floor(Date.now() / 1000) });
      const winner = saved[0]?.get('c').properties || (await records('MATCH(c:TutorRewardClaim {id:$id,tutorId:$tutorId}) RETURN c', { id, tutorId }))[0]?.get('c').properties;
      if (!winner?.signature) throw new RewardError(410, 'This quote expired before authorization completed.');
      if (winner.engineId || ['finalized', 'review_required'].includes(winner.status)) return publicClaim(winner);
      if (!winner.attempted && Number(winner.deadline) * 1000 <= Date.now()) throw new RewardError(410, 'This quote expired before authorization completed.');
      // Concurrent confirmations must use the first durable authorization, never replace it.
      signature = winner.signature; row = winner;
    }
    await records('MATCH(c:TutorRewardClaim {id:$id}) SET c.attempted=true RETURN c', { id });
    const engineId = await gateway.submit('claim:' + id, 'claim', [claim, periods, row.data, signature], false, !!row.attempted);
    await records("MATCH(c:TutorRewardClaim {id:$id}) SET c.engineId=$engineId,c.status='queued' RETURN c", { id, engineId });
    return publicClaim({ ...row, status: 'queued' });
  },
  async reconcile(tutorId?: string) {
    if (!gateway.configured()) return;
    await records("MATCH(c:TutorRewardClaim) WHERE c.status IN ['quoted','authorizing','prepared'] AND c.deadline<=$now AND coalesce(c.attempted,false)=false SET c.status='expired' RETURN c.id", { now: Math.floor(Date.now() / 1000) });
    const rows = await records('MATCH(c:TutorRewardClaim) WHERE c.engineId IS NOT NULL AND c.status IN $states AND ($tutorId IS NULL OR c.tutorId=$tutorId) RETURN c LIMIT 30', { states: active, tutorId: tutorId || null });
    for (const r of rows) {
      const c = r.get('c').properties;
      const status = await gateway.operation(c.engineId, 'claim', [JSON.parse(c.claimJson), JSON.parse(c.periodsJson), c.data, c.signature]);
      await records('MATCH(c:TutorRewardClaim {id:$id}) SET c.status=$status,c.transactionHash=$hash RETURN c', { id: c.id, status: status.status, hash: status.transactionHash });
    }
  },
};
