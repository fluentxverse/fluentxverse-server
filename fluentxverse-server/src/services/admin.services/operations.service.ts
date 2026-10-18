import type { ManagedTransaction } from 'neo4j-driver';
import { getDriver } from '../../db/memgraph';
import { query } from '../../db/postgres';
import { invalidateCache } from '../../db/redis';
import { adminCapabilities, operationsDates, plainNode, requiredReason } from '../../utils/adminOperations';
import { metricOutcome } from '../../utils/tutorPerformance';
import { summarizeLessonSurveys, surveyWindow } from '../../utils/lessonSurvey';
import { notesState, lessonNotice, invalidateLessonCaches, dispatchLessonNotices } from '../lessonWorkflow.service';
import { lessonIssueReviewService } from '../lessonIssueReview.service';
import { tutorPerformanceService } from '../tutorPerformance.service';
import { ClassroomActivityService } from '../classroomActivity.services/classroomActivity.service';
import { attendanceStartMs } from '../schedule.services/attendanceWindow';
import { assertStudentScheduleAvailable, assertTutorCanSchedule } from '../schedule.services/schedulingGuards';
import { canReserveForBooking, bookingCutoffMs } from '../schedule.services/bookingPolicy';
import { reconcileTutorPenaltyBlock } from '../schedule.services/tutorPenaltyBlock';
import { cancellationRefundService } from '../ticket.services/cancellationRefund.service';
import { getIO } from '../../socket/socket.server';
import { revokeLessonRoom } from '../../socket/revokeLessonRoom';
import { mediaObservations } from '../classroomMediaObservation.service';
import { emitSlotBooked, emitSlotCancelled } from '../../socket/handlers/schedule.handler';

async function audit(tx: ManagedTransaction, actorId: string, action: string, subjectId: string, reason: string, before: any, after: any) {
  await tx.run(`CREATE (:AdminOperationsAudit {id: $id, actorId: $actorId, action: $action, subjectId: $subjectId,
    reason: $reason, beforeJson: $before, afterJson: $after, createdAt: $at})`, {
    id: crypto.randomUUID(), actorId, action, subjectId, reason: requiredReason(reason),
    before: JSON.stringify(plainNode(before)), after: JSON.stringify(plainNode(after)), at: new Date().toISOString(),
  });
}
function person(n: any) {
  const p = n?.properties || n || {};
  return { id: p.id || p.userId, name: `${p.givenName || p.firstName || ''} ${p.familyName || p.lastName || ''}`.trim() || p.username || p.email || 'Unknown',
    email: p.email || '', country: p.country || '', englishLevel: p.englishLevel || null, bio: p.bio || '',
    isBlocked: Boolean(p.isBlocked), blockExpiresAt: plainNode(p.blockExpiresAt), isSuspended: Boolean(p.isSuspended),
    suspendedUntil: plainNode(p.suspendedUntil), suspendedReason: p.suspendedReason || '', purpose: p.purpose || '',
    occupation: p.occupation || '', hobbies: p.hobbies || '', lessonSetup: p.lessonSetup || '', correctionStyle: p.correctionStyle || '' };
}
export class AdminOperationsService {
  async access(id: string) {
    const db = getDriver().session();
    try {
      const row = (await db.run('MATCH (a:Admin {id: $id}) RETURN a', { id })).records[0];
      if (!row) throw new Error('Admin account is no longer active');
      const a = row.get('a').properties;
      return { id, role: a.role || 'admin', permissions: adminCapabilities(a) };
    } finally { await db.close(); }
  }
  async list(options: { from?: string; to?: string; search?: string; tutorId?: string; studentId?: string; view?: string; page?: number } = {}) {
    const range = operationsDates(options.from, options.to), now = Date.now(), page = Number(options.page || 1);
    if (!Number.isInteger(page) || page < 1) throw new Error('Invalid page');
    const db = getDriver().session();
    try {
      const result = await db.run(`MATCH (b:Booking) WHERE b.slotDateTime >= datetime($from) AND b.slotDateTime < datetime($to)
        AND ($tutorId = '' OR b.tutorId = $tutorId) AND ($studentId = '' OR b.studentId = $studentId)
        OPTIONAL MATCH (b)-[:BOOKED_BY]->(s:Student)
        OPTIONAL MATCH (t:User {id: b.tutorId}) RETURN b, s, t ORDER BY b.slotDateTime DESC`,
        { ...range, tutorId: options.tutorId || '', studentId: options.studentId || '' });
      let rows = result.records.map(r => {
        const raw = r.get('b').properties, b = plainNode(raw), state = notesState(raw, now);
        return { ...b, tutor: person(r.get('t')), student: person(r.get('s')), outcome: metricOutcome(b, now), notes: state,
          surveyEligible: surveyWindow(b, now).eligible };
      });
      const search = (options.search || '').toLowerCase();
      rows = rows.filter(b => !search || `${b.bookingId} ${b.tutor.name} ${b.student.name} ${b.tutor.email} ${b.student.email}`.toLowerCase().includes(search));
      if (options.view === 'live') rows = rows.filter(b => ['confirmed', 'completed'].includes(b.status) && Date.parse(b.slotDateTime) <= now + 15 * 60000 && now < Date.parse(b.notes.endsAt) + 3 * 60000);
      if (options.view === 'notes') rows = rows.filter(b => now >= Date.parse(b.notes.endsAt) && !['not_required', 'submitted'].includes(b.notes.notesStatus));
      const total = rows.length, selected = rows.slice((page - 1) * 50, page * 50);
      if (options.view === 'live') for (const b of selected) {
        let sockets: any[] = [];
        try { sockets = await getIO()?.in(b.bookingId).fetchSockets() || []; } catch {}
        b.presence = sockets.filter(s => ['student', 'tutor'].includes(s.data.userType)).map(s => ({ role: s.data.userType, callState: s.data.callState || 'unknown', callUpdatedAt: s.data.callUpdatedAt || null }));
        const tutorPresent = b.presence.some((p: any) => p.role === 'tutor');
        b.alert = !tutorPresent && now >= Date.parse(b.slotDateTime) + 3 * 60000 ? 'Tutor missing from room' : now >= Date.parse(b.notes.endsAt) ? 'Wrap-up' : now < Date.parse(b.slotDateTime) ? 'Starting soon' : 'In progress';
        if (!tutorPresent && now >= Date.parse(b.slotDateTime) && now < Date.parse(b.notes.endsAt)) {
          const evidence = await new ClassroomActivityService().getTutorPresenceForLesson(b.bookingId, b.tutorId, new Date(b.slotDateTime), new Date(now));
          if (evidence.leftAt && now >= evidence.leftAt + 60000) b.alert = 'Tutor disconnected for over 60 seconds';
        }
      }
      return { rows: selected, total, page, totalPages: Math.ceil(total / 50), range, serverNow: new Date(now).toISOString() };
    } finally { await db.close(); }
  }
  async slots(from?: string, to?: string, tutorId = '') {
    const range = operationsDates(from, to), db = getDriver().session();
    try {
      const result = await db.run(`MATCH (s:TimeSlot) WHERE s.slotDate >= $start AND s.slotDate <= $finish AND ($tutorId = '' OR s.tutorId = $tutorId)
        OPTIONAL MATCH (t:User {id: s.tutorId}) RETURN s, t ORDER BY s.slotDate, s.slotTime`, { ...range, tutorId });
      return result.records.map(r => ({ ...plainNode(r.get('s').properties), startsAt: new Date(attendanceStartMs({ date: r.get('s').properties.slotDate, time: r.get('s').properties.slotTime })).toISOString(), tutor: person(r.get('t')) })).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    } finally { await db.close(); }
  }
  async detail(bookingId: string, permissions: string[]) {
    const db = getDriver().session();
    try {
      const row = (await db.run(`MATCH (b:Booking {bookingId: $bookingId}) OPTIONAL MATCH (b)-[:BOOKED_BY]->(s:Student)
        OPTIONAL MATCH (t:User {id: b.tutorId}) RETURN b, s, t`, { bookingId })).records[0];
      if (!row) throw new Error('Lesson not found');
      const raw = row.get('b').properties, booking = plainNode(raw);
      const nodes = async (label: string, property = 'sessionId') => (await db.run(`MATCH (n:${label} {${property}: $bookingId}) RETURN n`, { bookingId })).records.map(r => plainNode(r.get('n').properties));
      const survey = (await nodes('LessonSurvey', 'bookingId'))[0] || null;
      if (survey && !permissions.includes('qa')) delete survey.comment;
      const materialRequest = (await nodes('ClassroomLessonSelection'))[0] || null;
      const activity = await new ClassroomActivityService().getSessionActivity(bookingId, 1000);
      const presence = (await query('SELECT user_type, joined_at, left_at, last_seen_at, is_active FROM session_participants WHERE session_id = $1 ORDER BY joined_at', [bookingId])).rows;
      const reports = (await lessonIssueReviewService.list()).filter((r: any) => r.bookingId === bookingId);
      const recordings = permissions.includes('qa') ? (await query('SELECT id, booking_id, local_status, expires_at FROM qa_recordings WHERE booking_id = $1', [bookingId])).rows : [];
      return { booking, tutor: person(row.get('t')), student: person(row.get('s')), notesState: notesState(raw),
        outcome: metricOutcome(booking, Date.now()), materialRequest, materials: await nodes('ClassroomMaterialNote'),
        summary: (await nodes('ClassroomLessonNote'))[0] || null, published: (await nodes('PublishedLessonNotes'))[0] || null,
        versions: await nodes('LessonNoteVersion'), activity, presence, mediaObservations: await mediaObservations(bookingId), reports, survey, recordings,
        penalties: await nodes('Penalty', 'bookingId'), transactions: permissions.includes('finance') ? await nodes('TicketTransaction', 'bookingId') : [],
        attendanceHistory: await lessonIssueReviewService.attendanceHistory(bookingId), audits: await this.audits(bookingId) };
    } finally { await db.close(); }
  }
  async metrics(tutorId: string, period = 'month', month?: string, page = 1) { return tutorPerformanceService.get(tutorId, period, month, page); }
  async penaltyPreview(penaltyId: string) {
    const db = getDriver().session();
    try {
      const p = (await db.run('MATCH (p:Penalty {penaltyId: $penaltyId}) RETURN p', { penaltyId })).records[0]?.get('p').properties;
      if (!p) throw new Error('Penalty not found');
      const current = await tutorPerformanceService.get(p.tutorId, 'all');
      const proposed = await tutorPerformanceService.get(p.tutorId, 'all', undefined, 1, [penaltyId]);
      return { current: current.reliability.score, proposed: proposed.reliability.score, cancellationBefore: current.cancellation.rate, cancellationAfter: proposed.cancellation.rate };
    } finally { await db.close(); }
  }
  async surveys(from?: string, to?: string, tutorId = '', comments = false) {
    const range = operationsDates(from, to), db = getDriver().session();
    try {
      const result = await db.run(`MATCH (b:Booking) WHERE b.slotDateTime >= datetime($from) AND b.slotDateTime < datetime($to)
        AND ($tutorId = '' OR b.tutorId = $tutorId) OPTIONAL MATCH (s:LessonSurvey {bookingId: b.bookingId})
        OPTIONAL MATCH (t:User {id: b.tutorId}) RETURN b, s, t ORDER BY b.slotDateTime DESC`, { ...range, tutorId });
      const now = Date.now(), rows = result.records.filter(r => r.get('s')).map(r => ({ ...plainNode(r.get('s').properties), tutor: person(r.get('t')), startsAt: plainNode(r.get('b').properties.slotDateTime) }));
      if (!comments) for (const row of rows) delete row.comment;
      const opportunities = result.records.filter(r => r.get('s') || surveyWindow(r.get('b').properties, now).reason === null || surveyWindow(r.get('b').properties, now).reason === 'closed').length;
      return { ...summarizeLessonSurveys(rows), opportunities, responseRate: opportunities ? Math.round(rows.length / opportunities * 1000) / 10 : null, rows };
    } finally { await db.close(); }
  }
  async people(role: string, id: string, permissions: string[]) {
    if (!['tutor', 'student'].includes(role)) throw new Error('Invalid account type');
    const db = getDriver().session();
    try {
      const row = (await db.run(`MATCH (p:${role === 'tutor' ? 'User' : 'Student'} {id: $id}) RETURN p`, { id })).records[0];
      if (!row) throw new Error('Account not found');
      const bookings = await db.run(`MATCH (b:Booking) WHERE ${role === 'tutor' ? 'b.tutorId' : 'b.studentId'} = $id RETURN b ORDER BY b.slotDateTime DESC LIMIT 200`, { id });
      const lessons = bookings.records.map(r => ({ ...plainNode(r.get('b').properties), outcome: metricOutcome(plainNode(r.get('b').properties), Date.now()), notes: notesState(r.get('b').properties) }));
      const penalties = role === 'tutor' ? (await db.run('MATCH (p:Penalty {tutorId: $id}) RETURN p ORDER BY p.createdAt DESC', { id })).records.map(r => plainNode(r.get('p').properties)) : [];
      const notes = role === 'student' ? (await db.run('MATCH (b:Booking {studentId: $id}) MATCH (n:ClassroomMaterialNote {sessionId: b.bookingId}) WHERE n.isUsed = true RETURN n ORDER BY n.updatedAt DESC LIMIT 200', { id })).records.map(r => plainNode(r.get('n').properties)) : [];
      const transactions = permissions.includes('finance') ? (await db.run('MATCH (t:TicketTransaction {studentId: $id}) RETURN t ORDER BY t.createdAt DESC LIMIT 200', { id })).records.map(r => plainNode(r.get('t').properties)) : [];
      return { person: person(row.get('p')), role, lessons, penalties, progress: notes, transactions,
        reports: (await lessonIssueReviewService.list()).filter((r: any) => lessons.some(b => b.bookingId === r.bookingId)),
        performance: role === 'tutor' ? await this.metrics(id, 'all') : null };
    } finally { await db.close(); }
  }
  async audits(subjectId = '') {
    const db = getDriver().session();
    try {
      const result = await db.run(`MATCH (a) WHERE (a:AdminOperationsAudit OR a:LessonAttendanceAudit OR a:SuspensionHistory OR a:SuspensionLog)
        OPTIONAL MATCH (owner)-[:HAS_SUSPENSION_HISTORY|HAS_SUSPENSION]->(a)
        OPTIONAL MATCH (a)-[:SUSPENDED_BY|UNSUSPENDED_BY]->(actor:Admin)
        WITH a, owner, actor WHERE $subjectId = '' OR a.subjectId = $subjectId OR a.bookingId = $subjectId OR a.targetId = $subjectId OR owner.id = $subjectId
        RETURN a, owner.id AS ownerId, actor.id AS actorId ORDER BY a.createdAt DESC LIMIT 500`, { subjectId });
      const history = result.records.map(r => { const a = plainNode(r.get('a').properties); delete a.snapshotJson; return { ...a, subjectId: a.subjectId || r.get('ownerId') || a.bookingId, actorId: a.actorId || r.get('actorId') }; });
      const cases = (await lessonIssueReviewService.list()).filter((r: any) => !subjectId || r.bookingId === subjectId);
      for (const r of cases) for (const h of [...r.internalHistory, ...r.reviewHistory]) history.push({ ...h, action: h.comment ? 'issue_internal_update' : 'issue_review', subjectId: r.bookingId, createdAt: h.at || h.createdAt });
      return history.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 500);
    } finally { await db.close(); }
  }
  async payments(from?: string, to?: string) {
    const range = operationsDates(from, to), db = getDriver().session();
    try {
      const rows = (await db.run(`MATCH (t:TicketTransaction) WHERE toString(t.createdAt) >= $from AND toString(t.createdAt) < $to RETURN t ORDER BY t.createdAt DESC`, range)).records.map(r => plainNode(r.get('t').properties));
      const review = (await db.run(`MATCH (b:Booking) WHERE b.refundStatus IN ['pending', 'review'] RETURN b ORDER BY b.cancelledAt DESC LIMIT 200`)).records.map(r => plainNode(r.get('b').properties));
      return { rows, review };
    } finally { await db.close(); }
  }
  async reopen(bookingId: string, actorId: string, hours: number, reason: string) {
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error('Reopening must be between 1 and 168 hours.');
    const db = getDriver().session();
    try {
      await db.executeWrite(async tx => {
        const row = (await tx.run('MATCH (b:Booking {bookingId: $bookingId}) SET b.lessonNotesWriteVersion = coalesce(b.lessonNotesWriteVersion, 0) + 1 RETURN b', { bookingId })).records[0];
        if (!row) throw new Error('Lesson not found');
        const b = row.get('b').properties, state = notesState(b);
        if (Date.now() < Date.parse(state.endsAt) || state.notesStatus === 'not_required') throw new Error('Only ended, non-absent lessons can be reopened.');
        const until = new Date(Date.now() + hours * 3600000).toISOString();
        await tx.run('MATCH (b:Booking {bookingId: $bookingId}) SET b.notesReopenedUntil = $until, b.notesReminderStage = null', { bookingId, until });
        await audit(tx, actorId, 'notes_reopened', bookingId, reason, { editableUntil: state.editableUntil }, { editableUntil: until });
        await lessonNotice(tx, `notes:${bookingId}:reopen:${until}`, b.tutorId, 'tutor', bookingId, 'Lesson notes reopened', `An administrator reopened your lesson notes until ${until}.`);
      });
      await dispatchLessonNotices(); await invalidateLessonCaches(bookingId);
    } finally { await db.close(); }
  }
  async changePenalty(penaltyId: string, actorId: string, reason: string) {
    const db = getDriver().session();
    try {
      await db.executeWrite(async tx => {
        const row = (await tx.run('MATCH (p:Penalty {penaltyId: $penaltyId}) RETURN p', { penaltyId })).records[0];
        if (!row) throw new Error('Penalty not found');
        const p = row.get('p').properties;
        if (p.revokedAt || p.status === 'voided') return;
        if (p.penaltyCode === '601') throw new Error('Use Remove booking restriction for block penalties.');
        await tx.run('MATCH (t:User {id: $id}) SET t.scheduleWriteVersion = coalesce(t.scheduleWriteVersion, 0) + 1', { id: p.tutorId });
        await tx.run("MATCH (p:Penalty {penaltyId: $penaltyId}) SET p.status = 'voided', p.revokedAt = $now, p.revocationReason = $reason", { penaltyId, now: new Date().toISOString(), reason: requiredReason(reason) });
        await audit(tx, actorId, 'penalty_revoked', p.bookingId || p.tutorId, reason, p, { status: 'voided' });
        await reconcileTutorPenaltyBlock(tx, p.tutorId, true);
        if (p.bookingId) await tx.run('MATCH (b:Booking {bookingId: $bookingId}) WHERE b.penaltyCode = $code REMOVE b.penaltyCode, b.penaltyReason, b.penaltyTimestamp', { bookingId: p.bookingId, code: p.penaltyCode });
        if (p.slotId) await tx.run('MATCH (s:TimeSlot {slotId: $slotId}) WHERE s.penaltyCode = $code REMOVE s.penaltyCode, s.penaltyReason', { slotId: p.slotId, code: p.penaltyCode });
        await lessonNotice(tx, `notes:penalty:${penaltyId}:revoked`, p.tutorId, 'tutor', p.bookingId || '', 'Penalty revoked', reason);
      });
      await invalidateCache('tutor:search:*'); await dispatchLessonNotices();
    } finally { await db.close(); }
  }
  async unblock(tutorId: string, actorId: string, reason: string) {
    const db = getDriver().session();
    try {
      await db.executeWrite(async tx => {
        const row = (await tx.run('MATCH (t:User {id: $tutorId}) SET t.scheduleWriteVersion = coalesce(t.scheduleWriteVersion, 0) + 1 RETURN t', { tutorId })).records[0];
        if (!row) throw new Error('Tutor not found');
        await tx.run('MATCH (t:User {id: $tutorId}) SET t.isBlocked = false, t.penaltyBlockOverrideUntil = datetime($until) REMOVE t.blockExpiresAt', { tutorId, until: new Date(Date.now() + 7 * 86400000).toISOString() });
        await tx.run("MATCH (p:Penalty {tutorId: $tutorId, penaltyCode: '601'}) WHERE p.revokedAt IS NULL SET p.status = 'voided', p.revokedAt = $now, p.revocationReason = $reason", { tutorId, now: new Date().toISOString(), reason: requiredReason(reason) });
        await audit(tx, actorId, 'booking_block_removed', tutorId, reason, { isBlocked: row.get('t').properties.isBlocked }, { isBlocked: false });
        await lessonNotice(tx, `notes:unblock:${tutorId}:${crypto.randomUUID()}`, tutorId, 'tutor', '', 'Booking restriction removed', reason);
      });
      await invalidateCache('tutor:search:*'); await dispatchLessonNotices();
    } finally { await db.close(); }
  }
  async schedule(bookingId: string, actorId: string, action: 'cancel' | 'reschedule', reason: string, targetSlotId?: string) {
    const db = getDriver().session();
    let transition: any;
    try {
      await db.executeWrite(async tx => {
        const initial = (await tx.run('MATCH (b:Booking {bookingId: $bookingId}) RETURN b', { bookingId })).records[0]?.get('b').properties;
        if (!initial) throw new Error('Lesson not found');
        // Lock the same tutor and student nodes as ordinary booking/reservation flows.
        await tx.run('MATCH (t:User {id: $id}) SET t.scheduleWriteVersion = coalesce(t.scheduleWriteVersion, 0) + 1', { id: initial.tutorId });
        await tx.run('MATCH (s:Student {id: $id}) SET s.bookingWriteVersion = coalesce(s.bookingWriteVersion, 0) + 1', { id: initial.studentId });
        const row = (await tx.run(`MATCH (b:Booking {bookingId: $bookingId})-[:BOOKS]->(old:TimeSlot)
          SET b.lessonNotesWriteVersion = coalesce(b.lessonNotesWriteVersion, 0) + 1 RETURN b, old`, { bookingId })).records[0];
        if (!row) throw new Error('Lesson slot not found');
        const b = row.get('b').properties, now = Date.now();
        transition = { tutorId: b.tutorId, studentId: b.studentId, old: plainNode(row.get('old').properties) };
        if (b.status !== 'confirmed' || b.slotDateTime.toStandardDate().getTime() <= now) throw new Error('Only future confirmed lessons can be changed.');
        let after: any;
        if (action === 'reschedule') {
          if (b.slotDateTime.toStandardDate().getTime() <= now + 5 * 60000) throw new Error('Rescheduling closes five minutes before the lesson.');
          const target = (await tx.run("MATCH (s:TimeSlot {slotId: $targetSlotId, tutorId: $tutorId, status: 'open'}) RETURN s", { targetSlotId: targetSlotId || '', tutorId: b.tutorId })).records[0]?.get('s').properties;
          if (!target || target.slotId === b.slotId) throw new Error('Choose an open slot from the same tutor.');
          const start = attendanceStartMs({ date: target.slotDate, time: target.slotTime });
          transition.target = plainNode(target);
          if (!canReserveForBooking(start, now, target.attendanceMarked === 'present')) throw new Error('The target slot has passed its booking deadline.');
          await assertTutorCanSchedule(tx, b.tutorId);
          await assertStudentScheduleAvailable(tx, b.studentId, target);
          const changed = await tx.run(`MATCH (b:Booking {bookingId: $bookingId})-[rel:BOOKS]->(old:TimeSlot), (s:TimeSlot {slotId: $targetSlotId, status: 'open', tutorId: $tutorId})
            WHERE b.status = 'confirmed' AND datetime() < datetime($sourceDeadline)
              AND datetime() < datetime($targetDeadline)
            SET s.status = 'booked', s.studentId = b.studentId, old.status = 'open', old.studentId = null,
              b.slotId = s.slotId, b.slotDateTime = datetime($start), b.durationMinutes = s.durationMinutes, b.rescheduledAt = datetime(),
              b.notesReminderStage = null, b.updatedAt = datetime()
            REMOVE b.attendanceTutor, b.attendanceStudent, b.surveyReadyAt, b.surveyReadyReason, b.tutorJoinedAt, b.tutorFirstEnteredAt, b.tutorRoomEnteredAt, b.tutorRoomAttendedAt
            DELETE rel CREATE (b)-[:BOOKS]->(s) RETURN b`, { bookingId, targetSlotId, tutorId: b.tutorId, start: new Date(start).toISOString(), sourceDeadline: new Date(b.slotDateTime.toStandardDate().getTime() - 5 * 60000).toISOString(), targetDeadline: new Date(bookingCutoffMs(start, target.attendanceMarked === 'present')).toISOString() });
          if (!changed.records.length) throw new Error('The selected slot was taken. Choose another slot.');
          after = plainNode(changed.records[0]!.get('b').properties);
        } else {
          const cancelled = await tx.run(`MATCH (b:Booking {bookingId: $bookingId})-[:BOOKS]->(s:TimeSlot)
            WHERE b.status = 'confirmed' AND b.slotDateTime > datetime()
            SET b.status = 'cancelled', b.cancelledAt = datetime(),
            b.cancelledBy = $actorId, b.cancellationReason = $reason,
            b.refundStatus = CASE WHEN b.paymentMethod = 'trial' THEN 'not_required' ELSE 'pending' END, b.cancellationRefundVersion = 1,
            s.status = 'open', s.studentId = null RETURN b`, { bookingId, actorId, reason: requiredReason(reason) });
          if (!cancelled.records.length) throw new Error('The lesson has started and cannot be cancelled.');
          after = { status: 'cancelled' };
        }
        await audit(tx, actorId, action, bookingId, reason, b, after);
        for (const [id, role] of [[b.studentId, 'student'], [b.tutorId, 'tutor']]) await lessonNotice(tx, `notes:${bookingId}:${action}:${crypto.randomUUID()}`, id, role, bookingId, action === 'cancel' ? 'Lesson cancelled by support' : 'Lesson rescheduled', reason);
      });
      try { revokeLessonRoom(getIO(), bookingId); } catch {}
      const io = getIO();
      if (io && transition) {
        emitSlotCancelled(io, transition.tutorId, { slotKey: transition.old.slotId, date: transition.old.slotDate, time: transition.old.slotTime });
        if (transition.target) emitSlotBooked(io, transition.tutorId, { slotKey: transition.target.slotId, bookingId, studentId: transition.studentId, date: transition.target.slotDate, time: transition.target.slotTime });
      }
      await dispatchLessonNotices(); await invalidateLessonCaches(bookingId);
      await invalidateCache('tutor:search:*');
      if (action === 'cancel') await cancellationRefundService.process(bookingId);
    } finally { await db.close(); }
  }
  async refund(bookingId: string, actorId: string, reason: string) {
    const db = getDriver().session();
    try {
      await db.executeWrite(async tx => {
        const row = (await tx.run('MATCH (b:Booking {bookingId: $bookingId}) SET b.refundWriteVersion = coalesce(b.refundWriteVersion, 0) + 1 RETURN b', { bookingId })).records[0];
        if (!row) throw new Error('Lesson not found');
        const b = row.get('b').properties;
        if (b.paymentMethod === 'trial') throw new Error('Free trial lessons have no paid credit to refund');
        if (Date.now() < Date.parse(notesState(b).endsAt) && b.status !== 'cancelled') throw new Error('Refunds require an ended or cancelled lesson.');
        if (b.refunded) return;
        if (b.privatePassReservationId) {
          const pass = (await tx.run('MATCH (r:LessonPassReservation {id:$id}) RETURN r.status AS status', { id: b.privatePassReservationId })).records[0];
          if (pass?.get('status') !== 'booked') throw new Error('This pass is already finalizing or finalized; reconcile its existing operation.');
        }
        // Never erase an uncertain dispatch or create a new identifier for the same refund.
        if (b.refundStatus === 'review') throw new Error('This refund has an uncertain transfer outcome. Verify the existing transaction before retrying.');
        if (b.status === 'cancelled' && Number(b.cancellationRefundVersion) !== 1) throw new Error('Historical cancellation requires transfer-history verification.');
        await tx.run(`MATCH (b:Booking {bookingId: $bookingId}) SET b.refundApprovedBy = $actorId, b.refundApprovalReason = $reason,
          b.refundStatus = 'pending', b.cancellationRefundVersion = 1`, { bookingId, actorId, reason: requiredReason(reason) });
        await audit(tx, actorId, 'refund_approved', bookingId, reason, { refundStatus: b.refundStatus || null }, { refundStatus: 'pending' });
      });
      return cancellationRefundService.process(bookingId);
    } finally { await db.close(); }
  }
  async admins() {
    const db = getDriver().session();
    try { return (await db.run('MATCH (a:Admin) RETURN a ORDER BY a.username')).records.map(r => ({ ...person(r.get('a')), username: r.get('a').properties.username, role: r.get('a').properties.role, permissions: adminCapabilities(r.get('a').properties) })); }
    finally { await db.close(); }
  }
  async permissions(id: string, actorId: string, permissions: string[], reason: string) {
    if (permissions.some(p => !['support', 'qa', 'operations', 'finance'].includes(p))) throw new Error('Invalid permissions');
    const db = getDriver().session();
    try {
      await db.executeWrite(async tx => {
        const row = (await tx.run('MATCH (a:Admin {id: $id}) RETURN a', { id })).records[0];
        if (!row || row.get('a').properties.role === 'superadmin') throw new Error('Superadmin permissions cannot be changed.');
        await tx.run('MATCH (a:Admin {id: $id}) SET a.permissions = $permissions', { id, permissions });
        await audit(tx, actorId, 'permissions_changed', id, reason, adminCapabilities(row.get('a').properties), permissions);
      });
    } finally { await db.close(); }
  }
}
export const adminOperationsService = new AdminOperationsService();
