import { getDriver } from '../../db/memgraph';
import { aeroTutorRewards, alchemyFeedAbi, type AeroTutorRewards } from './aero';
import { pin } from './gateway';
import { rewardDigest, RewardError } from './policy';

async function records(cypher: string, params: Record<string, any> = {}) {
  const s = getDriver().session();
  try { return (await s.run(cypher, params)).records; } finally { await s.close(); }
}
let schema: Promise<void> | undefined;
async function ensureSchema() {
  return schema ||= (async () => {
    const exists = async () => (await records('SHOW CONSTRAINT INFO')).some(r => r.get('constraint type') === 'unique'
      && r.get('label') === 'TutorRewardPricePublication' && r.get('properties').join(',') === 'id');
    if (await exists()) return;
    try { await records('CREATE CONSTRAINT ON (n:TutorRewardPricePublication) ASSERT n.id IS UNIQUE'); }
    catch (e) { if (!await exists()) throw e; }
  })().catch(e => { schema = undefined; throw e; });
}

export async function publishRewardPrices(integration: AeroTutorRewards = aeroTutorRewards) {
  if (process.env.TUTOR_REWARDS_PRICE_PUBLISHING_ENABLED !== 'true') return;
  if (!integration.gateway.configured() || !integration.prices.configured() || !integration.config.adapter) return;
  await ensureSchema();
  const state = await integration.gateway.status();
  if (!state.deployed || !state.finalized) return;
  const confirming = await records("MATCH(p:TutorRewardPricePublication {status:'confirming'}) RETURN p ORDER BY p.createdAt LIMIT 100");
  for (const r of confirming) {
    const p = r.get('p').properties;
    if (!integration.config.assets.some(a => a.feed.toLowerCase() === p.feed)) continue;
    const status = await integration.gateway.contractOperation(p.engineTransactionId, p.feed, alchemyFeedAbi, 'publish', JSON.parse(p.argsJson));
    await records('MATCH(p:TutorRewardPricePublication {id:$id}) SET p.status=$status,p.transactionHash=$hash RETURN p', { id: p.id, status: status.status, hash: status.transactionHash });
  }
  // No periodic gas spend while no tutor rewards are reserved. Activation can bootstrap one observation explicitly.
  if (BigInt(state.reservedUsd || '0') === 0n) return;
  let failures = 0;
  for (const asset of integration.config.assets) {
    try {
    // Each feed has at most one in-flight observation. Price publishing never submits a purchase or claim.
    const pending = (await records("MATCH(p:TutorRewardPricePublication {token:$token}) WHERE p.status IN ['prepared','queued','submitted'] RETURN p ORDER BY p.createdAt LIMIT 1", { token: asset.token.toLowerCase() }))[0]?.get('p').properties;
    const observation = pending ? null : await integration.publication(asset.token);
    const args = pending ? JSON.parse(pending.argsJson) : observation!.args;
    const feed = pending?.feed || observation!.feed;
    if (feed !== integration.asset(asset.token).feed.toLowerCase()) continue;
    await integration.bindings(asset, false);
    const id = pending?.id || 'price:' + rewardDigest({ chainId: pin.chainId, feed, args });
    const old = pending || (await records('MATCH(p:TutorRewardPricePublication {id:$id}) RETURN p', { id }))[0]?.get('p').properties;
    if (old && ['finalized', 'review_required'].includes(old.status)) continue;
    const row = old || (await records(`MERGE(p:TutorRewardPricePublication {id:$id}) ON CREATE SET p.feed=$feed,p.token=$token,
      p.argsJson=$argsJson,p.status='prepared',p.createdAt=$at RETURN p`, {
      id, feed, token: asset.token.toLowerCase(), argsJson: JSON.stringify(args), at: new Date().toISOString(),
    }))[0]!.get('p').properties;
    let engineId = row.engineTransactionId;
    if (!engineId) {
      await records('MATCH(p:TutorRewardPricePublication {id:$id}) SET p.attempted=true RETURN p', { id });
      engineId = await integration.gateway.submitContract(id, feed, alchemyFeedAbi, 'publish', args, !!row.attempted);
      await records("MATCH(p:TutorRewardPricePublication {id:$id}) SET p.engineTransactionId=$engineId,p.status='queued' RETURN p", { id, engineId });
    }
    const result = await integration.gateway.contractOperation(engineId, feed, alchemyFeedAbi, 'publish', args);
    await records('MATCH(p:TutorRewardPricePublication {id:$id}) SET p.status=$status,p.transactionHash=$hash RETURN p', {
      id, status: result.status, hash: result.transactionHash,
    });
    } catch { failures++; }
  }
  if (failures) throw new RewardError(503, 'One or more approved reward feeds could not be updated.');
}

export function startRewardPricePublisher() {
  if (process.env.TUTOR_REWARDS_PRICE_PUBLISHING_ENABLED !== 'true') return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await publishRewardPrices(); } catch { /* Leave the durable operation pending; do not substitute a fresh price. */ }
    finally { running = false; }
  };
  void tick(); setInterval(tick, 60_000).unref();
}
