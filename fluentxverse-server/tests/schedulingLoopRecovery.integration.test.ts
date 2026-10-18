import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { query } from '../src/db/postgres';
import { ScheduleService } from '../src/services/schedule.services/schedule.service';
import { SessionService } from '../src/services/session.services/session.service';
import { ClassroomActivityService } from '../src/services/classroomActivity.services/classroomActivity.service';
import { CancellationRefundService } from '../src/services/ticket.services/cancellationRefund.service';
import { GmrEngineRequestError } from '../src/services/web3.services/gmrEngine.service';

const suite = process.env.LESSON_NOTES_TEST_URI ? describe : describe.skip;
const prefix = `loop-${crypto.randomUUID().slice(0, 12)}`, tutor = `${prefix}-t`, student = `${prefix}-s`;
const id = (name: string) => `${prefix}-${name}`;
const run = async (text: string, params: Record<string, any> = {}) => {
  const db = getDriver().session(); try { return await db.run(text, params); } finally { await db.close(); }
};
const booking = async (name: string) => (await run('MATCH (b:Booking {bookingId: $id}) RETURN b', { id: id(name) })).records[0]!.get('b').properties;
const refund = async (name: string) => (await run('MATCH (r:TicketTransaction {id: $id}) RETURN r', { id: `cancellation-refund-${id(name)}` })).records[0]!.get('r').properties;
const wallet = '0x1111111111111111111111111111111111111111';
const originalVault = process.env.VAULT_WALLET_ADDRESS;
const fixture = async (name: string, hoursBefore = 2) => {
  await run(`CREATE (:Booking {bookingId: $id, studentId: $student, status: 'cancelled', refundStatus: 'pending',
    cancellationRefundVersion: 1, testFixture: $prefix,
    cancelledAt: datetime($cancelledAt), slotDateTime: datetime($startsAt)})
    CREATE (:TicketTransaction {id: $original, bookingId: $id, studentId: $student, studentWallet: $wallet,
      type: 'booking', status: 'completed', tokenId: '1', tier: 'basic', quantity: 1})`, {
    id: id(name), original: id(`${name}-original`), student, wallet, prefix,
    cancelledAt: new Date(Date.now() - hoursBefore * 3600_000).toISOString(), startsAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
};

suite('schedule, presence, and cancellation refund recovery', () => {
  beforeAll(async () => {
    await initDriver(process.env.LESSON_NOTES_TEST_URI!, process.env.MEMGRAPH_USER || 'fluentxverse', process.env.MEMGRAPH_PASSWORD || '', 1);
    await run('CREATE (:User {id: $tutor}), (:Student {id: $student, externalWalletAddress: $wallet})', { tutor, student, wallet });
    await new SessionService().ensurePresenceSchema();
  });
  afterAll(async () => {
    if (originalVault === undefined) delete process.env.VAULT_WALLET_ADDRESS; else process.env.VAULT_WALLET_ADDRESS = originalVault;
    await query('DELETE FROM session_participants WHERE session_id LIKE $1', [`${prefix}%`]);
    await query('DELETE FROM classroom_activity_logs WHERE session_id LIKE $1', [`${prefix}%`]);
    await run(`MATCH (n) WHERE n.id STARTS WITH $prefix OR n.bookingId STARTS WITH $prefix
      OR n.slotId STARTS WITH $prefix OR n.userId = $student DETACH DELETE n`, { prefix, student });
    await run("MATCH (n:Notification) WHERE n.id STARTS WITH $prefix DETACH DELETE n", { prefix: `cancellation-refund-${prefix}` });
    await closeDriver();
  });
  test('only the current booking is returned for a canceled and rebooked slot', async () => {
    const date = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    await run(`MATCH (t:User {id: $tutor}), (student:Student {id: $student})
      CREATE (t)-[:OPENS_SLOT]->(s:TimeSlot {slotId: $slot, slotDate: $date, slotTime: '23:30', status: 'booked'})
      CREATE (a:Booking {bookingId: $old, status: 'cancelled'})-[:BOOKS]->(s)
      CREATE (b:Booking {bookingId: $current, status: 'confirmed'})-[:BOOKS]->(s)
      CREATE (a)-[:BOOKED_BY]->(student), (b)-[:BOOKED_BY]->(student)`, { tutor, student, date, slot: id('slot'), old: id('old'), current: id('new') });
    const schedule = await new ScheduleService().getTutorSchedule({ tutorId: tutor, weekOffset: 0 });
    expect(schedule.slots).toHaveLength(1); expect(schedule.slots[0]!.bookingId).toBe(id('new'));
    await run("MATCH (b:Booking {bookingId: $id}) SET b.status = 'cancelled' WITH b MATCH (s:TimeSlot {slotId: $slot}) SET s.status = 'open'", { id: id('new'), slot: id('slot') });
    const reopened = await new ScheduleService().getTutorSchedule({ tutorId: tutor, weekOffset: 0 });
    expect(reopened.slots).toHaveLength(1); expect(reopened.slots[0]!.bookingId).toBeUndefined();
  });
  test('restart cleanup preserves actual presence without inventing attendance at restart', async () => {
    const sessions = new SessionService(), activity = new ClassroomActivityService(), room = id('presence');
    const now = new Date(), start = new Date(now.getTime() - 4 * 60_000), early = new Date(start.getTime() - 60_000);
    await sessions.addParticipant({ sessionId: room, userId: tutor, userType: 'tutor', socketId: 'stale-socket' });
    await query('UPDATE session_participants SET joined_at = $2::timestamptz, last_seen_at = $2::timestamptz WHERE session_id = $1', [room, early]);
    const entered = await activity.log({ sessionId: room, userId: tutor, userType: 'tutor', eventType: 'entered' });
    await query('UPDATE classroom_activity_logs SET created_at = $2 WHERE id = $1', [entered.id, early]);
    expect(await activity.hasTutorEnteredForLesson(room, tutor, start, now)).toBe(false);
    await sessions.reconcilePresence([], room);
    expect(await sessions.getSessionParticipants(room)).toHaveLength(0);
    expect(await activity.getTutorPresenceForLesson(room, tutor, start, now)).toEqual({ hasJoined: false, leftAt: null });
    expect(await activity.hasTutorEnteredForLesson(room, tutor, start, now)).toBe(false);
    await sessions.addParticipant({ sessionId: room, userId: tutor, userType: 'tutor', socketId: 'live-socket' });
    await sessions.reconcilePresence(['live-socket'], room);
    expect((await activity.getTutorPresenceForLesson(room, tutor, start, new Date())).hasJoined).toBe(true);
    const lastSeen = new Date(Date.now() - 61_000);
    await query('UPDATE session_participants SET joined_at = $2, last_seen_at = $3 WHERE session_id = $1 AND is_active = true', [room, start, lastSeen]);
    await sessions.reconcilePresence([], room);
    const presence = await activity.getTutorPresenceForLesson(room, tutor, start, new Date());
    expect(presence.hasJoined).toBe(true); expect(presence.leftAt).toBe(lastSeen.getTime());
    expect(await activity.hasTutorEnteredForLesson(room, tutor, start, new Date())).toBe(true);
  });
  test('cleanup can deactivate a reconnected participant while preserving older inactive records', async () => {
    const sessions = new SessionService(), room = id('reconnect');
    await sessions.addParticipant({ sessionId: room, userId: tutor, userType: 'tutor', socketId: 'old-connection' });
    await sessions.addParticipant({ sessionId: room, userId: tutor, userType: 'tutor', socketId: 'new-connection' });
    expect((await query('SELECT is_active FROM session_participants WHERE session_id = $1', [room])).rows).toHaveLength(2);
    await sessions.reconcilePresence([], room);
    expect(await sessions.getSessionParticipants(room)).toHaveLength(0);
    expect((await query('SELECT is_active FROM session_participants WHERE session_id = $1', [room])).rows).toHaveLength(2);
  });
  test('eligible refunds survive delays and retries and are completed only after engine confirmation', async () => {
    await fixture('retry');
    let configured = false, writes = 0, polls = 0;
    const engine = { configured: () => configured, contractWrite: async () => { writes++; return { id: 'engine-retry', status: 'queued' }; },
      transaction: async () => { polls++; return { id: 'engine-retry', status: 'confirmed', transactionHash: '0xrefund' }; } };
    const service = new CancellationRefundService(engine as any);
    expect((await service.process(id('retry')))?.status).toBe('pending'); expect(writes).toBe(0);
    configured = true; process.env.VAULT_WALLET_ADDRESS = wallet;
    await run('MATCH (r:TicketTransaction {id: $id}) REMOVE r.nextAttemptAt', { id: `cancellation-refund-${id('retry')}` });
    await service.process(id('retry'));
    expect((await booking('retry')).refunded).not.toBe(true); expect(writes).toBe(1);
    expect((await service.process(id('retry')))?.status).toBe('completed');
    expect((await booking('retry')).refunded).toBe(true); expect(polls).toBe(1);
    await service.process(id('retry')); expect(writes).toBe(1);
    expect((await run('MATCH (n:Notification {id: $id}) RETURN n', { id: `cancellation-refund-${id('retry')}-notification` })).records).toHaveLength(1);
  });
  test('concurrent workers dispatch one transfer and ambiguous network failures are not retried', async () => {
    await fixture('race'); let writes = 0;
    const service = new CancellationRefundService({ configured: () => true,
      contractWrite: async () => { writes++; await Bun.sleep(50); return { id: 'engine-race', status: 'queued' }; },
      transaction: async () => ({ id: 'engine-race', status: 'queued' }) } as any);
    await Promise.all([service.process(id('race')), service.process(id('race'))]); expect(writes).toBe(1);
    await fixture('uncertain'); let uncertainWrites = 0;
    const uncertain = new CancellationRefundService({ configured: () => true, contractWrite: async () => { uncertainWrites++; throw new Error('Network response lost'); } } as any);
    await uncertain.process(id('uncertain')); await uncertain.process(id('uncertain'));
    expect((await booking('uncertain')).refundStatus).toBe('review'); expect(uncertainWrites).toBe(1);
  });
  test('definitive rejection is retryable, interrupted dispatch is held, and ineligible refunds never transfer', async () => {
    await fixture('rejected'); let writes = 0;
    const service = new CancellationRefundService({ configured: () => true,
      contractWrite: async () => { writes++; if (writes === 1) throw new GmrEngineRequestError(429, 'Try later'); return { id: 'engine-rejected', status: 'confirmed' }; } } as any);
    await service.process(id('rejected')); expect((await refund('rejected')).refundPhase).toBe('queued');
    await run('MATCH (r:TicketTransaction {id: $id}) REMOVE r.nextAttemptAt', { id: `cancellation-refund-${id('rejected')}` });
    await service.reconcile([id('rejected')]); expect((await booking('rejected')).refunded).toBe(true); expect(writes).toBe(2);
    await fixture('interrupted');
    await new CancellationRefundService({ configured: () => false } as any).process(id('interrupted'));
    await run("MATCH (r:TicketTransaction {id: $id}) SET r.refundPhase = 'dispatching', r.leaseUntil = $past REMOVE r.nextAttemptAt", { id: `cancellation-refund-${id('interrupted')}`, past: new Date(Date.now() - 1000).toISOString() });
    await service.process(id('interrupted')); expect((await booking('interrupted')).refundStatus).toBe('review'); expect(writes).toBe(2);
    await fixture('ineligible', 0.1); expect(await service.process(id('ineligible'))).toBeNull();
    expect((await booking('ineligible')).refundStatus).toBe('not_required'); expect(writes).toBe(2);
  });
  test('historical untracked refunds require review instead of risking a duplicate payment', async () => {
    await fixture('legacy'); await run('MATCH (b:Booking {bookingId: $id}) REMOVE b.cancellationRefundVersion', { id: id('legacy') });
    let writes = 0;
    const service = new CancellationRefundService({ configured: () => true, contractWrite: async () => { writes++; return { id: 'must-not-send', status: 'queued' }; } } as any);
    await service.process(id('legacy')); expect(writes).toBe(0); expect((await booking('legacy')).refundStatus).toBe('review');
    expect((await run('MATCH (n:Notification {id: $id}) RETURN n', { id: `cancellation-refund-${id('legacy')}-review-notification` })).records).toHaveLength(1);
  });
  test('a failed engine status cannot resend a mined transfer and only a proven revert allows retry', async () => {
    for (const status of ['success', 'reverted'] as const) {
      await fixture(`receipt-${status}`); let writes = 0;
      const service = new CancellationRefundService({ configured: () => true,
        contractWrite: async () => { writes++; return { id: `engine-${status}`, status: 'queued' }; },
        transaction: async () => ({ id: `engine-${status}`, status: 'failed', transactionHash: '0xreceipt' }) } as any,
        async () => ({ status }));
      await service.process(id(`receipt-${status}`)); await service.process(id(`receipt-${status}`));
      expect(writes).toBe(1);
      expect((await refund(`receipt-${status}`)).refundPhase).toBe(status === 'success' ? 'completed' : 'queued');
      if (status === 'reverted') {
        await run('MATCH (r:TicketTransaction {id: $id}) REMOVE r.nextAttemptAt', { id: `cancellation-refund-${id(`receipt-${status}`)}` });
        await service.process(id(`receipt-${status}`)); expect(writes).toBe(2);
      }
    }
  });
});
