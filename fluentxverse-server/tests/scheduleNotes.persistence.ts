import { expect, test } from 'bun:test';
import Elysia from 'elysia';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { signAuthToken } from '../src/utils/jwt';
import { notesState } from '../src/services/lessonWorkflow.service';

test('schedule notes summaries persist, match workflow state, and remain tutor-scoped', async () => {
  if (process.env.SCHEDULE_NOTES_TEST_URI !== 'bolt://127.0.0.1:17738') throw Error('Use only the isolated schedule notes graph');
  process.env.JWT_SECRET = 'schedule-notes-test-only';
  await initDriver(process.env.SCHEDULE_NOTES_TEST_URI, '', '', 30, 500);
  const session = getDriver().session();
  let ownsFixture = false;
  try {
    expect(Number((await session.run('MATCH(n) RETURN count(n) AS n')).records[0]!.get('n'))).toBe(0);
    ownsFixture = true;
    const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    await session.run("CREATE (:User {id:'notes-owner'}), (:User {id:'notes-other'}), (:Student {id:'notes-student',givenName:'Test',familyName:'Learner'})");
    for (const [id, time, status, dirty, absence, tutor] of [
      ['draft', '18:00', null, false, null, 'notes-owner'],
      ['submitted', '18:30', '2026-10-28T01:00:00Z', false, null, 'notes-owner'],
      ['changes', '19:00', '2026-10-28T01:00:00Z', true, null, 'notes-owner'],
      ['exempt', '19:30', null, false, 'absent', 'notes-owner'],
      ['private', '20:00', '2026-10-28T01:00:00Z', false, null, 'notes-other'],
    ]) {
      await session.run(`MATCH (t:User {id:$tutor}), (s:Student {id:'notes-student'})
        CREATE (t)-[:OPENS_SLOT]->(slot:TimeSlot {slotId:$id,slotDate:$date,slotTime:$time,durationMinutes:25,status:'booked'})
        CREATE (b:Booking {bookingId:$id,tutorId:$tutor,status:'confirmed',durationMinutes:25,
          slotDateTime:datetime($start),notesDraftDirty:$dirty,notesSubmittedAt:$submitted,attendanceStudent:$absence})
        CREATE (b)-[:BOOKS]->(slot) CREATE (b)-[:BOOKED_BY]->(s)`,
      { id, time, date, dirty, submitted: status, absence, tutor, start: `${date}T${time}:00+08:00` });
    }
    await session.run("MATCH(b:Booking {bookingId:'draft'})-[:BOOKS]->(s) SET s.durationMinutes=60 REMOVE b.durationMinutes");
    await session.run("MATCH(b:Booking {bookingId:'changes'}) SET b.durationMinutes=50");
    const { default: routes } = await import('../src/routes/schedule.route');
    const api = new Elysia().use(routes);
    expect((await api.handle(new Request('http://localhost/schedule/week'))).status).toBe(401);
    const read = async (userId: string) => {
      const token = await signAuthToken({ userId, role: 'tutor', email: 'notes@example.invalid' } as any);
      const response = await api.handle(new Request('http://localhost/schedule/week?weekOffset=0', { headers: { Cookie: `tutorAuth=${token}` } }));
      expect(response.status).toBe(200);
      return (await response.json() as any).data.slots;
    };
    let slots = await read('notes-owner');
    expect(slots).toHaveLength(4);
    expect(slots.map((slot: any) => slot.bookingId)).not.toContain('private');
    expect(slots.map((slot: any) => slot.notesStatus)).toEqual(['draft', 'submitted', 'changes_pending', 'not_required']);
    expect(slots[0].lessonEndsAt).toBe(new Date(`${date}T18:25:00+08:00`).toISOString());
    for (const slot of slots) {
      const b = (await session.run('MATCH(b:Booking {bookingId:$id}) RETURN b', { id: slot.bookingId })).records[0]!.get('b').properties;
      expect(slot.notesStatus).toBe(notesState(b).notesStatus);
      expect(slot.lessonEndsAt).toBe(notesState(b).endsAt);
      expect(slot).not.toHaveProperty('studentComment');
      expect(slot).not.toHaveProperty('tutorMemo');
    }
    await session.run("MATCH(b:Booking {bookingId:'draft'}) SET b.notesSubmittedAt='2026-10-28T02:00:00Z',b.notesDraftDirty=false");
    slots = await read('notes-owner');
    expect(slots[0].notesStatus).toBe('submitted');
    const other = await read('notes-other');
    expect(other).toHaveLength(1);
    expect(other[0].bookingId).toBe('private');
  } finally {
    if (ownsFixture) await session.run('MATCH(n) DETACH DELETE n');
    await session.close();
    await closeDriver();
  }
}, 30000);
