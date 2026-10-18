import { getDriver } from '../db/memgraph';
import type { ManagedTransaction } from 'neo4j-driver';
import { lessonNotesEditWindow, LessonNotesReadOnly } from '../utils/lessonNotesEditWindow';
import { assertLessonFeedback, LessonFeedbackInvalid } from '../utils/lessonFeedbackValidation';
import { getIO } from '../socket/socket.server';
import { invalidateCache } from '../db/redis';

export function lessonOutcome(booking: Record<string, any>) {
  if (booking.status === 'cancelled') return 'cancelled';
  if (booking.attendanceTutor === 'absent') return 'tutor_absent';
  if (booking.attendanceTutor === 'present') return 'attended';
  if (booking.attendanceStudent === 'absent') return 'student_absent';
  return 'awaiting_verification';
}
export function notesState(booking: Record<string, any>, now = Date.now()) {
  const start = booking.slotDateTime.toStandardDate().toISOString();
  const window = lessonNotesEditWindow(start, Number(booking.durationMinutes) || 25, booking.status, now, booking.notesReopenedUntil);
  return { ...window, attendanceVerified: booking.attendanceStudent === 'present',
    studentAttendance: booking.attendanceStudent === 'absent' ? 'absent' : 'present',
    outcome: lessonOutcome(booking), notesStatus: booking.attendanceStudent === 'absent' || booking.attendanceTutor === 'absent' || booking.status === 'cancelled'
      ? 'not_required' : booking.notesSubmittedAt ? (booking.notesDraftDirty ? 'changes_pending' : 'submitted') : 'draft',
    submittedAt: booking.notesSubmittedAt || null, closed: !window.canEdit && window.reason !== 'not_started' };
}

// Notifications and workflow writes share a transaction, so retries cannot lose or duplicate notices.
export async function lessonNotice(tx: ManagedTransaction, key: string, userId: string, userType: string, bookingId: string, title: string, message: string) {
  await tx.run(`MERGE (n:Notification {id: $key}) ON CREATE SET n.userId = $userId, n.userType = $userType,
    n.type = 'system', n.title = $title, n.message = $message, n.timestamp = $now, n.isRead = false, n.data = $data`,
    { key, userId, userType, title, message, now: new Date().toISOString(), data: JSON.stringify({ bookingId, link: bookingId ? `/lesson/${encodeURIComponent(bookingId)}` : '/schedule' }) });
}

export async function dispatchLessonNotices() {
  let io;
  try { io = getIO(); } catch { return; }
  if (!io) return;
  const session = getDriver().session();
  try {
    const result = await session.run(`MATCH (n:Notification) WHERE n.dispatchedAt IS NULL
      AND (n.id STARTS WITH 'notes:' OR n.id STARTS WITH 'notes-reminder:' OR n.id STARTS WITH 'report:') RETURN n LIMIT 200`);
    for (const row of result.records) {
      const n = row.get('n').properties;
      io.to(`notifications:${n.userId}`).emit('notification:new', { ...n, data: JSON.parse(n.data || '{}') });
      await session.run('MATCH (n:Notification {id: $id}) SET n.dispatchedAt = datetime()', { id: n.id });
    }
  } finally { await session.close(); }
}

export async function invalidateLessonCaches(bookingId: string) {
  const session = getDriver().session();
  try {
    const row = (await session.run('MATCH (:Booking {bookingId: $bookingId})-[:BOOKED_BY]->(s:Student) RETURN s.id AS id', { bookingId })).records[0];
    if (!row) return;
    const id = row.get('id');
    for (const key of [`student:bookings:${id}`, `student:stats:${id}`, `student:activity:${id}:*`]) await invalidateCache(key);
  } finally { await session.close(); }
}

export class LessonWorkflowService {
  async owned(bookingId: string, userId: string, role: 'tutor' | 'student') {
    const session = getDriver().session();
    try {
      const result = await session.run(role === 'tutor'
        ? 'MATCH (b:Booking {bookingId: $bookingId, tutorId: $userId}) RETURN b'
        : 'MATCH (b:Booking {bookingId: $bookingId})-[:BOOKED_BY]->(:Student {id: $userId}) RETURN b', { bookingId, userId });
      if (!result.records[0]) throw new LessonNotesReadOnly('Lesson not found or you do not have access');
      return result.records[0].get('b').properties;
    } finally { await session.close(); }
  }

  async get(bookingId: string, userId: string, role: 'tutor' | 'student') {
    const booking = await this.owned(bookingId, userId, role);
    return notesState(booking);
  }

  async submit(bookingId: string, tutorId: string) {
    const session = getDriver().session();
    try {
      await session.executeWrite(async tx => {
        const locked = await tx.run(`MATCH (b:Booking {bookingId: $bookingId, tutorId: $tutorId})
          SET b.lessonNotesWriteVersion = coalesce(b.lessonNotesWriteVersion, 0) + 1 RETURN b`, { bookingId, tutorId });
        const b = locked.records[0]?.get('b').properties;
        if (!b) throw new LessonNotesReadOnly('Lesson not found or you do not have access');
        const state = notesState(b);
        if (!state.canEdit || Date.now() < Date.parse(state.endsAt)) throw new LessonNotesReadOnly('Submit notes after the scheduled lesson ends and within 48 hours.');
        if (state.notesStatus === 'not_required') throw new LessonNotesReadOnly('Notes are not required for an absent or cancelled lesson.');
        if (b.notesSubmittedAt && !b.notesDraftDirty) return;
        const saved = await tx.run(`MATCH (b:Booking {bookingId: $bookingId})
          OPTIONAL MATCH (n:ClassroomMaterialNote {sessionId: $bookingId})
          WITH b, collect(n) AS materials OPTIONAL MATCH (summary:ClassroomLessonNote {sessionId: $bookingId})
          RETURN b, materials, summary`, { bookingId });
        const row = saved.records[0]!;
        const materials = row.get('materials').map((node: any) => node.properties).filter((n: any) => n.isUsed || n.hasContent);
        const summary = row.get('summary')?.properties || {};
        assertLessonFeedback(summary.studentComment || '', summary.tutorMemo || '');
        for (const n of materials) {
          if (n.materialType !== 'daily-dispatch' && n.completionStatus !== 'completed' && (!n.stoppedAt || !n.stoppedAtLabel))
            throw new LessonFeedbackInvalid(`Choose a stopping point for ${n.materialTitle || 'each in-progress material'}.`,
              { field: 'stoppingPoint', materialType: n.materialType, materialId: n.materialId });
        }
        const version = Number(b.lessonNotesWriteVersion) || 0;
        const now = new Date().toISOString();
        await tx.run(`MATCH (b:Booking {bookingId: $bookingId})
          SET b.notesSubmittedAt = $now, b.notesSubmittedBy = $tutorId, b.notesDraftDirty = false,
            b.attendanceStudent = 'present', b.studentAttendanceUpdatedAt = datetime(), b.studentAttendanceUpdatedBy = $tutorId,
            b.status = 'completed', b.lessonOutcome = $outcome, b.attendanceStatus = $attendance, b.updatedAt = datetime()
          MERGE (published:PublishedLessonNotes {sessionId: $bookingId})
          SET published.snapshotJson = $snapshot, published.submittedAt = $now
          CREATE (:LessonNoteVersion {id: $auditId, sessionId: $bookingId, snapshotJson: $snapshot, submittedAt: $now, actorId: $tutorId})
          CREATE (:LessonAttendanceAudit {id: $auditId, bookingId: $bookingId, actorId: $tutorId,
            actorRole: 'tutor', previousStatus: $previous, status: 'present', reason: 'Lesson notes submitted; attendance confirmed', createdAt: $now})`,
          { bookingId, tutorId, now, snapshot: JSON.stringify({ materials, summary }), outcome: b.attendanceTutor === 'present' ? 'attended' : 'awaiting_verification',
            attendance: b.attendanceTutor === 'present' ? 'present' : null,
            auditId: crypto.randomUUID(), previous: b.attendanceStudent || 'unset' });
        const student = await tx.run('MATCH (:Booking {bookingId: $bookingId})-[:BOOKED_BY]->(s:Student) RETURN s.id AS id', { bookingId });
        const studentId = student.records[0]?.get('id');
        if (studentId) await lessonNotice(tx, `notes:${bookingId}:${version}`, studentId, 'student', bookingId, 'Lesson feedback ready', 'Your tutor has submitted your lesson notes.');
      });
      await dispatchLessonNotices();
      await invalidateLessonCaches(bookingId);
      return notesState(await this.owned(bookingId, tutorId, 'tutor'));
    } finally { await session.close(); }
  }

  async pending(tutorId: string) {
    const session = getDriver().session();
    try {
      const result = await session.run(`MATCH (b:Booking {tutorId: $tutorId})-[:BOOKED_BY]->(s:Student)
        WHERE b.status IN ['confirmed', 'completed'] AND b.slotDateTime <= datetime()
          AND coalesce(b.attendanceStudent, '') <> 'absent' AND coalesce(b.attendanceTutor, '') <> 'absent'
          AND (b.notesSubmittedAt IS NULL OR b.notesDraftDirty = true)
        RETURN b, coalesce(s.firstName, s.givenName, 'Student') AS name ORDER BY b.slotDateTime DESC LIMIT 100`, { tutorId });
      return result.records.map(row => ({ bookingId: row.get('b').properties.bookingId, studentName: row.get('name'), ...notesState(row.get('b').properties) }))
        .filter(row => Date.parse(row.endsAt) <= Date.now());
    } finally { await session.close(); }
  }

  async continuations(bookingId: string, userId: string, role: 'student' | 'tutor') {
    await this.owned(bookingId, userId, role);
    const session = getDriver().session();
    try {
      const result = await session.run(`MATCH (current:Booking {bookingId: $bookingId})-[:BOOKED_BY]->(s:Student)
        MATCH (b:Booking)-[:BOOKED_BY]->(s) WHERE b.slotDateTime < current.slotDateTime
          AND b.status IN ['confirmed', 'completed'] AND coalesce(b.attendanceStudent, '') <> 'absent'
          AND coalesce(b.attendanceTutor, '') <> 'absent'
        MATCH (n:ClassroomMaterialNote {sessionId: b.bookingId})
        WHERE n.isUsed = true AND n.materialType <> 'daily-dispatch' AND n.completionStatus IN ['in_progress', 'completed']
        RETURN n, b.slotDateTime AS startsAt ORDER BY b.slotDateTime DESC, n.updatedAt DESC LIMIT 200`, { bookingId });
      const seen = new Set<string>();
      return result.records.flatMap(row => {
        const n = row.get('n').properties;
        const key = `${n.materialType}:${n.materialId}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return n.completionStatus === 'in_progress' ? [{ materialType: n.materialType, materialId: n.materialId,
          materialTitle: n.materialTitle || 'Lesson material', stoppedAt: n.stoppedAt || null,
          stoppedAtLabel: n.stoppedAtLabel || 'Stopping point not recorded', progressDetails: n.progressDetails || '',
          previousLessonId: n.sessionId }] : [];
      }).slice(0, 10);
    } finally { await session.close(); }
  }

  async reconcile(now = Date.now(), bookingIds?: string[]) {
    const session = getDriver().session();
    try {
      const result = await session.run(`MATCH (b:Booking) WHERE b.status IN ['confirmed', 'completed']
        AND b.slotDateTime <= datetime($now) AND ($ids IS NULL OR b.bookingId IN $ids)
        AND (b.status = 'confirmed' OR b.notesReminderStage IS NULL OR b.notesReminderStage <> 'overdue')
        RETURN b ORDER BY b.slotDateTime DESC`, { now: new Date(now).toISOString(), ids: bookingIds || null });
      for (const row of result.records) {
        const b = row.get('b').properties;
        const state = notesState(b, now);
        if (now < Date.parse(state.endsAt)) continue;
        await session.executeWrite(async tx => {
          const locked = await tx.run(`MATCH (b:Booking {bookingId: $id}) WHERE b.status IN ['confirmed', 'completed']
            SET b.lessonNotesWriteVersion = coalesce(b.lessonNotesWriteVersion, 0) + 1 RETURN b`, { id: b.bookingId });
          const current = locked.records[0]?.get('b').properties;
          if (!current) return;
          const currentState = notesState(current, now);
          await tx.run(`MATCH (b:Booking {bookingId: $id}) SET b.status = 'completed', b.lessonOutcome = $outcome,
            b.attendanceStatus = $attendance, b.finalizedAt = coalesce(b.finalizedAt, $now)`,
            { id: b.bookingId, outcome: currentState.outcome, attendance: currentState.outcome === 'attended' ? 'present' : currentState.outcome.endsWith('_absent') ? 'absent' : null, now: new Date(now).toISOString() });
          const stage = currentState.notesStatus === 'not_required' || currentState.notesStatus === 'submitted' ? 'overdue'
            : now >= Date.parse(state.editableUntil) ? 'overdue' : now >= Date.parse(state.editableUntil) - 24 * 3600_000 ? 'due_soon' : 'pending';
          if (stage !== current.notesReminderStage && currentState.notesStatus !== 'not_required' && currentState.notesStatus !== 'submitted') {
            await lessonNotice(tx, `notes-reminder:${b.bookingId}:${stage}`, b.tutorId, 'tutor', b.bookingId,
              stage === 'overdue' ? 'Lesson notes overdue' : stage === 'due_soon' ? 'Lesson notes due within 24 hours' : 'Submit lesson notes',
              stage === 'overdue' ? 'The lesson notes update window has closed. Contact support for a correction.' : 'Complete and submit the feedback for your ended lesson.');
          }
          await tx.run('MATCH (b:Booking {bookingId: $id}) SET b.notesReminderStage = $stage', { id: b.bookingId, stage });
        });
        if (b.status === 'confirmed') await invalidateLessonCaches(b.bookingId);
      }
    } finally { await session.close(); }
  }
}

export const lessonWorkflowService = new LessonWorkflowService();
