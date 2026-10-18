import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import Elysia from 'elysia';
import Tutor from '../src/routes/tutor.route';
import { signAuthToken } from '../src/utils/jwt';
import { closeDriver, getDriver, initDriver } from '../src/db/memgraph';
import { ClassroomNotesService } from '../src/services/classroomNotes.services/classroomNotes.service';

const uri = process.env.LESSON_NOTES_TEST_URI;
const suite = uri ? describe : describe.skip;
const fixtureId = `lesson-notes-test-${crypto.randomUUID()}`;
const tutorId = `${fixtureId}-tutor`;
const otherTutorId = `${fixtureId}-other-tutor`;
const bookingId = (day: number) => `${fixtureId}-booking-${day}`;
const structuredBookingId = `${fixtureId}-structured-booking`;
const summaryBookingId = `${fixtureId}-summary-booking`;
const absenceBookingId = `${fixtureId}-absence-booking`;
const recentBookingId = (day: number) => `${fixtureId}-recent-${day}`;
const service = new ClassroomNotesService();
const feedback = (text: string) => text.padEnd(100, '.');

suite('lesson notes history (local Memgraph)', () => {
  beforeAll(async () => {
    await initDriver(uri!, process.env.MEMGRAPH_USER || 'fluentxverse', process.env.MEMGRAPH_PASSWORD || '', 1);
    const session = getDriver().session();
    try {
      await session.run(
        `CREATE (:User {id: $tutorId, firstName: 'Test', lastName: 'Tutor', lessonNotesTestId: $fixtureId}),
                (:User {id: $otherTutorId, givenName: 'Other', familyName: 'Tutor', lessonNotesTestId: $fixtureId}),
                (:Student {id: $studentId, lessonNotesTestId: $fixtureId})`,
        { tutorId, otherTutorId, studentId: `${fixtureId}-student`, fixtureId },
      );
      const fixtures = Array.from({ length: 10 }, (_, index) => {
        const day = index + 1;
        return {
          bookingId: bookingId(day), tutorId: day % 2 === 0 ? otherTutorId : tutorId,
          startsAt: `2026-09-${String(day).padStart(2, '0')}T12:00:00Z`,
          status: day === 7 ? 'cancelled' : 'completed',
          studentComment: day === 8 || day === 6 ? '' : `Feedback ${day}`,
          tutorMemo: day === 8 ? '  ' : `Handoff ${day}`,
          updatedAt: `2026-10-${String(11 - day).padStart(2, '0')}T12:00:00Z`,
        };
      });
      await session.run(
        `UNWIND $fixtures AS row
         MATCH (student:Student {id: $studentId})
         CREATE (booking:Booking {bookingId: row.bookingId, tutorId: row.tutorId,
                 slotDateTime: datetime(row.startsAt), status: row.status, lessonNotesTestId: $fixtureId})-[:BOOKED_BY]->(student)
         CREATE (:ClassroomMaterialNote {id: row.bookingId, sessionId: row.bookingId,
                 studentComment: row.studentComment, tutorMemo: row.tutorMemo,
                 createdAt: row.startsAt, updatedAt: row.updatedAt, lessonNotesTestId: $fixtureId})`,
        { fixtures, studentId: `${fixtureId}-student`, fixtureId },
      );
      await session.run(
        `CREATE (:ClassroomMaterialNote {id: $id, sessionId: $sessionId, studentComment: 'Second material',
                 tutorMemo: '', createdAt: '2026-09-09T12:01:00Z', updatedAt: '2026-09-09T12:01:00Z', lessonNotesTestId: $fixtureId})`,
        { id: `${fixtureId}-second-material`, sessionId: bookingId(9), fixtureId },
      );
      await session.run(
        `CREATE (student:Student {id: $studentId, lessonNotesTestId: $fixtureId})
         CREATE (:Booking {bookingId: $bookingId, tutorId: $tutorId, slotDateTime: datetime('2026-09-08T13:00:00Z'),
                 status: 'completed', lessonNotesTestId: $fixtureId})-[:BOOKED_BY]->(student)
         CREATE (:ClassroomMaterialNote {id: $bookingId, sessionId: $bookingId, studentComment: 'Another student',
                 tutorMemo: 'Private to that student', createdAt: '2026-09-08T13:00:00Z', lessonNotesTestId: $fixtureId})`,
        { studentId: `${fixtureId}-unrelated-student`, bookingId: `${fixtureId}-unrelated-booking`, tutorId, fixtureId },
      );
      await session.run(
        `CREATE (student:Student {id: $studentId, lessonNotesTestId: $fixtureId})
         CREATE (:Booking {bookingId: $bookingId, tutorId: $tutorId, slotDateTime: datetime($startsAt),
                 status: 'completed', lessonNotesTestId: $fixtureId})-[:BOOKED_BY]->(student)
         CREATE (:Booking {bookingId: $summaryBookingId, tutorId: $tutorId, slotDateTime: datetime($startsAt),
                 status: 'completed', lessonNotesTestId: $fixtureId})-[:BOOKED_BY]->(student)
         CREATE (:DispatchArticle {id: $articleId, title: 'Article title from catalog', lessonNotesTestId: $fixtureId})
         CREATE (:LessonMaterial {id: $lessonId, lessonName: 'Introductions', lessonNumber: 2, level: 3, chapter: 1, lessonNotesTestId: $fixtureId})`,
        { studentId: `${fixtureId}-structured-student`, bookingId: structuredBookingId, summaryBookingId, startsAt: new Date(Date.now() - 60 * 60_000).toISOString(), tutorId,
          articleId: `${fixtureId}-article`, lessonId: `${fixtureId}-lesson`, fixtureId },
      );
      await session.run(
        `MATCH (note:ClassroomMaterialNote {sessionId: $bookingId})
         SET note.vocabularyItemsJson = $emptyWords`,
        { bookingId: bookingId(8), emptyWords: JSON.stringify([{word: '  ', definitions: []}]) },
      );
      await session.run(
        `CREATE (:Student {id: $studentId, lessonNotesTestId: $fixtureId})`,
        {studentId: `${fixtureId}-recent-student`, fixtureId},
      );
      const recentBookings = Array.from({length: 17}, (_, index) => {
        const day = index + 1;
        return {id: recentBookingId(day), tutorId: day % 2 ? tutorId : otherTutorId,
          startsAt: `${day === 17 ? '2099' : '2020'}-08-${String(day).padStart(2,'0')}T12:00:00Z`,
          status: day === 16 ? 'cancelled' : 'completed'};
      });
      await session.run(
        `UNWIND $bookings AS row
         MATCH (student:Student {id: $studentId})
         CREATE (:Booking {bookingId:row.id, tutorId:row.tutorId, slotDateTime:datetime(row.startsAt),
                 durationMinutes:30, attendanceStudent:'present', status:row.status,
                 lessonNotesTestId:$fixtureId})-[:BOOKED_BY]->(student)`,
        {bookings:recentBookings, studentId:`${fixtureId}-recent-student`, fixtureId},
      );
      await session.run(
        `CREATE (:ClassroomMaterialNote {id:$id, sessionId:$sessionId, studentComment:'Feedback from another tutor',
                 tutorMemo:'Review the previous material', lessonNotesTestId:$fixtureId})`,
        {id:`${fixtureId}-recent-note`, sessionId:recentBookingId(14), fixtureId},
      );
    } finally { await session.close(); }
  });

  afterAll(async () => {
    const session = getDriver().session();
    try {
      await session.run('MATCH (note:ClassroomMaterialNote {sessionId: $bookingId}) DETACH DELETE note', { bookingId: structuredBookingId });
      await session.run('MATCH (note:ClassroomMaterialNote) WHERE note.sessionId STARTS WITH $fixtureId DETACH DELETE note', { fixtureId });
      await session.run('MATCH (note:ClassroomLessonNote) WHERE note.sessionId STARTS WITH $fixtureId DETACH DELETE note', { fixtureId });
      await session.run('MATCH (audit:LessonAttendanceAudit) WHERE audit.bookingId STARTS WITH $fixtureId DETACH DELETE audit', { fixtureId });
      await session.run('MATCH (note:PublishedLessonNotes) WHERE note.sessionId STARTS WITH $fixtureId DETACH DELETE note', { fixtureId });
      await session.run('MATCH (node {lessonNotesTestId: $fixtureId}) DETACH DELETE node', { fixtureId });
    } finally {
      await session.close();
      await closeDriver();
    }
  });

  test('unmarked attendance defaults to present without changing the stored booking', async () => {
    expect((await service.getEditWindow(structuredBookingId, tutorId)).studentAttendance).toBe('present');
    expect((await service.getLessonNotes(structuredBookingId, tutorId)).studentAttendance).toBe('present');
    expect((await service.listLessonNotes(bookingId(9), tutorId, 'current'))[0]?.studentAttendance).toBe('present');
    const session = getDriver().session();
    try {
      const result = await session.run('MATCH (b:Booking {bookingId:$id}) RETURN b.attendanceStudent AS attendance', { id: structuredBookingId });
      expect(result.records[0]!.get('attendance')).toBeNull();
    } finally { await session.close(); }
  });

  test('current groups multiple material notes into one lesson', async () => {
    const entries = await service.listLessonNotes(bookingId(9), tutorId, 'current');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.tutorName).toBe('Test Tutor');
    expect(entries[0]!.startsAt).toBe('2026-09-09T12:00:00.000Z');
    expect(entries[0]!.notes.map(note => note.studentComment)).toEqual(['Feedback 9', 'Second material']);
  });

  test('recent includes the current lesson and empty lessons, ordered by latest lesson rather than edit date', async () => {
    const entries = await service.listLessonNotes(bookingId(9), tutorId, 'recent');
    expect(entries.map(entry => entry.sessionId)).toEqual([10, 9, 8, 6, 5, 4, 3, 2, 1].map(bookingId));
    expect(entries[0]!.tutorName).toBe('Other Tutor');
    expect(entries[2]!.notes).toEqual([]);
    expect(entries[3]!.notes[0]!.studentComment).toBe('');
    expect(entries[3]!.notes[0]!.tutorMemo).toBe('Handoff 6');
  });

  test('recent is capped at ten bookings, including lessons without any note node and notes by other tutors', async () => {
    const entries = await service.listLessonNotes(recentBookingId(15), tutorId, 'recent');
    expect(entries.map(entry=>entry.sessionId)).toEqual([15,14,13,12,11,10,9,8,7,6].map(recentBookingId));
    expect(entries[0]!.notes).toEqual([]);
    expect(entries[0]!.durationMinutes).toBe(30);
    expect(entries[0]!.studentAttendance).toBe('present');
    expect(entries[1]!.tutorName).toBe('Other Tutor');
    expect(entries[1]!.notes[0]!.studentComment).toBe('Feedback from another tutor');
    // An older opened lesson must not move ahead of the student's newer lessons.
    expect((await service.listLessonNotes(recentBookingId(1), tutorId, 'recent'))[0]!.sessionId).toBe(recentBookingId(15));
  });

  test('my notes includes the current lesson and only this tutor, newest first', async () => {
    const entries = await service.listLessonNotes(bookingId(9), tutorId, 'mine');
    expect(entries.map(entry => entry.sessionId)).toEqual([9, 5, 3, 1].map(bookingId));
    expect((await service.listLessonNotes(bookingId(1), tutorId, 'mine'))[0]!.sessionId).toBe(bookingId(9));
    const pending = await service.listLessonNotes(recentBookingId(15), tutorId, 'mine');
    expect(pending.map(entry => entry.sessionId)).toEqual([15, 13, 11, 9, 7, 5, 3, 1].map(recentBookingId));
    expect(pending.every(entry => entry.tutorName === 'Test Tutor')).toBe(true);
    expect(pending[0]!.notes).toEqual([]);
  });

  test('first two uses lesson chronology rather than the note edit date', async () => {
    const entries = await service.listLessonNotes(bookingId(9), tutorId, 'first');
    expect(entries.map(entry => entry.sessionId)).toEqual([1, 2].map(bookingId));
    const pending = await service.listLessonNotes(recentBookingId(1), tutorId, 'first');
    expect(pending.map(entry => entry.sessionId)).toEqual([1, 2].map(recentBookingId));
    expect(pending.map(entry => entry.tutorName)).toEqual(['Test Tutor', 'Other Tutor']);
    expect(pending.every(entry => entry.notes.length === 0)).toBe(true);
  });

  test('cannot access history through another tutor booking', async () => {
    for (const tab of ['current', 'recent', 'mine', 'first'] as const) {
      expect(await service.listLessonNotes(bookingId(9), otherTutorId, tab)).toEqual([]);
    }
  });

  test('missing bookings and lessons without meaningful comments have empty results', async () => {
    expect(await service.listLessonNotes(`${fixtureId}-missing`, tutorId, 'recent')).toEqual([]);
    expect(await service.listLessonNotes(bookingId(8), otherTutorId, 'current')).toEqual([]);
  });

  test('persists full structured notes and material title, including hidden widget fields', async () => {
    const input = {
      sessionId: structuredBookingId, tutorId, materialType: 'daily-dispatch', materialId: `${fixtureId}-article`,
      articleId: `${fixtureId}-article`, materialTitle: 'Title at lesson time',
      vocabularyItems: [{ word: 'implications', definitions: [], selectedDefinitionIndex: 0,
        isLoading: false, showDefinition: false, showTranslation: false }],
      grammarItems: [{ youSaid: 'I want to ate.', correct: 'I want to eat.', simpleExplanation: '',
        technicalExplanation: '', isLoading: false, showExplanation: false }],
      pronunciationItems: [{ word: 'lasagna', phonetic: 'luh-ZAHN-yuh', isLoading: false, showPhonetic: false }],
      studentComment: 'Good work!\nKeep practicing.', tutorMemo: 'Review verb forms next time.',
    };
    await service.saveNotes(input);
    const saved = await service.getNotes(structuredBookingId, input.materialType, input.materialId);
    expect(saved?.materialTitle).toBe(input.materialTitle);
    const entries = await service.listLessonNotes(structuredBookingId, tutorId, 'current');
    const note = entries[0]!.notes.find(note => note.materialId === input.materialId)!;
    expect(note.materialTitle).toBe(input.materialTitle);
    expect(note.vocabularyItems).toEqual(input.vocabularyItems);
    expect(note.grammarItems).toEqual(input.grammarItems);
    expect(note.pronunciationItems).toEqual(input.pronunciationItems);
    expect(note.studentComment).toBe(input.studentComment);
    expect(note.tutorMemo).toBe(input.tutorMemo);
    await service.saveNotes({ ...input, materialTitle: undefined });
    expect((await service.getNotes(structuredBookingId, input.materialType, input.materialId))?.materialTitle).toBe(input.materialTitle);
  });

  test('shows vocabulary, grammar, or pronunciation without comments and resolves legacy catalog titles', async () => {
    const session = getDriver().session();
    try {
      await session.run(
        `UNWIND $notes AS row
         CREATE (:ClassroomMaterialNote {id: row.id, sessionId: $sessionId, materialType: row.type,
                 materialId: row.materialId, vocabularyItemsJson: row.words, grammarItemsJson: row.grammar,
                 pronunciationItemsJson: row.pronunciation, studentComment: '', tutorMemo: '',
                 createdAt: '2026-09-09T12:00:00Z'})`,
        { sessionId: structuredBookingId, notes: [
          {id: `${fixtureId}-words-only`, type: 'business-english', materialId: `${fixtureId}-lesson`,
            words: JSON.stringify([{word: 'frontier'}]), grammar: '[]', pronunciation: '[]'},
          {id: `${fixtureId}-grammar-only`, type: 'conversational-skills', materialId: `${fixtureId}-lesson`,
            words: '[]', grammar: JSON.stringify([{youSaid: 'I gone.', correct: 'I went.'}]), pronunciation: '[]'},
          {id: `${fixtureId}-pronunciation-only`, type: 'daily-dispatch', materialId: `${fixtureId}-article`,
            words: '[]', grammar: '[]', pronunciation: JSON.stringify([{word: 'frontier', phonetic: '[fruhn-TEER]'}])},
          {id: `${fixtureId}-empty-default`, type: 'daily-dispatch', materialId: `${fixtureId}-article`,
            words: JSON.stringify([{word: ''}]), grammar: JSON.stringify([{youSaid: '', correct: ''}]), pronunciation: '[]'},
        ] },
      );
    } finally { await session.close(); }
    const notes = (await service.listLessonNotes(structuredBookingId, tutorId, 'current'))[0]!.notes;
    expect(notes.find(note => note.id === `${fixtureId}-words-only`)?.materialTitle).toBe('Lesson 2: Introductions');
    expect(notes.find(note => note.id === `${fixtureId}-grammar-only`)?.grammarItems[0]?.correct).toBe('I went.');
    expect(notes.find(note => note.id === `${fixtureId}-grammar-only`)).toMatchObject({ materialLevel: 3, materialChapter: 1 });
    for (const tab of ['current', 'recent', 'mine', 'first'] as const) {
      const entry = (await service.listLessonNotes(structuredBookingId, tutorId, tab)).find(entry => entry.sessionId === structuredBookingId);
      expect(entry?.notes.find(note => note.id === `${fixtureId}-grammar-only`)).toMatchObject({ materialLevel: 3, materialChapter: 1 });
    }
    expect(notes.find(note => note.id === `${fixtureId}-pronunciation-only`)?.materialTitle).toBe('Article title from catalog');
    expect(notes.find(note => note.id === `${fixtureId}-empty-default`)).toBeUndefined();
    expect(await service.listLessonNotes(structuredBookingId, otherTutorId, 'current')).toEqual([]);
  });

  test('classroom API accepts nullable and omitted material IDs and returns saved notes on the lesson API', async () => {
    const app = new Elysia().use(Tutor);
    const token = await signAuthToken({userId: tutorId, email: 'lesson-notes-test@example.com', role: 'tutor'});
    const headers = { cookie: `tutorAuth=${token}`, 'Content-Type': 'application/json' };
    for (const type of ['daily-dispatch', 'conversational-skills', 'business-english']) {
      for (const nullable of [true, false]) {
        const materialId = `${fixtureId}-api-${type}-${nullable}`;
        const body = {
          materialType: type, materialId, materialTitle: `${type} API regression`,
          ...(nullable ? {courseId: null, lessonId: null, articleId: null} : {}),
          vocabularyItems: [{word: 'frontier'}], grammarItems: [], pronunciationItems: [],
          studentComment: 'Student feedback through the API', tutorMemo: 'Private handoff through the API',
        };
        const response = await app.handle(new Request(`http://localhost/tutor/classroom-notes/${structuredBookingId}`, {
          method: 'PUT', headers, body: JSON.stringify(body),
        }));
        expect(response.status).toBe(200);
        const saved = await response.json() as { success: boolean; data: { lessonId: string | null } };
        expect(saved.success).toBe(true);
        expect(saved.data.lessonId).toBeNull();
        const lessonResponse = await app.handle(new Request(`http://localhost/tutor/lesson-notes/${structuredBookingId}?tab=current`, {headers}));
        expect(lessonResponse.status).toBe(200);
        const lesson = await lessonResponse.json() as { data: { notes: any[] }[] };
        expect(lesson.data[0]!.notes.find((note: any) => note.materialId === materialId)).toMatchObject({
          materialTitle: body.materialTitle, vocabularyItems: body.vocabularyItems,
          studentComment: body.studentComment, tutorMemo: body.tutorMemo,
        });
      }
    }
  });

  test('previewing is not usage; explicit use and learning notes retain multiple curricula independently', async () => {
    const base = { sessionId: structuredBookingId, tutorId, vocabularyItems: [], grammarItems: [], pronunciationItems: [] };
    const preview = { ...base, materialType: 'daily-dispatch', materialId: `${fixtureId}-preview` };
    await service.saveNotes(preview);
    let notes = (await service.getLessonNotes(structuredBookingId, tutorId)).materials;
    expect(notes.some(note => note.materialId === preview.materialId)).toBe(false);
    await service.saveNotes({ ...preview, isUsed: true, materialTitle: 'Used article without notes' });
    const learned = { ...base, materialType: 'business-english', materialId: `${fixtureId}-business-a`, materialTitle: 'Business A', vocabularyItems: [{ word: 'collaboration' }] as any[] };
    await service.saveNotes(learned);
    await service.saveNotes({ ...base, materialType: 'business-english', materialId: `${fixtureId}-business-b`, materialTitle: 'Business B', isUsed: true });
    notes = (await service.getLessonNotes(structuredBookingId, tutorId)).materials;
    expect(notes.find(note => note.materialId === learned.materialId)?.vocabularyItems[0]?.word).toBe('collaboration');
    expect(notes.filter(note => [preview.materialId, learned.materialId, `${fixtureId}-business-b`].includes(note.materialId))).toHaveLength(3);
    expect(notes.find(note => note.materialId === preview.materialId)?.isUsed).toBe(true);
    await service.saveNotes({ ...learned, vocabularyItems: [] });
    expect((await service.getLessonNotes(structuredBookingId, tutorId)).materials.find(note => note.materialId === learned.materialId)?.isUsed).toBe(true);
  });

  test('lesson feedback is shared, preserves legacy fields, and clearing a handoff does not resurrect it', async () => {
    const legacy = { sessionId: structuredBookingId, tutorId, materialType: 'daily-dispatch', materialId: `${fixtureId}-legacy-summary`, vocabularyItems: [], grammarItems: [], pronunciationItems: [], studentComment: 'Legacy feedback', tutorMemo: 'Legacy handoff' };
    await service.saveNotes(legacy);
    await service.saveNotes({ ...legacy, studentComment: undefined, tutorMemo: undefined });
    expect((await service.getNotes(structuredBookingId, legacy.materialType, legacy.materialId))?.studentComment).toBe('Legacy feedback');
    await service.saveLessonNotes(structuredBookingId, tutorId, feedback('One lesson feedback'), 'One lesson handoff', 200);
    await service.saveLessonNotes(structuredBookingId, tutorId, feedback('Stale feedback'), 'Stale handoff', 100);
    const summary = await service.getLessonNotes(structuredBookingId, tutorId);
    expect(summary.studentComment).toBe(feedback('One lesson feedback'));
    expect(summary.tutorMemo).toBe('One lesson handoff');
    expect(summary.materials.length).toBeGreaterThan(1);
    expect((await service.getNotes(structuredBookingId, legacy.materialType, legacy.materialId))?.tutorMemo).toBe('Legacy handoff');
    await expect(service.saveLessonNotes(structuredBookingId, tutorId, '', '', 300)).rejects.toThrow('100 characters');
    await service.saveLessonNotes(structuredBookingId, tutorId, feedback('One lesson feedback'), '', 300);
    expect((await service.getLessonNotes(structuredBookingId, tutorId)).studentComment).toBe(feedback('One lesson feedback'));
    expect((await service.getLessonNotes(structuredBookingId, tutorId)).tutorMemo).toBe('');
  });

  test('delayed material saves cannot overwrite newer notes, including exit flushes', async () => {
    const base = { sessionId: structuredBookingId, tutorId, materialType: 'conversational-skills', materialId: `${fixtureId}-versioned`, vocabularyItems: [], grammarItems: [], pronunciationItems: [] };
    await service.saveNotes({ ...base, clientUpdatedAt: 200, grammarItems: [{ youSaid: 'Latest', correct: 'Latest correction' }] as any[] });
    await service.saveNotes({ ...base, clientUpdatedAt: 100 });
    expect((await service.getNotes(structuredBookingId, base.materialType, base.materialId))?.grammarItems[0]?.correct).toBe('Latest correction');
  });

  test('lesson summary API supports feedback-only lessons and enforces booking ownership', async () => {
    const app = new Elysia().use(Tutor);
    const token = await signAuthToken({ userId: tutorId, email: 'notes-test@example.com', role: 'tutor' });
    const other = await signAuthToken({ userId: otherTutorId, email: 'other-notes-test@example.com', role: 'tutor' });
    const url = `http://localhost/tutor/classroom-lesson-notes/${summaryBookingId}`;
    const headers = { cookie: `tutorAuth=${token}`, 'Content-Type': 'application/json' };
    const body = JSON.stringify({ studentComment: feedback('Feedback without material notes'), tutorMemo: 'Shared handoff', clientUpdatedAt: 100 });
    expect((await app.handle(new Request(url, { method: 'PUT', headers, body }))).status).toBe(200);
    const loaded = await (await app.handle(new Request(url, { headers }))).json() as { data: { materials: unknown[]; studentComment: string } };
    expect(loaded.data.materials).toEqual([]);
    expect(loaded.data.studentComment).toBe(feedback('Feedback without material notes'));
    expect((await service.listLessonNotes(summaryBookingId, tutorId, 'current'))[0]?.tutorMemo).toBe('Shared handoff');
    for (const method of ['GET', 'PUT']) {
      expect((await app.handle(new Request(url, { method, ...(method === 'PUT' ? { headers: { 'Content-Type': 'application/json' }, body } : {}) }))).status).toBe(401);
      expect((await app.handle(new Request(url, { method, headers: { ...headers, cookie: `tutorAuth=${other}` }, ...(method === 'PUT' ? { body } : {}) }))).status).toBe(403);
    }
  });

  test('lesson assessment persists through history, preserves omitted values, and supports clearing', async () => {
    const app = new Elysia().use(Tutor);
    const token = await signAuthToken({ userId: tutorId, email: 'assessment-test@example.com', role: 'tutor' });
    const headers = { cookie: `tutorAuth=${token}`, 'Content-Type': 'application/json' };
    const url = `http://localhost/tutor/classroom-lesson-notes/${summaryBookingId}`;
    const put = (assessment: Record<string, unknown>, clientUpdatedAt: number) => app.handle(new Request(url, {
      method: 'PUT', headers, body: JSON.stringify({ studentComment: feedback('Good work.'), tutorMemo: '', clientUpdatedAt, ...assessment }),
    }));
    expect((await put({ englishLevelAssessment: 4 }, 200)).status).toBe(200);
    expect((await service.getLessonNotes(summaryBookingId, tutorId)).englishLevelAssessment).toBe(4);
    for (const tab of ['current', 'recent', 'mine', 'first'] as const) {
      expect((await service.listLessonNotes(summaryBookingId, tutorId, tab)).find(entry => entry.sessionId === summaryBookingId)?.englishLevelAssessment).toBe(4);
    }
    // Classroom autosave and older clients omit this field, rather than clearing it.
    expect((await put({}, 300)).status).toBe(200);
    expect((await service.getLessonNotes(summaryBookingId, tutorId)).englishLevelAssessment).toBe(4);
    expect((await put({ englishLevelAssessment: 8 }, 100)).status).toBe(200);
    expect((await service.getLessonNotes(summaryBookingId, tutorId)).englishLevelAssessment).toBe(4);
    for (const level of [0, 11, 2.5, 'Level 4']) {
      expect((await put({ englishLevelAssessment: level }, 400)).status).toBe(422);
    }
    expect((await put({ englishLevelAssessment: null }, 500)).status).toBe(200);
    expect((await service.getLessonNotes(summaryBookingId, tutorId)).englishLevelAssessment).toBeNull();
    const other = await signAuthToken({ userId: otherTutorId, email: 'other-assessment-test@example.com', role: 'tutor' });
    expect((await app.handle(new Request(url, { method: 'PUT', headers: { ...headers, cookie: `tutorAuth=${other}` },
      body: JSON.stringify({ studentComment: 'Not allowed', tutorMemo: '', englishLevelAssessment: 10 }) }))).status).toBe(403);
  });

  test('summary API enforces feedback and handoff limits without changing saved notes', async () => {
    const app = new Elysia().use(Tutor);
    const token = await signAuthToken({ userId: tutorId, email: 'limits-test@example.com', role: 'tutor' });
    const headers = { cookie: `tutorAuth=${token}`, 'Content-Type': 'application/json' };
    const url = `http://localhost/tutor/classroom-lesson-notes/${summaryBookingId}`;
    const put = (studentComment: string, tutorMemo: string) => app.handle(new Request(url, {
      method: 'PUT', headers, body: JSON.stringify({ studentComment, tutorMemo, clientUpdatedAt: 600 }),
    }));
    expect((await put('a'.repeat(100), 'b'.repeat(150))).status).toBe(200);
    for (const [studentComment, tutorMemo, warning] of [
      ['a'.repeat(99), '', '100 characters'],
      [` ${'a'.repeat(99)} `, '', '100 characters'],
      ['a'.repeat(100), 'b'.repeat(151), '150 characters'],
    ]) {
      const response = await put(studentComment!, tutorMemo!);
      expect(response.status).toBe(400);
      expect((await response.json() as { error: string }).error).toContain(warning!);
      const saved = await service.getLessonNotes(summaryBookingId, tutorId);
      expect(saved.studentComment).toBe('a'.repeat(100));
      expect(saved.tutorMemo).toBe('b'.repeat(150));
    }
    expect((await put('a'.repeat(100), '')).status).toBe(200);
    expect((await service.getLessonNotes(summaryBookingId, tutorId)).tutorMemo).toBe('');
  });

  test('saves per-material completion and stopping points, preserves them for older clients, and clears them on completion', async () => {
    const input = { sessionId: structuredBookingId, tutorId, materialType: 'business-english', materialId: `${fixtureId}-progress-be`, vocabularyItems: [], grammarItems: [], pronunciationItems: [], isUsed: true };
    await service.saveNotes({ ...input, completionStatus: 'in_progress', stoppedAt: 'understand', progressDetails: 'Stopped before question 3' });
    const saved = await service.getNotes(structuredBookingId, input.materialType, input.materialId);
    expect(saved?.completionStatus).toBe('in_progress');
    expect(saved?.stoppedAtLabel).toBe('Part 3 - Comprehension');
    expect(saved?.progressDetails).toBe('Stopped before question 3');
    expect((await service.getLessonNotes(structuredBookingId, tutorId)).materials.find(note => note.materialId === input.materialId)?.stoppedAt).toBe('understand');
    await service.saveNotes(input);
    expect((await service.getNotes(structuredBookingId, input.materialType, input.materialId))?.stoppedAt).toBe('understand');
    for (const stoppedAt of ['discussion', 'feedback']) {
      await expect(service.saveNotes({ ...input, completionStatus: 'in_progress', stoppedAt })).rejects.toThrow('Open Talk and Wrap-up');
    }
    await service.saveNotes({ ...input, completionStatus: 'completed', stoppedAt: 'understand', progressDetails: 'Old point' });
    const complete = await service.getNotes(structuredBookingId, input.materialType, input.materialId);
    expect(complete?.completionStatus).toBe('completed');
    expect(complete?.stoppedAt).toBeNull();
    expect(complete?.stoppedAtLabel).toBeNull();
    expect(complete?.progressDetails).toBe('');
  });

  test('Daily Dispatch is always completed, even if a client requests in-progress or a stopping point', async () => {
    const input = { sessionId: structuredBookingId, tutorId, materialType: 'daily-dispatch', materialId: `${fixtureId}-progress-dispatch`, vocabularyItems: [], grammarItems: [], pronunciationItems: [], isUsed: true, completionStatus: 'in_progress' as const, stoppedAt: 'discussion', progressDetails: 'Unfinished' };
    const saved = await service.saveNotes(input);
    expect(saved.completionStatus).toBe('completed');
    expect(saved.stoppedAt).toBeNull();
    expect(saved.progressDetails).toBe('');
  });

  test('continuation uses the latest prior booking with the same student and material, across tutors', async () => {
    const session = getDriver().session();
    const materialId = `${fixtureId}-continuation-cs`;
    try {
      await session.run(`UNWIND $bookings AS row MATCH (b:Booking {bookingId: row.id})
        SET b.slotDateTime = datetime(row.startsAt)`, { bookings: [13, 14, 15].map((day, index) => ({ id: recentBookingId(day), startsAt: new Date(Date.now() - (3 - index) * 3600_000).toISOString() })) });
      await session.run(`CREATE (:LessonMaterial {id: $materialId, course: 'conversational-skills', lessonNotesTestId: $fixtureId,
        exerciseData: $exerciseData, missionData: $missionData})`, { materialId, fixtureId, exerciseData: JSON.stringify({ sectionNumber: 4, sectionTitle: 'Practice', hasStepB: true }), missionData: JSON.stringify({ sectionNumber: 5, sectionTitle: 'Challenge 1' }) });
    } finally { await session.close(); }
    const base = { materialType: 'conversational-skills', materialId, studentId: `${fixtureId}-recent-student`, vocabularyItems: [], grammarItems: [], pronunciationItems: [], isUsed: true };
    await service.saveNotes({ ...base, sessionId: recentBookingId(13), tutorId, completionStatus: 'in_progress', stoppedAt: 'exerciseData.stepA' });
    await service.saveNotes({ ...base, sessionId: recentBookingId(14), tutorId: otherTutorId, completionStatus: 'in_progress', stoppedAt: 'exerciseData.stepB', progressDetails: 'Resume from item 2' });
    // Editing the older lesson later must not move it ahead of the newer booking.
    await service.saveNotes({ ...base, sessionId: recentBookingId(13), tutorId, completionStatus: 'in_progress', stoppedAt: 'learn' });
    const next = await service.getMaterialProgress(recentBookingId(15), tutorId, base.materialType, materialId);
    expect(next.previous?.sessionId).toBe(recentBookingId(14));
    expect(next.previous?.stoppedAtLabel).toBe('Part 4 - Practice - Step B');
    expect(next.previous?.progressDetails).toBe('Resume from item 2');
    expect(next.sections.some(section => section.id === 'exerciseData.stepA')).toBe(true);
    for (const stoppedAt of ['missionData', 'missionData2', 'missionData3', 'feedbackData']) {
      await expect(service.saveNotes({ ...base, sessionId: recentBookingId(15), tutorId, completionStatus: 'in_progress', stoppedAt })).rejects.toThrow('Parts 5 and 6');
    }
    expect((await service.getMaterialProgress(bookingId(9), tutorId, base.materialType, materialId)).previous).toBeNull();
    await expect(service.getMaterialProgress(recentBookingId(15), otherTutorId, base.materialType, materialId)).rejects.toThrow('do not have access');
    const edited = getDriver().session();
    try {
      await edited.run('MATCH (lesson:LessonMaterial {id: $materialId}) SET lesson.exerciseData = $exerciseData', { materialId, exerciseData: JSON.stringify({ sectionNumber: 4, sectionTitle: 'Updated practice', hasStepB: false }) });
    } finally { await edited.close(); }
    // A removed section remains a valid historical stopping point for this student.
    const resumed = await service.saveNotes({ ...base, sessionId: recentBookingId(15), tutorId, completionStatus: 'in_progress', stoppedAt: 'exerciseData.stepB', progressDetails: 'Resume from item 2' });
    expect(resumed.stoppedAtLabel).toBe('Part 4 - Practice - Step B');
    expect((await service.getMaterialProgress(recentBookingId(15), tutorId, base.materialType, materialId)).sections.some(section => section.id === 'exerciseData.stepB')).toBe(false);
    await expect(service.saveNotes({ ...base, sessionId: bookingId(9), tutorId, completionStatus: 'in_progress', stoppedAt: 'exerciseData.stepB' })).rejects.toThrow('Choose a stopping point');
    await service.saveNotes({ ...base, sessionId: recentBookingId(14), tutorId: otherTutorId, completionStatus: 'completed' });
    expect((await service.getMaterialProgress(recentBookingId(15), tutorId, base.materialType, materialId)).previous?.completionStatus).toBe('completed');
  });

  test('progress API rejects invalid sections and restricts access to the owned lesson', async () => {
    const app = new Elysia().use(Tutor);
    const token = await signAuthToken({ userId: tutorId, email: 'progress-test@example.com', role: 'tutor' });
    const headers = { cookie: `tutorAuth=${token}`, 'Content-Type': 'application/json' };
    const url = `http://localhost/tutor/classroom-material-progress/${structuredBookingId}?materialType=business-english&materialId=${fixtureId}-progress-be`;
    expect((await app.handle(new Request(url))).status).toBe(401);
    const loaded = await app.handle(new Request(url, { headers }));
    expect(loaded.status).toBe(200);
    expect((await loaded.json() as { data: { sections: unknown[] } }).data.sections).toHaveLength(5);
    const other = await signAuthToken({ userId: otherTutorId, email: 'other-progress-test@example.com', role: 'tutor' });
    expect((await app.handle(new Request(url, { headers: { cookie: `tutorAuth=${other}` } }))).status).toBe(403);
    const bad = await app.handle(new Request(`http://localhost/tutor/classroom-notes/${structuredBookingId}`, { method: 'PUT', headers, body: JSON.stringify({ materialType: 'business-english', materialId: `${fixtureId}-bad-section`, vocabularyItems: [], grammarItems: [], pronunciationItems: [], completionStatus: 'in_progress', stoppedAt: 'not-a-real-section' }) }));
    expect(bad.status).toBe(400);
  });

  test('API enforces the editing window for material notes and shared feedback without blocking reads', async () => {
    const app = new Elysia().use(Tutor);
    const token = await signAuthToken({ userId: tutorId, email: 'window-test@example.com', role: 'tutor' });
    const other = await signAuthToken({ userId: otherTutorId, email: 'other-window-test@example.com', role: 'tutor' });
    const headers = { cookie: `tutorAuth=${token}`, 'Content-Type': 'application/json' };
    const url = `http://localhost/tutor/lesson-notes-edit-window/${structuredBookingId}`;
    expect((await app.handle(new Request(url))).status).toBe(401);
    expect((await app.handle(new Request(url, { headers: { cookie: `tutorAuth=${other}` } }))).status).toBe(403);
    const open = await (await app.handle(new Request(url, { headers }))).json() as { data: { canEdit: boolean } };
    expect(open.data.canEdit).toBe(true);
    const closed = await (await app.handle(new Request(`http://localhost/tutor/lesson-notes-edit-window/${bookingId(9)}`, { headers }))).json() as { data: { canEdit: boolean; reason: string } };
    expect(closed.data).toMatchObject({ canEdit: false, reason: 'expired' });
    const materials = JSON.stringify({ materialType: 'daily-dispatch', materialId: `${fixtureId}-expired`, vocabularyItems: [], grammarItems: [], pronunciationItems: [] });
    for (const [path, body] of [['classroom-notes', materials], ['classroom-lesson-notes', JSON.stringify({ studentComment: 'Forbidden edit', tutorMemo: '' })]]) {
      const response = await app.handle(new Request(`http://localhost/tutor/${path}/${bookingId(9)}`, { method: 'PUT', headers, body }));
      expect(response.status).toBe(403);
      expect((await app.handle(new Request(`http://localhost/tutor/${path}/${bookingId(9)}${path === 'classroom-notes' ? `?materialType=daily-dispatch&materialId=${fixtureId}-expired` : ''}`, { headers }))).status).toBe(200);
    }
    expect((await service.listLessonNotes(bookingId(9), tutorId, 'current'))[0]?.studentComment).not.toBe('Forbidden edit');
    const future = getDriver().session();
    try { await future.run('MATCH (booking:Booking {bookingId: $id}) SET booking.slotDateTime = datetime($future)', { id: summaryBookingId, future: new Date(Date.now() + 60 * 60_000).toISOString() }); }
    finally { await future.close(); }
    expect((await app.handle(new Request(`http://localhost/tutor/classroom-lesson-notes/${summaryBookingId}`, { method: 'PUT', headers, body: JSON.stringify({ studentComment: '', tutorMemo: '' }) }))).status).toBe(403);
  });

  test('confirmed absence clears all lesson notes, rejects autosaves, and preserves other lessons', async () => {
    const graph = getDriver().session();
    try {
      await graph.run(`CREATE (student:Student {id: $studentId, lessonNotesTestId: $fixtureId})
        CREATE (:Booking {bookingId: $bookingId, tutorId: $tutorId, slotDateTime: datetime($startsAt),
          status: 'completed', attendanceStudent: 'present', lessonNotesTestId: $fixtureId})-[:BOOKED_BY]->(student)`,
        { studentId: `${fixtureId}-absence-student`, bookingId: absenceBookingId, tutorId, fixtureId, startsAt: new Date(Date.now() - 60 * 60_000).toISOString() });
    } finally { await graph.close(); }
    const material = { sessionId: absenceBookingId, tutorId, materialType: 'daily-dispatch', materialId: `${fixtureId}-absence-article`, isUsed: true,
      vocabularyItems: [{ word: 'frontier' }] as any[], grammarItems: [{ youSaid: 'I go', correct: 'I went' }] as any[], pronunciationItems: [{ word: 'greeting', phonetic: 'GREE-ting' }] as any[] };
    await service.saveNotes(material);
    await service.saveNotes({ ...material, materialType: 'business-english', materialId: `${fixtureId}-absence-business` });
    await service.saveLessonNotes(absenceBookingId, tutorId, feedback('Student feedback'), 'Private handoff', Date.now(), 4);
    const otherNotes = await service.getLessonNotes(structuredBookingId, tutorId);
    const app = new Elysia().use(Tutor);
    const token = await signAuthToken({ userId: tutorId, email: 'absence-test@example.com', role: 'tutor' });
    const other = await signAuthToken({ userId: otherTutorId, email: 'absence-other@example.com', role: 'tutor' });
    const headers = { cookie: `tutorAuth=${token}`, 'Content-Type': 'application/json' };
    const url = `http://localhost/tutor/lesson-student-attendance/${absenceBookingId}`;
    const absentBody = JSON.stringify({ status: 'absent' });
    expect((await app.handle(new Request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: absentBody }))).status).toBe(401);
    expect((await app.handle(new Request(url, { method: 'PUT', headers: { ...headers, cookie: `tutorAuth=${other}` }, body: absentBody }))).status).toBe(403);
    expect((await service.getLessonNotes(absenceBookingId, tutorId)).materials).toHaveLength(2);
    expect((await app.handle(new Request(url, { method: 'PUT', headers, body: absentBody }))).status).toBe(200);
    expect(await service.getLessonNotes(absenceBookingId, tutorId)).toMatchObject({ studentAttendance: 'absent', materials: [], studentComment: '', tutorMemo: '', englishLevelAssessment: null });
    for (const tab of ['current', 'recent', 'mine', 'first'] as const) {
      expect((await service.listLessonNotes(absenceBookingId, tutorId, tab))[0]).toMatchObject({ studentAttendance: 'absent', notes: [], studentComment: '', tutorMemo: '' });
    }
    for (const [path, body] of [['classroom-notes', JSON.stringify(material)], ['classroom-lesson-notes', JSON.stringify({ studentComment: 'Stale feedback', tutorMemo: 'Stale handoff' })]]) {
      expect((await app.handle(new Request(`http://localhost/tutor/${path}/${absenceBookingId}`, { method: 'PUT', headers, body }))).status).toBe(403);
    }
    expect(await service.getLessonNotes(structuredBookingId, tutorId)).toEqual(otherNotes);
    expect((await app.handle(new Request(url, { method: 'PUT', headers, body: JSON.stringify({ status: 'present' }) }))).status).toBe(200);
    expect(await service.getLessonNotes(absenceBookingId, tutorId)).toMatchObject({ studentAttendance: 'present', materials: [], studentComment: '', tutorMemo: '' });
    // A concurrent autosave either completes before deletion or is rejected after it.
    await Promise.allSettled([service.saveNotes(material), service.saveLessonNotes(absenceBookingId, tutorId, feedback('Racing feedback'), ''), service.setStudentAttendance(absenceBookingId, tutorId, 'absent')]);
    expect(await service.getLessonNotes(absenceBookingId, tutorId)).toMatchObject({ studentAttendance: 'absent', materials: [], studentComment: '' });
    for (const id of [bookingId(9), bookingId(7), summaryBookingId]) {
      expect((await app.handle(new Request(`http://localhost/tutor/lesson-student-attendance/${id}`, { method: 'PUT', headers, body: absentBody }))).status).toBe(403);
    }
  }, 20000);
});
