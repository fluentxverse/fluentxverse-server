import { randomBytes } from 'node:crypto';
import { getDriver } from '../../db/memgraph';
import { db, query } from '../../db/postgres';
import { plainNode } from '../../utils/adminOperations';
import type { RewardCommand, RewardOperation, RewardPeriod, TutorRewardPreview, TutorRewardSummary } from '../../../../shared/tutorRewards';
import { initialRewardSymbols } from '../../../../shared/tutorRewards';
import { pin, rewardsGateway as gateway, rewardsAbi, settlementAbi, jsonSafe } from './gateway';
import { RewardError, rewardAddress, rewardAmount, rewardDigest, rewardLesson, rewardMonth, rewardTimestamp, usdMicros } from './policy';
import { startRewardPricePublisher } from './pricePublisher';
import { tutorRewardClaims } from './claims';

let ready: Promise<void> | undefined;
export function ensureRewardsSchema() {
  return ready ||= (async () => {
    const s = getDriver().session();
    try {
      for (const [label, property] of [['TutorRewardOperation', 'id'], ['TutorRewardIdentity', 'tutorId'], ['TutorRewardIdentity', 'publicId'], ['TutorRewardPeriod', 'month']]) {
        const exists = async () => (await s.run('SHOW CONSTRAINT INFO')).records.some(r => r.get('constraint type') === 'unique' && r.get('label') === label && r.get('properties').join(',') === property);
        if (await exists()) continue;
        try { await s.run(`CREATE CONSTRAINT ON (n:${label}) ASSERT n.${property} IS UNIQUE`); }
        catch { if (!await exists()) throw new RewardError(503, 'Rewards accounting constraints are unavailable.'); }
      }
    } finally { await s.close(); }
  })().catch(e => { ready = undefined; throw e; });
}
async function records(cypher: string, params: Record<string, any> = {}) {
  const s = getDriver().session();
  try { return (await s.run(cypher, params)).records; } finally { await s.close(); }
}
function periodValue(month: string, raw: any): RewardPeriod {
  return { month, periodId: rewardMonth(month).periodId, exists: Number(raw[1]) !== 0,
    minimumLessons: Number(raw[3]), rewardPerLessonUsd: String(raw[4]), finalized: raw[5], totalUsd: String(raw[6]),
    releaseAt: Number(raw[2]) ? new Date(Number(raw[2]) * 1000).toISOString() : '' };
}
function operationValue(p: any): RewardOperation {
  return { id: p.id, action: p.action, status: p.status, createdAt: p.createdAt, actorId: p.actorId, reason: p.reason,
    engineTransactionId: p.engineTransactionId || undefined, transactionHash: p.transactionHash || undefined, error: p.publicError || undefined };
}

export const tutorRewardsService = {
  async summary(): Promise<TutorRewardSummary> {
    await ensureRewardsSchema();
    const [state, periodRows, operationRows] = await Promise.all([gateway.status(), records('MATCH(p:TutorRewardPeriod) RETURN p ORDER BY p.month DESC LIMIT 120'),
      records('MATCH(o:TutorRewardOperation) RETURN o ORDER BY o.createdAt DESC LIMIT 50')]);
    const periods = state.deployed ? await Promise.all(periodRows.map(async r => periodValue(r.get('p').properties.month, await gateway.read('periods', [BigInt(rewardMonth(r.get('p').properties.month).periodId)])))) : [];
    const assetRows = await records("MATCH(o:TutorRewardOperation {action:'configure_asset'}) RETURN o.commandJson AS json");
    const tokens = [...new Set<string>(assetRows.map(r => JSON.parse(r.get('json')).args[0]))];
    const assets = state.deployed ? await Promise.all(tokens.map(async token => {
      const a = await gateway.read('rewardAssets', [token]);
      let symbol = token.slice(0, 10);
      try { symbol = await gateway.client.readContract({ address: rewardAddress(token), abi: [{ type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }], functionName: 'symbol' }); } catch {}
      return { token, symbol, adapter: a[0], priceFeed: a[1], maxPriceAgeSeconds: Number(a[2]), maxSlippageBps: Number(a[3]), version: String(a[6]), enabled: a[7] };
    })) : [];
    const blockers: string[] = [];
    if (!state.deployed) blockers.push('Contract not deployed on Robinhood Chain.');
    else if (!state.finalized) blockers.push('Deployment is awaiting network finality.');
    if (!gateway.configured()) blockers.push('Engine connection is not configured.');
    if (BigInt(state.operatorGasWei) === 0n) blockers.push('Engine wallet needs ETH on Robinhood Chain.');
    if (!assets.some(a => a.enabled)) blockers.push('No reward assets have been enabled.');
    return { ...state, chainId: pin.chainId, network: pin.network, explorer: pin.explorer, contract: pin.contract,
      settlementToken: pin.settlementToken, settlementSymbol: pin.settlementSymbol, operator: pin.operator,
      engineConfigured: gateway.configured(), periods, assets, operations: operationRows.map(r => operationValue(r.get('o').properties)), blockers, checkedAt: new Date().toISOString() };
  },

  async preview(month: string): Promise<TutorRewardPreview> {
    const range = rewardMonth(month);
    const result = await records(`MATCH(b:Booking) WHERE b.slotDateTime>=datetime($startsAt) AND b.slotDateTime<datetime($endsAt)
      OPTIONAL MATCH(u:User {id:b.tutorId}) OPTIONAL MATCH(p:Penalty {bookingId:b.bookingId})
      WHERE p.penaltyCode IN ['301','TA-301'] AND p.revokedAt IS NULL AND coalesce(p.status,'')<>'voided'
      RETURN b,u,count(p)>0 AS ta301 ORDER BY b.bookingId LIMIT 50001`, range);
    if (result.length > 50000) throw new RewardError(409, 'This month requires a larger reconciliation job; no truncated totals were used.');
    const bookings = result.map(r => ({ b: plainNode(r.get('b').properties), u: plainNode(r.get('u')?.properties || {}), ta301: r.get('ta301') }));
    const ids = bookings.map(r => r.b.bookingId);
    if (new Set(ids).size !== ids.length) throw new RewardError(409, 'Duplicate booking records require reconciliation.');
    // Legacy report schemas have no structured decision; a missing decision must hold, not approve, the lesson.
    const reportRows = ids.length ? (await query(`SELECT booking_id,review_status,to_jsonb(r)->>'completion_decision' AS completion_decision
      FROM student_lesson_issue_reports r WHERE booking_id=ANY($1::text[])
      UNION ALL SELECT booking_id,review_status,to_jsonb(r)->>'completion_decision' AS completion_decision
      FROM lesson_trouble_reports r WHERE booking_id=ANY($1::text[])`, [db.array(ids, 'TEXT')])).rows : [];
    const reportsByBooking = new Map<string, Array<{ status: string; decision: string | null }>>();
    for (const r of reportRows) {
      const group = reportsByBooking.get(r.booking_id) || [];
      group.push({ status: r.review_status, decision: r.completion_decision }); reportsByBooking.set(r.booking_id, group);
    }
    for (const group of reportsByBooking.values()) group.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const identityRows = await records('MATCH(i:TutorRewardIdentity) RETURN i');
    const identities = new Map(identityRows.map(r => [r.get('i').properties.tutorId, r.get('i').properties.publicId]));
    const state = await gateway.status();
    const period = state.deployed ? periodValue(month, await gateway.read('periods', [BigInt(range.periodId)])) : null;
    const rows = new Map<string, TutorRewardPreview['rows'][number]>();
    const evidence: unknown[] = [];
    for (const { b, u, ta301 } of bookings) {
      if (!b.tutorId) throw new RewardError(409, 'A booking has no tutor binding.');
      const reports = reportsByBooking.get(b.bookingId) || [];
      const outcome = rewardLesson(b, reports, ta301);
      evidence.push({ booking: b, ta301, reports });
      const managed = u.smartWalletAddress;
      const candidate = managed && typeof managed === 'object' && managed.userId === b.tutorId ? managed.smartAccountAddress || managed.address : null;
      const wallet = typeof candidate === 'string' && /^0x[0-9a-f]{40}$/i.test(candidate) && BigInt(candidate) !== 0n ? candidate.toLowerCase() : null;
      const row = rows.get(b.tutorId) || { tutorId: b.tutorId, publicId: identities.get(b.tutorId) || null,
        name: u.givenName ? `${u.givenName} ${u.familyName || ''}`.trim() : u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : 'Tutor',
        wallet, completedLessons: 0, heldLessons: 0, excludedLessons: 0, amountUsd: '0', registered: false,
        stagedLessons: null, stagedAmountUsd: null, availableUsd: null };
      if (outcome === 'completed') row.completedLessons++;
      if (outcome === 'held') row.heldLessons++;
      if (outcome === 'excluded') row.excludedLessons++;
      rows.set(b.tutorId, row);
    }
    // Keep previously staged tutors in the roster even if their bookings were removed or became TA-301.
    const stagedRows = await records("MATCH(o:TutorRewardOperation {action:'stage_counts'}) RETURN o.commandJson AS json");
    const stagedIds = new Set<string>();
    for (const r of stagedRows) {
      const c = JSON.parse(r.get('json'));
      if (String(c.args[0]) === String(range.periodId)) for (const entry of c.args[1]) stagedIds.add(entry.tutorId);
    }
    for (const [tutorId, publicId] of identities) if (stagedIds.has(publicId) && !rows.has(tutorId)) rows.set(tutorId, {
      tutorId, publicId, name: 'Tutor (archived)', wallet: null, completedLessons: 0, heldLessons: 0, excludedLessons: 0,
      amountUsd: '0', registered: false, stagedLessons: null, stagedAmountUsd: null, availableUsd: null,
    });
    const values = [...rows.values()].sort((a, b) => a.tutorId.localeCompare(b.tutorId));
    for (const row of values) {
      if (period?.exists) row.amountUsd = String(rewardAmount(row.completedLessons, period.minimumLessons, BigInt(period.rewardPerLessonUsd)));
      if (state.deployed && row.publicId) {
        const [wallet, allocation, available] = await Promise.all([gateway.read('tutorWallets', [row.publicId]),
          gateway.read('allocations', [BigInt(range.periodId), row.publicId]), gateway.read('availableUsd', [row.publicId])]);
        row.registered = !!row.wallet && wallet.toLowerCase() === row.wallet;
        row.stagedLessons = Number(allocation[0]); row.stagedAmountUsd = String(allocation[1]); row.availableUsd = String(available);
        if (period?.finalized) {
          row.wallet = BigInt(wallet) === 0n ? null : wallet.toLowerCase(); row.registered = !!row.wallet;
          row.completedLessons = row.stagedLessons!; row.amountUsd = row.stagedAmountUsd; row.heldLessons = 0;
        }
      }
    }
    const heldLessons = values.reduce((n, r) => n + r.heldLessons, 0);
    const blockers: string[] = [];
    if (!period?.exists) blockers.push('Create the reward period onchain before staging totals.');
    if (Date.parse(range.endsAt) > Date.now()) blockers.push('This reward month has not ended.');
    if (heldLessons) blockers.push(`${heldLessons} lessons still require finalization or dispute review.`);
    if (values.some(r => r.completedLessons > 0 && !r.registered)) blockers.push('Register each tutor with completed lessons and reconcile their wallet.');
    if (!values.length) blockers.push('No booked lessons were found for this month.');
    if (state.allocationsPaused) blockers.push('Reward allocations are paused.');
    const totalUsd = values.reduce((n, r) => n + BigInt(r.amountUsd), 0n).toString();
    const allStaged = values.filter(r => r.completedLessons > 0 || (r.stagedLessons || 0) > 0)
      .every(r => r.stagedLessons === r.completedLessons && r.stagedAmountUsd === r.amountUsd);
    return { month, period, rows: values, totalUsd, heldLessons,
      snapshotDigest: rewardDigest({ month, evidence, identities: values.map(r => [r.tutorId, r.publicId, r.wallet]), period }),
      canStage: !blockers.length && !period?.finalized, canFinalize: !blockers.length && !period?.finalized && allStaged && period?.totalUsd === totalUsd,
      blockers };
  },

  async command(body: { action: RewardCommand; requestId: string; reason: string; params: Record<string, any> }, actorId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId || '') || !body.reason?.trim() || body.reason.length > 1000) throw new RewardError(400, 'A request ID and audit reason are required.');
    await ensureRewardsSchema();
    const fingerprint = rewardDigest({ body, actorId, chainId: pin.chainId, contract: pin.contract });
    const old = (await records('MATCH(o:TutorRewardOperation {id:$id}) RETURN o', { id: body.requestId }))[0]?.get('o').properties;
    if (old) {
      if (old.fingerprint !== fingerprint) throw new RewardError(409, 'Request ID belongs to a different reward operation.');
      return this.resume(old, true);
    }
    const state = await gateway.assertWritable();
    const p = body.params || {};
    let method = '', args: any[] = [], settlement = false;
    if (body.action === 'create_period') {
      const r = rewardMonth(p.month), releaseAt = rewardTimestamp(p.releaseAt);
      const rate = usdMicros(p.rewardPerLessonUsd);
      rewardAmount(0, p.minimumLessons, rate);
      if (Date.parse(r.startsAt) <= Date.now() || releaseAt < Date.parse(r.endsAt) / 1000) throw new RewardError(400, 'Create a future month with a release date after it ends.');
      method = 'createPeriod'; args = [String(r.periodId), Date.parse(r.startsAt) / 1000, Date.parse(r.endsAt) / 1000, releaseAt, p.minimumLessons, rate.toString()];
    } else if (body.action === 'set_release') {
      method = 'setPeriodReleaseAt'; args = [String(rewardMonth(p.month).periodId), rewardTimestamp(p.releaseAt)];
    } else if (body.action === 'register_tutor') {
      if (typeof p.tutorId !== 'string' || !/^[\w-]{1,128}$/.test(p.tutorId)) throw new RewardError(400, 'Invalid tutor ID.');
      const user = (await records('MATCH(u:User {id:$id}) RETURN u', { id: p.tutorId }))[0]?.get('u').properties;
      const w = user?.smartWalletAddress;
      if (!w || typeof w !== 'object' || w.userId !== p.tutorId) throw new RewardError(409, 'A bound managed tutor wallet is required.');
      const wallet = rewardAddress(w.smartAccountAddress || w.address);
      const identity = (await records(`MERGE(i:TutorRewardIdentity {tutorId:$id}) ON CREATE SET i.publicId=$publicId RETURN i`, { id: p.tutorId, publicId: '0x' + randomBytes(32).toString('hex') }))[0]!.get('i').properties;
      method = 'registerTutor'; args = [identity.publicId, wallet];
    } else if (['stage_counts', 'finalize_period', 'unlock_rewards'].includes(body.action)) {
      const preview = await this.preview(p.month);
      if (p.snapshotDigest !== preview.snapshotDigest) throw new RewardError(409, 'Lesson totals changed. Refresh and review them again.');
      const eligible = preview.rows.filter(r => r.completedLessons > 0 || (r.stagedLessons || 0) > 0);
      if (body.action === 'stage_counts') {
        if (!preview.canStage) throw new RewardError(409, preview.blockers[0] || 'Period cannot be staged.');
        const offset = Number(p.offset || 0);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset % 128 !== 0 || offset >= eligible.length) throw new RewardError(400, 'Invalid allocation batch.');
        method = 'stageCounts'; args = [String(rewardMonth(p.month).periodId), eligible.slice(offset, offset + 128)
          .map(r => ({ tutorId: r.publicId!, completedLessons: r.completedLessons })).sort((a, b) => a.tutorId.localeCompare(b.tutorId))];
      } else if (body.action === 'finalize_period') {
        if (!preview.canFinalize) throw new RewardError(409, preview.blockers[0] || 'All onchain staged counts must match current finalized totals.');
        method = 'finalizePeriod'; args = [String(rewardMonth(p.month).periodId)];
      } else {
        if (!preview.period?.finalized || Date.parse(preview.period.releaseAt) > Date.now()) throw new RewardError(409, 'Period has not been released.');
        const offset = Number(p.offset || 0);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset % 128 !== 0 || offset >= eligible.length) throw new RewardError(400, 'Invalid unlock batch.');
        method = 'unlockRewards'; args = [String(rewardMonth(p.month).periodId), eligible.slice(offset, offset + 128).map(r => r.publicId)];
      }
    } else if (body.action === 'approve_funding' || body.action === 'fund') {
      const amount = usdMicros(p.amountUsd).toString();
      settlement = body.action === 'approve_funding'; method = settlement ? 'approve' : 'fund';
      args = settlement ? [pin.contract, amount] : [amount];
    } else if (body.action === 'configure_asset') {
      const token = rewardAddress(p.token), adapter = rewardAddress(p.adapter), feed = rewardAddress(p.priceFeed);
      const approved = (process.env.TUTOR_REWARDS_APPROVED_ADAPTERS || '').toLowerCase().split(',').filter(Boolean);
      if (!approved.includes(adapter)) throw new RewardError(409, 'This trading adapter has not been approved for production.');
      if (!Number.isInteger(p.maxSlippageBps) || p.maxSlippageBps < 0 || p.maxSlippageBps > 1000 || !Number.isInteger(p.maxPriceAgeSeconds) || p.maxPriceAgeSeconds < 1 || p.maxPriceAgeSeconds > 0xffffffff) throw new RewardError(400, 'Invalid slippage or oracle freshness limit.');
      method = 'configureAsset'; args = [token, adapter, feed, p.maxPriceAgeSeconds, p.maxSlippageBps];
    } else if (body.action === 'disable_asset') {
      method = 'disableAsset'; args = [rewardAddress(p.token)];
    } else if (body.action === 'set_paused') {
      if (typeof p.claimsPaused !== 'boolean' || typeof p.allocationsPaused !== 'boolean') throw new RewardError(400, 'Invalid pause settings.');
      if (!p.claimsPaused && process.env.TUTOR_REWARDS_CLAIMS_APPROVED !== 'true') throw new RewardError(409, 'Production claims require approved trading and wallet integrations.');
      method = 'setPaused'; args = [p.claimsPaused, p.allocationsPaused];
    } else throw new RewardError(400, 'Unsupported reward operation.');
    const commandJson = JSON.stringify({ method, args, settlement });
    const s = getDriver().session();
    let operation: any;
    try {
      operation = await s.executeWrite(async tx => {
        const actor = (await tx.run('MATCH(a:Admin {id:$actorId,role:"superadmin"}) RETURN a', { actorId })).records[0];
        if (!actor) throw new RewardError(403, 'Superadmin approval is required.');
        const row = (await tx.run(`MERGE(o:TutorRewardOperation {id:$id}) ON CREATE SET o.fingerprint=$fingerprint,o.commandJson=$commandJson,
          o.action=$action,o.actorId=$actorId,o.reason=$reason,o.createdAt=$createdAt,o.status='prepared'
          SET o.revision=coalesce(o.revision,0)+1 RETURN o`, { id: body.requestId, fingerprint, commandJson, action: body.action, actorId, reason: body.reason.trim(), createdAt: new Date().toISOString() })).records[0]!.get('o').properties;
        if (row.fingerprint !== fingerprint) throw new RewardError(409, 'Request ID belongs to another operation.');
        if (body.action === 'create_period') await tx.run('MERGE(p:TutorRewardPeriod {month:$month}) ON CREATE SET p.createdAt=$at', { month: p.month, at: row.createdAt });
        return row;
      });
    } finally { await s.close(); }
    return this.resume(operation);
  },

  async resume(operation: any, replay = false) {
    const command = JSON.parse(operation.commandJson);
    if (operation.engineTransactionId) return operationValue(operation);
    // Every retry uses the same durable operation ID. An uncertain response never creates a new instruction.
    const id = await gateway.submit(operation.id, command.method, command.args, command.settlement, replay);
    await records("MATCH(o:TutorRewardOperation {id:$id}) SET o.engineTransactionId=$engineId,o.status='queued' RETURN o", { id: operation.id, engineId: id });
    return operationValue({ ...operation, engineTransactionId: id, status: 'queued' });
  },

  async reconcile() {
    if (!gateway.configured()) return;
    const rows = await records("MATCH(o:TutorRewardOperation) WHERE o.engineTransactionId IS NOT NULL AND o.status IN ['queued','submitted','confirming'] RETURN o ORDER BY o.createdAt LIMIT 20");
    for (const r of rows) {
      const operation = r.get('o').properties, c = JSON.parse(operation.commandJson);
      const status = await gateway.operation(operation.engineTransactionId, c.method, c.args, c.settlement);
      await records('MATCH(o:TutorRewardOperation {id:$id}) SET o.status=$status,o.transactionHash=$hash RETURN o', { id: operation.id, status: status.status, hash: status.transactionHash });
    }
  },
};

export function startTutorRewardsMonitor() {
  if (process.env.TUTOR_REWARDS_ENABLED !== 'true') return;
  startRewardPricePublisher();
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try { await ensureRewardsSchema(); await tutorRewardsService.reconcile(); await tutorRewardClaims.reconcile(); } catch { /* Retain pending states; never invent a receipt. */ }
    finally { running = false; }
  };
  void tick(); setInterval(tick, 15_000).unref();
}
