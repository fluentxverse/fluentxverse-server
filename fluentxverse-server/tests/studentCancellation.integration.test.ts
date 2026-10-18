import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import Elysia from 'elysia';
import Schedule from '../src/routes/schedule.route';
import { closeDriver, getDriver, initDriver } from '../src/db/memgraph';
import { signAuthToken } from '../src/utils/jwt';
import { ticketService } from '../src/services/ticket.services/ticket.service';
import { NotificationService } from '../src/services/notification.services/notification.service';

const uri = process.env.LESSON_NOTES_TEST_URI;
const suite = uri ? describe : describe.skip;
const fixture = `student-cancellation-${crypto.randomUUID()}`;
const studentId = `${fixture}-student`;
const id = (name: string) => `${fixture}-${name}`;
const app = new Elysia().use(Schedule);
let cookie: string;
let transactionSpy: ReturnType<typeof spyOn>, refundSpy: ReturnType<typeof spyOn>, notificationSpy: ReturnType<typeof spyOn>;
const cancel = (name: string, auth = cookie) => app.handle(new Request('http://localhost/schedule/cancel', {
  method: 'POST', headers: { cookie: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId: id(name) }),
}));

suite('student cancellation cutoff (local Memgraph)', () => {
  beforeAll(async () => {
    await initDriver(uri!, process.env.MEMGRAPH_USER || 'fluentxverse', process.env.MEMGRAPH_PASSWORD || '', 1);
    cookie = `studentAuth=${await signAuthToken({ userId: studentId, role: 'student', email: 'cancel-test@example.com' })}`;
    transactionSpy = spyOn(ticketService, 'getBookingTransaction').mockResolvedValue(null);
    refundSpy = spyOn(ticketService, 'refundTicketForCancellation').mockRejectedValue(new Error('Test must not issue refunds'));
    notificationSpy = spyOn(NotificationService.prototype, 'createNotification').mockResolvedValue({ id: `${fixture}-notification` } as any);
    const session = getDriver().session();
    try {
      await session.run(`CREATE (:Student {id: $studentId, testFixture: $fixture})
        WITH 1 AS unused UNWIND $rows AS row
        CREATE (b:Booking {bookingId: row.id, studentId: $studentId, tutorId: $tutorId, status: row.status,
          slotDateTime: datetime(row.startsAt), testFixture: $fixture})-[:BOOKS]->
          (:TimeSlot {slotId: row.id, status: 'booked', studentId: $studentId, testFixture: $fixture})`, {
        fixture, studentId, tutorId: `${fixture}-tutor`, rows: [
          { id: id('past-confirmed'), status: 'confirmed', startsAt: new Date(Date.now() - 3600_000).toISOString() },
          { id: id('ongoing'), status: 'confirmed', startsAt: new Date(Date.now() - 60_000).toISOString() },
          { id: id('completed'), status: 'completed', startsAt: new Date(Date.now() - 3600_000).toISOString() },
          { id: id('future'), status: 'confirmed', startsAt: new Date(Date.now() + 3600_000).toISOString() },
          { id: id('boundary'), status: 'confirmed', startsAt: new Date(Date.now() + 3600_000).toISOString() },
          { id: id('early-entry'), status: 'confirmed', startsAt: new Date(Date.now() + 4 * 60_000).toISOString() },
        ],
      });
    } finally { await session.close(); }
  });
  afterAll(async () => {
    transactionSpy?.mockRestore(); refundSpy?.mockRestore(); notificationSpy?.mockRestore();
    const session = getDriver().session();
    try { await session.run('MATCH (node {testFixture: $fixture}) DETACH DELETE node', { fixture }); }
    finally { await session.close(); await closeDriver(); }
  });
  test('started lessons cannot be cancelled, refunded, or reopened despite a stale confirmed status', async () => {
    for (const name of ['past-confirmed', 'ongoing', 'completed', 'early-entry']) {
      const response = await cancel(name);
      expect(response.status).toBe(400);
      expect((await response.json() as { error: string }).error).toMatch(/Cannot cancel/);
      const session = getDriver().session();
      try {
        const result = await session.run('MATCH (b:Booking {bookingId:$id})-[:BOOKS]->(s) RETURN b.status AS booking, s.status AS slot, b.cancelledAt AS cancelledAt', { id: id(name) });
        expect(result.records[0]!.get('booking')).toBe(name === 'completed' ? 'completed' : 'confirmed');
        expect(result.records[0]!.get('slot')).toBe('booked');
        expect(result.records[0]!.get('cancelledAt')).toBeNull();
      } finally { await session.close(); }
    }
    expect(transactionSpy).not.toHaveBeenCalled(); expect(refundSpy).not.toHaveBeenCalled(); expect(notificationSpy).not.toHaveBeenCalled();
  });
  test('authentication and ownership are still required', async () => {
    expect((await cancel('future', '')).status).toBe(401);
    const other = `studentAuth=${await signAuthToken({ userId: `${fixture}-other`, role: 'student', email: 'other@example.com' })}`;
    expect((await cancel('future', other)).status).toBe(400);
    expect(transactionSpy).not.toHaveBeenCalled();
  });
  test('future cancellation still works and duplicate requests have no refund side effects', async () => {
    expect((await cancel('future')).status).toBe(200);
    const session = getDriver().session();
    try {
      const result = await session.run('MATCH (b:Booking {bookingId:$id})-[:BOOKS]->(s) RETURN b.status AS booking, s.status AS slot', { id: id('future') });
      expect(result.records[0]!.get('booking')).toBe('cancelled'); expect(result.records[0]!.get('slot')).toBe('open');
    } finally { await session.close(); }
    expect((await cancel('future')).status).toBe(400);
    expect(transactionSpy).toHaveBeenCalledTimes(1); expect(notificationSpy).toHaveBeenCalledTimes(1);
    expect(refundSpy).not.toHaveBeenCalled();
  });
  test('eligibility is rechecked after asynchronous lookups before cancellation or refund', async () => {
    transactionSpy.mockImplementationOnce(async () => {
      const session = getDriver().session();
      try {
        await session.run('MATCH (b:Booking {bookingId:$id}) SET b.slotDateTime = datetime($past)', {
          id: id('boundary'), past: new Date(Date.now() + 4 * 60_000).toISOString(),
        });
      } finally { await session.close(); }
      return null;
    });
    expect((await cancel('boundary')).status).toBe(400);
    const session = getDriver().session();
    try {
      const result = await session.run('MATCH (b:Booking {bookingId:$id})-[:BOOKS]->(s) RETURN b.status AS booking, s.status AS slot', { id: id('boundary') });
      expect(result.records[0]!.get('booking')).toBe('confirmed'); expect(result.records[0]!.get('slot')).toBe('booked');
    } finally { await session.close(); }
    expect(refundSpy).not.toHaveBeenCalled(); expect(notificationSpy).toHaveBeenCalledTimes(1);
  });
});
