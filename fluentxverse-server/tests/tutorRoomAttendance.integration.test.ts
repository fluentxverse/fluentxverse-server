import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { ScheduleService } from '../src/services/schedule.services/schedule.service';
import { ClassroomActivityService } from '../src/services/classroomActivity.services/classroomActivity.service';
import { query } from '../src/db/postgres';
import { lessonOutcome } from '../src/services/lessonWorkflow.service';

const suite = process.env.LESSON_NOTES_TEST_URI ? describe : describe.skip;
const prefix = `room-policy-${crypto.randomUUID()}`;
const tutorId = `${prefix}-tutor`;
const start = Date.now() + 86400000;
const service = new ScheduleService();
const run = async (cypher: string, params: Record<string, any> = {}) => {
  const session = getDriver().session();
  try { return await session.run(cypher, params); } finally { await session.close(); }
};
const id = (name: string) => `${prefix}-${name}`;
const raw = async (name: string) => (await run('MATCH (b:Booking {bookingId: $id}) RETURN b', { id: id(name) })).records[0]!.get('b').properties;
const at = (minutes: number) => new Date(start + minutes * 60000);
const reconcile = (now: Date, proof: Parameters<ScheduleService['reconcileMissedTutorRoomEntry']>[1]) =>
  service.reconcileMissedTutorRoomEntry(now, proof, tutorId);
suite('scheduled classroom attendance', () => {
  beforeAll(async () => {
    await initDriver(process.env.LESSON_NOTES_TEST_URI!, process.env.MEMGRAPH_USER || 'fluentxverse', process.env.MEMGRAPH_PASSWORD || '', 1);
    await run('CREATE (:User {id: $tutorId})', { tutorId });
    for (const name of ['late', 'early', 'missed', 'admin', 'cancelled', 'ended', 'history', 'custom']) {
      await run(`CREATE (b:Booking {bookingId: $id, tutorId: $tutorId, status: $status, durationMinutes: $duration,
        slotDateTime: datetime($start), attendanceAutoEnforce: true})-[:BOOKS]->(:TimeSlot {slotId: $id, tutorId: $tutorId, status: 'booked'})`,
        { id: id(name), tutorId, start: at(0).toISOString(), status: name === 'cancelled' ? 'cancelled' : name === 'ended' ? 'completed' : 'confirmed', duration: name === 'custom' ? 50 : 25 });
    }
    await run("MATCH (b:Booking {bookingId: $id}) SET b.attendanceTutor = 'absent', b.attendanceSource = 'admin'", { id: id('admin') });
  });
  afterAll(async () => {
    await query('DELETE FROM classroom_activity_logs WHERE session_id LIKE $1', [`${prefix}%`]);
    await run('MATCH (n) WHERE n.bookingId STARTS WITH $prefix OR n.slotId STARTS WITH $prefix OR n.tutorId = $tutorId OR n.id STARTS WITH $prefix DETACH DELETE n', { prefix, tutorId });
    await closeDriver();
  });
  test('any entry during the schedule counts, including late entry and student absence', async () => {
    expect(await service.getClassroomSchedule(id('late'), tutorId, 'tutor')).toEqual({ startsAt: start, endsAt: start + 25 * 60000 });
    expect(await service.getClassroomSchedule(id('late'), 'another-tutor', 'tutor')).toBeNull();
    expect(await service.getClassroomSchedule(id('late'), tutorId, 'student')).toBeNull();
    expect(await service.getClassroomSchedule(id('cancelled'), tutorId, 'tutor')).toBeNull();
    expect(await service.markTutorRoomEntry(id('late'), 'another-tutor', at(12))).toBe(false);
    await service.markTutorRoomEntry(id('late'), tutorId, at(-1));
    expect((await raw('late')).attendanceTutor).toBeUndefined();
    await run("MATCH (b:Booking {bookingId: $id}) SET b.attendanceStudent = 'absent', b.attendanceTutor = 'absent', b.attendanceSource = 'automatic' CREATE (:Penalty {bookingId: $id, tutorId: $tutorId, penaltyCode: '301'})", { id: id('late'), tutorId });
    expect(await service.markTutorRoomEntry(id('late'), tutorId, at(24))).toBe(true);
    const booking = await raw('late');
    expect(booking.attendanceTutor).toBe('present');
    expect(booking.attendanceStudent).toBe('absent');
    expect(lessonOutcome(booking)).toBe('attended');
    expect(booking.attendanceStatus).toBe('present');
    const penalty = (await run('MATCH (p:Penalty {bookingId: $id}) RETURN p', { id: id('late') })).records[0]!.get('p').properties;
    expect(penalty.status).toBe('voided');
    expect(await service.markTutorRoomEntry(id('cancelled'), tutorId, at(10))).toBe(false);
    await service.markTutorRoomEntry(id('ended'), tutorId, at(25));
    expect((await raw('ended')).attendanceTutor).toBeUndefined();
    await service.markTutorRoomEntry(id('custom'), tutorId, at(40));
    expect((await raw('custom')).attendanceTutor).toBe('present');
  });
  test('being connected before start counts only when presence overlaps the schedule', async () => {
    const activity = new ClassroomActivityService();
    await activity.log({ sessionId: id('early'), userId: tutorId, userType: 'tutor', eventType: 'entered' });
    await run('MATCH (b:Booking {bookingId: $id}) SET b.tutorRoomEnteredAt = datetime($early)', { id: id('early'), early: at(-5).toISOString() });
    await query('UPDATE classroom_activity_logs SET created_at = $1 WHERE session_id = $2', [at(-5), id('early')]);
    expect(await activity.hasTutorEnteredForLesson(id('early'), tutorId, at(0), at(10))).toBe(false);
    await query("INSERT INTO classroom_activity_logs (id, session_id, user_id, user_type, event_type, message, created_at) VALUES ($1,$2,$3,'tutor','left','Left',$4)", [id('left'), id('early'), tutorId, at(5)]);
    expect(await activity.hasTutorEnteredForLesson(id('early'), tutorId, at(0), at(10))).toBe(true);
    await reconcile(at(10), async bookingId => bookingId === id('early'));
    expect((await raw('early')).attendanceTutor).toBe('present');
    expect((await raw('missed')).attendanceTutor).toBeUndefined();
    await query('UPDATE classroom_activity_logs SET created_at = $1 WHERE id = $2', [at(-1), id('left')]);
    expect(await activity.hasTutorEnteredForLesson(id('early'), tutorId, at(0), at(10))).toBe(false);
  });
  test('no-show is evaluated at lesson end, evidence survives completion, and admin corrections are protected', async () => {
    await reconcile(at(24), async () => false);
    expect((await raw('missed')).attendanceTutor).toBeUndefined();
    await run("MATCH (b:Booking {bookingId: $id}) SET b.status = 'completed', b.attendanceTutor = 'absent', b.attendanceSource = 'automatic_room_no_show', b.tutorRoomEnteredAt = datetime($entry)", { id: id('history'), entry: at(15).toISOString() });
    await service.markTutorRoomEntry(id('admin'), tutorId, at(15));
    expect((await raw('admin')).attendanceTutor).toBe('absent');
    await reconcile(at(25), async () => false);
    expect((await raw('missed')).attendanceTutor).toBe('absent');
    expect((await raw('history')).attendanceTutor).toBe('present');
    expect((await raw('late')).attendanceTutor).toBe('present');
    expect((await raw('admin')).attendanceTutor).toBe('absent');
    expect(await reconcile(at(60), async () => false)).toBe(0);
  });
  test('a future test clock requires scope and cannot touch another tutor', async () => {
    await expect(service.reconcileMissedTutorRoomEntry(at(60), async () => false)).rejects.toThrow('explicit tutor scope');
    await run(`CREATE (:Booking {bookingId: $id, tutorId: $other, status: 'confirmed', durationMinutes: 25,
      attendanceAutoEnforce: true, slotDateTime: datetime($start)})-[:BOOKS]->(:TimeSlot {slotId: $id, status: 'booked'})`,
      { id: id('outside-scope'), other: id('other-tutor'), start: at(0).toISOString() });
    const checked: string[] = [];
    await reconcile(at(60), async bookingId => { checked.push(bookingId); return false; });
    expect(checked).not.toContain(id('outside-scope'));
    expect((await raw('outside-scope')).attendanceTutor).toBeUndefined();
  });
  test('repairs premature automatic no-shows without erasing audit history or manual decisions', async () => {
    const repairTutor = id('repair-tutor');
    await run('CREATE (:User {id: $tutor})', { tutor: repairTutor });
    for (const name of ['premature', 'premature-present', 'premature-manual', 'premature-admin']) {
      await run(`CREATE (b:Booking {bookingId: $id, tutorId: $tutor, status: 'confirmed', durationMinutes: 25,
        slotDateTime: datetime($start), attendanceTutor: 'absent', attendanceSource: 'automatic_room_no_show',
        tutorAttendancePolicyVersion: 2, penaltyCode: '301', penaltyReason: 'Automatic no-show', penaltyTimestamp: datetime($future)})
        -[:BOOKS]->(:TimeSlot {slotId: $id, status: 'booked'})
        CREATE (:Penalty {bookingId: $id, tutorId: $tutor, penaltyCode: '301', createdAt: datetime($future)})`,
        { id: id(name), tutor: repairTutor, start: at(0).toISOString(), future: at(25).toISOString() });
      if (name !== 'premature') await run(`CREATE (:LessonAttendanceAudit {id: $id, bookingId: $booking,
        actorRole: $role, subject: 'tutor', status: $status, createdAt: $now})`,
        { id: id(`${name}-audit`), booking: id(name), role: name === 'premature-admin' ? 'admin' : 'tutor',
          status: name === 'premature-present' ? 'present' : 'absent', now: new Date(Date.now() - 1000).toISOString() });
    }
    expect(await service.repairPrematureTutorRoomAbsence(repairTutor)).toBe(2);
    expect((await raw('premature')).penaltyCode).toBeUndefined();
    expect((await raw('premature')).attendanceTutor).toBeUndefined();
    expect((await raw('premature-present')).attendanceTutor).toBe('present');
    expect((await raw('premature-present')).attendanceSource).toBe('manual');
    expect((await raw('premature-manual')).penaltyCode).toBe('301');
    expect((await raw('premature-admin')).attendanceTutor).toBe('absent');
    const penalty = (await run('MATCH (p:Penalty {bookingId: $id}) RETURN p', { id: id('premature') })).records[0]!.get('p').properties;
    expect(penalty.status).toBe('voided');
    expect(penalty.revocationReason).toContain('before the scheduled lesson');
    expect(await service.repairPrematureTutorRoomAbsence(repairTutor)).toBe(0);
  });
});
