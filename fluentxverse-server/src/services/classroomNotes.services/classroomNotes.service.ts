import { getDriver } from '../../db/memgraph';
import type { ManagedTransaction } from 'neo4j-driver';
import { lessonMaterialService } from '../lessonMaterial.service';
import { materialSections, isExcludedConversationalStoppingPoint, isExcludedBusinessStoppingPoint, type MaterialCompletionStatus, type MaterialSection } from '../../utils/materialProgress';
import { lessonNotesEditWindow, LessonNotesReadOnly, type LessonNotesEditWindow } from '../../utils/lessonNotesEditWindow';
import { assertLessonFeedback } from '../../utils/lessonFeedbackValidation';
import { lessonOutcome, notesState, invalidateLessonCaches } from '../lessonWorkflow.service';

export interface ClassroomVocabularyNote {
  word: string;
  definitions: {
    meaning: string;
    partOfSpeech: string;
    japaneseNative?: string;
    japaneseRomanized?: string;
    koreanNative?: string;
    koreanRomanized?: string;
    vietnameseNative?: string;
    vietnameseRomanized?: string;
  }[];
  selectedDefinitionIndex: number;
  isLoading: boolean;
  showDefinition: boolean;
  showTranslation: boolean;
}

export interface ClassroomGrammarNote {
  youSaid: string;
  correct: string;
  simpleExplanation: string;
  technicalExplanation: string;
  isLoading: boolean;
  showExplanation: boolean;
}

export interface ClassroomPronunciationNote {
  word: string;
  phonetic: string;
  isLoading: boolean;
  showPhonetic: boolean;
}

export interface ClassroomNotesRecord {
  id: string;
  sessionId: string;
  tutorId: string;
  studentId: string | null;
  materialType: string;
  materialId: string;
  materialTitle: string | null;
  materialLevel?: number | null;
  materialChapter?: number | null;
  isUsed: boolean;
  completionStatus: MaterialCompletionStatus | null;
  stoppedAt: string | null;
  stoppedAtLabel: string | null;
  progressDetails: string;
  courseId: string | null;
  lessonId: string | null;
  articleId: string | null;
  vocabularyItems: ClassroomVocabularyNote[];
  grammarItems: ClassroomGrammarNote[];
  pronunciationItems: ClassroomPronunciationNote[];
  studentComment: string;
  tutorMemo: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveClassroomNotesInput {
  sessionId: string;
  tutorId: string;
  studentId?: string | null;
  materialType: string;
  materialId: string;
  materialTitle?: string | null;
  isUsed?: boolean;
  clientUpdatedAt?: number;
  completionStatus?: MaterialCompletionStatus | null;
  stoppedAt?: string | null;
  progressDetails?: string;
  courseId?: string | null;
  lessonId?: string | null;
  articleId?: string | null;
  vocabularyItems: ClassroomVocabularyNote[];
  grammarItems: ClassroomGrammarNote[];
  pronunciationItems: ClassroomPronunciationNote[];
  studentComment?: string;
  tutorMemo?: string;
}

export type LessonNotesTab = 'current' | 'recent' | 'mine' | 'first';

export interface LessonNotesEntry {
  workflow: ReturnType<typeof notesState>;
  englishLevelAssessment: number | null;
  sessionId: string;
  startsAt: string;
  tutorName: string;
  durationMinutes: number;
  studentAttendance: string | null;
  notes: ClassroomNotesRecord[];
  studentComment: string;
  tutorMemo: string;
  summaryUpdatedAt: string | null;
}

export interface ClassroomLessonNotes {
  studentAttendance: string | null;
  englishLevelAssessment: number | null;
  materials: ClassroomNotesRecord[];
  studentComment: string;
  tutorMemo: string;
  updatedAt: string | null;
}

export interface ClassroomMaterialProgress {
  sections: MaterialSection[];
  previous: { sessionId: string; startsAt: string; completionStatus: MaterialCompletionStatus;
    stoppedAt: string | null; stoppedAtLabel: string | null; progressDetails: string } | null;
}

export class InvalidMaterialProgress extends Error {}

const legacySummary = (notes: ClassroomNotesRecord[], field: 'studentComment' | 'tutorMemo') =>
  [...new Set(notes.map(note => note[field].trim()).filter(Boolean))].join('\n\n');

const hasNotesContent = (note: Pick<ClassroomNotesRecord,
  'studentComment' | 'tutorMemo' | 'vocabularyItems' | 'grammarItems' | 'pronunciationItems'>): boolean =>
  Boolean(note.studentComment.trim() || note.tutorMemo.trim() ||
    note.vocabularyItems.some(item => item?.word?.trim()) ||
    note.grammarItems.some(item => item?.youSaid?.trim() || item?.correct?.trim()) ||
    note.pronunciationItems.some(item => item?.word?.trim() || item?.phonetic?.trim()));

const generateNoteId = (): string => `cnote-${crypto.randomUUID()}`;

const parseJsonArray = <T>(value: unknown): T[] => {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as T[] : [];
    } catch {
      return [];
    }
  }

  return [];
};

export class ClassroomNotesService {
  async getEditWindow(sessionId: string, tutorId: string): Promise<LessonNotesEditWindow & { studentAttendance: string | null }> {
    const session = getDriver().session();
    try {
      const result = await session.run('MATCH (booking:Booking {bookingId: $sessionId, tutorId: $tutorId}) RETURN booking.slotDateTime AS startsAt, booking.durationMinutes AS durationMinutes, booking.status AS status, booking.attendanceStudent AS studentAttendance, booking.notesReopenedUntil AS reopenedUntil', { sessionId, tutorId });
      const row = result.records[0];
      if (!row) throw new Error('Booking not found or you do not have access to this lesson');
      return { ...lessonNotesEditWindow(row.get('startsAt').toStandardDate().toISOString(), Number(row.get('durationMinutes')) || 25, row.get('status'), Date.now(), row.get('reopenedUntil')), studentAttendance: row.get('studentAttendance') === 'absent' ? 'absent' : 'present' };
    } finally { await session.close(); }
  }

  async assertCanEdit(sessionId: string, tutorId: string): Promise<void> {
    const window = await this.getEditWindow(sessionId, tutorId);
    if (!window.canEdit) throw new LessonNotesReadOnly(window.reason === 'expired' ? 'The 48-hour lesson notes editing window has closed' : window.reason === 'cancelled' ? 'Cancelled lessons are read-only' : 'Lesson notes can be edited once the lesson starts');
  }

  // Attendance changes and autosaves write the same booking so deletion cannot race a note save.
  private async lockLesson(tx: ManagedTransaction, sessionId: string, tutorId: string, allowAbsent = false) {
    const result = await tx.run(`MATCH (booking:Booking {bookingId: $sessionId, tutorId: $tutorId})
      SET booking.lessonNotesWriteVersion = COALESCE(booking.lessonNotesWriteVersion, 0) + 1
      RETURN booking`, { sessionId, tutorId });
    const booking = result.records[0]?.get('booking').properties;
    if (!booking) throw new Error('Booking not found or you do not have access to this lesson');
    if (!allowAbsent && !lessonNotesEditWindow(booking.slotDateTime.toStandardDate().toISOString(), Number(booking.durationMinutes) || 25, booking.status, Date.now(), booking.notesReopenedUntil).canEdit)
      throw new LessonNotesReadOnly('The lesson notes editing window is closed.');
    if (!allowAbsent && booking.attendanceStudent === 'absent')
      throw new LessonNotesReadOnly('The student is marked absent. Lesson notes are not required and cannot be saved.');
    if (!allowAbsent && booking.attendanceTutor === 'absent')
      throw new LessonNotesReadOnly('The tutor is marked absent. Lesson notes are not required and cannot be saved.');
    return booking;
  }

  private async markDraft(tx: ManagedTransaction, sessionId: string, booking: Record<string, any>) {
    // Preserve already-visible legacy feedback before its first edit under the submission workflow.
    if (booking.notesDraftDirty == null && !booking.notesSubmittedAt) {
      const row = (await tx.run(`OPTIONAL MATCH (n:ClassroomMaterialNote {sessionId: $sessionId})
        WITH collect(n) AS materials OPTIONAL MATCH (summary:ClassroomLessonNote {sessionId: $sessionId}) RETURN materials, summary`, { sessionId })).records[0]!;
      const materials = row.get('materials').map((n: any) => n.properties);
      const summary = row.get('summary')?.properties;
      if (summary?.studentComment?.trim() || materials.some((n: any) => n.studentComment?.trim())) {
        const resolvedSummary = summary || { studentComment: [...new Set(materials.map((n: any) => n.studentComment?.trim()).filter(Boolean))].join('\n\n') };
        const submittedAt = summary?.updatedAt || materials[0]?.updatedAt || new Date().toISOString();
        await tx.run(`MERGE (n:PublishedLessonNotes {sessionId: $sessionId}) ON CREATE SET n.snapshotJson = $snapshot, n.submittedAt = $submittedAt
          WITH n MATCH (b:Booking {bookingId: $sessionId}) SET b.notesSubmittedAt = $submittedAt`, { sessionId, snapshot: JSON.stringify({ materials, summary: resolvedSummary }), submittedAt });
      }
    }
    await tx.run('MATCH (b:Booking {bookingId: $sessionId}) SET b.notesDraftDirty = true, b.notesReminderStage = null', { sessionId });
  }

  async setStudentAttendance(sessionId: string, tutorId: string, status: 'present' | 'absent', reason = 'Tutor attendance correction', adminId?: string): Promise<void> {
    const session = getDriver().session();
    try {
      await session.executeWrite(async tx => {
        const booking = await this.lockLesson(tx, sessionId, tutorId, true);
        const window = lessonNotesEditWindow(booking.slotDateTime.toStandardDate().toISOString(), Number(booking.durationMinutes) || 25, booking.status, Date.now(), booking.notesReopenedUntil);
        if (!window.canEdit && !adminId) throw new LessonNotesReadOnly('Student attendance can only be changed during the lesson notes editing window.');
        const archive = await tx.run(`MATCH (note) WHERE note.sessionId = $sessionId
          AND (note:ClassroomMaterialNote OR note:ClassroomLessonNote OR note:PublishedLessonNotes) RETURN note, labels(note) AS labels`, { sessionId });
        await tx.run(`CREATE (:LessonAttendanceAudit {id: $id, bookingId: $sessionId, actorId: $tutorId,
          actorRole: $actorRole, previousStatus: $previous, status: $status, reason: $reason, createdAt: $now,
          snapshotJson: $snapshot})`, { id: crypto.randomUUID(), sessionId, tutorId: adminId || tutorId, actorRole: adminId ? 'admin' : 'tutor', previous: booking.attendanceStudent || 'unset', status,
            reason: reason.trim() || 'Tutor attendance correction', now: new Date().toISOString(),
            snapshot: status === 'absent' ? JSON.stringify({ nodes: archive.records.map(row => ({ labels: row.get('labels'), properties: row.get('note').properties })),
              notesSubmittedAt: booking.notesSubmittedAt || null, notesDraftDirty: Boolean(booking.notesDraftDirty) }) : null });
        if (status === 'absent') {
          await tx.run(`MATCH (note) WHERE note.sessionId = $sessionId
            AND (note:ClassroomMaterialNote OR note:ClassroomLessonNote OR note:PublishedLessonNotes) DETACH DELETE note`, { sessionId });
        }
        await tx.run(`MATCH (booking:Booking {bookingId: $sessionId, tutorId: $tutorId})
          SET booking.attendanceStudent = $status, booking.studentAttendanceUpdatedAt = datetime(),
              booking.studentAttendanceUpdatedBy = $actorId, booking.updatedAt = datetime(),
              booking.notesSubmittedAt = CASE WHEN $status = 'absent' THEN null ELSE booking.notesSubmittedAt END,
              booking.notesDraftDirty = CASE WHEN $status = 'absent' THEN false ELSE booking.notesDraftDirty END,
              booking.lessonOutcome = $outcome,
              booking.attendanceStatus = CASE WHEN $outcome = 'attended' THEN 'present' WHEN $outcome = 'awaiting_verification' THEN null ELSE 'absent' END`,
              { sessionId, tutorId, actorId: adminId || tutorId, status, outcome: lessonOutcome({ ...booking, attendanceStudent: status }) });
      });
      await invalidateLessonCaches(sessionId);
    } finally { await session.close(); }
  }

  private static schemaPromise: Promise<void> | null = null;

  private async ensureSchema(): Promise<void> {
    if (!ClassroomNotesService.schemaPromise) {
      ClassroomNotesService.schemaPromise = (async () => {
        const session = getDriver().session();
        try {
          await session.run('CREATE CONSTRAINT ON (note:ClassroomMaterialNote) ASSERT note.key IS UNIQUE');
          await session.run('CREATE CONSTRAINT ON (note:ClassroomLessonNote) ASSERT note.sessionId IS UNIQUE');
        } finally {
          await session.close();
        }
      })().catch(error => {
        ClassroomNotesService.schemaPromise = null;
        throw error;
      });
    }
    await ClassroomNotesService.schemaPromise;
  }

  private key(sessionId: string, materialType: string, materialId: string): string {
    return JSON.stringify([sessionId, materialType, materialId]);
  }

  private mapNode(row: any): ClassroomNotesRecord {
    return {
      id: row.id,
      sessionId: row.sessionId,
      tutorId: row.tutorId,
      studentId: row.studentId ?? null,
      materialType: row.materialType,
      materialId: row.materialId,
      materialTitle: row.materialTitle || null,
      isUsed: Boolean(row.isUsed),
      completionStatus: row.materialType === 'daily-dispatch' ? 'completed' : row.completionStatus === 'completed' || row.completionStatus === 'in_progress' ? row.completionStatus : null,
      stoppedAt: row.materialType === 'daily-dispatch' || row.completionStatus === 'completed' ? null : row.stoppedAt || null,
      stoppedAtLabel: row.materialType === 'daily-dispatch' || row.completionStatus === 'completed' ? null : row.stoppedAtLabel || null,
      progressDetails: row.materialType === 'daily-dispatch' || row.completionStatus === 'completed' ? '' : row.progressDetails || '',
      courseId: row.courseId ?? null,
      lessonId: row.lessonId ?? null,
      articleId: row.articleId ?? null,
      vocabularyItems: parseJsonArray<ClassroomVocabularyNote>(row.vocabularyItemsJson),
      grammarItems: parseJsonArray<ClassroomGrammarNote>(row.grammarItemsJson),
      pronunciationItems: parseJsonArray<ClassroomPronunciationNote>(row.pronunciationItemsJson),
      studentComment: row.studentComment || '',
      tutorMemo: row.tutorMemo || '',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async getPublishedNotes(sessionId: string): Promise<{ materials: ClassroomNotesRecord[]; studentComment: string; englishLevelAssessment: number | null } | null> {
    const session = getDriver().session();
    try {
      const row = (await session.run('MATCH (n:PublishedLessonNotes {sessionId: $sessionId}) RETURN n.snapshotJson AS json', { sessionId })).records[0];
      if (!row) return null;
      const data = JSON.parse(row.get('json'));
      return { materials: data.materials.map((n: any) => this.mapNode(n)), studentComment: data.summary.studentComment || '', englishLevelAssessment: data.summary.englishLevelAssessment == null ? null : Number(data.summary.englishLevelAssessment) };
    } finally { await session.close(); }
  }

  async getNotes(sessionId: string, materialType: string, materialId: string): Promise<ClassroomNotesRecord | null> {
    await this.ensureSchema();
    const session = getDriver().session();
    try {
      const result = await session.run(
        'MATCH (note:ClassroomMaterialNote {key: $key}) RETURN note LIMIT 1',
        { key: this.key(sessionId, materialType, materialId) },
      );
      const node = result.records[0]?.get('note');
      return node ? this.mapNode(node.properties) : null;
    } finally {
      await session.close();
    }
  }

  async listForStudent(studentId: string, lessonIds: string[]): Promise<ClassroomNotesRecord[]> {
    if (!lessonIds.length) return [];
    await this.ensureSchema();
    const session = getDriver().session();
    try {
      const result = await session.run(
        `MATCH (note:ClassroomMaterialNote {studentId: $studentId})
         WHERE note.lessonId IN $lessonIds AND note.materialType = 'conversational-skills'
         OPTIONAL MATCH (summary:ClassroomLessonNote {sessionId: note.sessionId})
         RETURN note, summary ORDER BY note.updatedAt DESC`,
        { studentId, lessonIds },
      );
      return result.records.map(record => {
        const note = this.mapNode(record.get('note').properties);
        const summary = record.get('summary')?.properties;
        return summary ? { ...note, tutorMemo: summary.tutorMemo || '' } : note;
      });
    } finally {
      await session.close();
    }
  }

  private async getSections(materialType: string, materialId: string, studentId?: string | null): Promise<MaterialSection[]> {
    if (materialType === 'daily-dispatch') return [];
    let lesson = null;
    if (studentId && materialType === 'conversational-skills') {
      const session = getDriver().session();
      try {
        const result = await session.run('MATCH (checkpoint:StudentCheckpointLesson {studentId: $studentId, checkpointId: $materialId}) RETURN checkpoint.materialJson AS material LIMIT 1', { studentId, materialId });
        const json = result.records[0]?.get('material');
        if (typeof json === 'string') lesson = JSON.parse(json);
      } finally { await session.close(); }
    }
    lesson ||= await lessonMaterialService.getById(materialId);
    return materialSections(materialType, lesson);
  }

  async getMaterialProgress(sessionId: string, tutorId: string, materialType: string, materialId: string): Promise<ClassroomMaterialProgress> {
    const session = getDriver().session();
    try {
      const owned = await session.run('MATCH (booking:Booking {bookingId: $sessionId, tutorId: $tutorId})-[:BOOKED_BY]->(student) RETURN student.id AS studentId', { sessionId, tutorId });
      if (!owned.records.length) throw new Error('Booking not found or you do not have access to this lesson');
      const studentId = owned.records[0]!.get('studentId');
      const sections = await this.getSections(materialType, materialId, studentId);
      if (materialType === 'daily-dispatch') return { sections, previous: null };
      const result = await session.run(`MATCH (current:Booking {bookingId: $sessionId, tutorId: $tutorId})-[:BOOKED_BY]->(student)
        MATCH (booking:Booking)-[:BOOKED_BY]->(student)
        WHERE booking.bookingId <> current.bookingId AND booking.status IN ['confirmed', 'completed']
          AND booking.slotDateTime < current.slotDateTime AND booking.slotDateTime <= datetime($now)
        MATCH (note:ClassroomMaterialNote {sessionId: booking.bookingId, materialType: $materialType, materialId: $materialId})
        WHERE note.isUsed = true AND note.completionStatus IN ['in_progress', 'completed']
        RETURN note, booking.slotDateTime AS startsAt ORDER BY booking.slotDateTime DESC, note.updatedAt DESC LIMIT 1`,
        { sessionId, tutorId, materialType, materialId, now: new Date().toISOString() });
      const record = result.records[0];
      if (!record) return { sections, previous: null };
      const note = this.mapNode(record.get('note').properties);
      return { sections, previous: { sessionId: note.sessionId, startsAt: record.get('startsAt').toStandardDate().toISOString(),
        completionStatus: note.completionStatus!, stoppedAt: note.stoppedAt, stoppedAtLabel: note.stoppedAtLabel, progressDetails: note.progressDetails } };
    } finally { await session.close(); }
  }

  async listLessonNotes(sessionId: string, tutorId: string, tab: LessonNotesTab): Promise<LessonNotesEntry[]> {
    const session = getDriver().session();
    try {
      // Anchor history to a booking owned by this tutor; never accept a student ID from the caller.
      const bookingSelection = tab !== 'current'
        ? `WHERE booking.status IN ['confirmed', 'completed']
              AND (booking.bookingId = current.bookingId OR booking.slotDateTime <= datetime($now))
              AND ($tab <> 'mine' OR booking.tutorId = $tutorId)
           WITH DISTINCT booking
           ORDER BY booking.slotDateTime ${tab === 'first' ? 'ASC' : 'DESC'}, booking.bookingId ASC LIMIT ${tab === 'first' ? 2 : 10}`
        : `WHERE booking.bookingId = current.bookingId`;
      const result = await session.run(
        `MATCH (current:Booking {bookingId: $sessionId, tutorId: $tutorId})-[:BOOKED_BY]->(student)
         MATCH (booking:Booking)-[:BOOKED_BY]->(student)
         ${bookingSelection}
         OPTIONAL MATCH (note:ClassroomMaterialNote {sessionId: booking.bookingId})
         WHERE note.isUsed = true OR note.hasContent = true OR (note.hasContent IS NULL AND (
             trim(COALESCE(note.studentComment, '')) <> '' OR trim(COALESCE(note.tutorMemo, '')) <> ''
             OR COALESCE(note.vocabularyItemsJson, '[]') <> '[]'
             OR COALESCE(note.grammarItemsJson, '[]') <> '[]'
             OR COALESCE(note.pronunciationItemsJson, '[]') <> '[]'))
         OPTIONAL MATCH (article:DispatchArticle)
         WHERE note.materialType = 'daily-dispatch' AND article.id = COALESCE(note.articleId, note.materialId)
         OPTIONAL MATCH (material:LessonMaterial)
         WHERE note.materialType <> 'daily-dispatch' AND material.id = COALESCE(note.lessonId, note.materialId)
         WITH booking, note, article.title AS articleTitle, material.lessonName AS lessonName,
              material.lessonNumber AS lessonNumber, material.level AS materialLevel, material.chapter AS materialChapter
         ORDER BY note.createdAt ASC, note.id ASC
         WITH booking, collect({note: note, articleTitle: articleTitle,
              lessonName: lessonName, lessonNumber: lessonNumber, materialLevel: materialLevel, materialChapter: materialChapter}) AS notes
         ORDER BY booking.slotDateTime ${tab === 'first' ? 'ASC' : 'DESC'}, booking.bookingId ASC
         OPTIONAL MATCH (tutor:User {id: booking.tutorId})
         OPTIONAL MATCH (summary:ClassroomLessonNote {sessionId: booking.bookingId})
         RETURN booking.bookingId AS sessionId, booking.slotDateTime AS startsAt,
                COALESCE(tutor.firstName, tutor.givenName, '') AS firstName,
                COALESCE(tutor.lastName, tutor.familyName, '') AS lastName,
                tutor.displayName AS displayName, booking.durationMinutes AS durationMinutes,
                booking.attendanceStudent AS studentAttendance, booking AS workflowBooking, notes, summary
         ORDER BY booking.slotDateTime ${tab === 'first' ? 'ASC' : 'DESC'}, booking.bookingId ASC`,
        { sessionId, tutorId, tab, now: new Date().toISOString() },
      );
      return result.records.map(record => {
        const notes: ClassroomNotesRecord[] = record.get('notes').filter((item: any) => item.note).map((item: any) => {
          const note = this.mapNode(item.note.properties);
          const number = typeof item.lessonNumber?.toNumber === 'function' ? item.lessonNumber.toNumber() : item.lessonNumber;
          return { ...note, materialLevel: item.materialLevel == null ? null : Number(item.materialLevel),
            materialChapter: item.materialChapter == null ? null : Number(item.materialChapter),
            isUsed: note.isUsed || hasNotesContent(note), materialTitle: note.materialTitle || item.articleTitle ||
            (item.lessonName ? `${number ? `Lesson ${number}: ` : ''}${item.lessonName}` : null) };
        }).filter((note: ClassroomNotesRecord) => note.isUsed || hasNotesContent(note));
        const summary = record.get('summary')?.properties;
        return {
        workflow: notesState(record.get('workflowBooking').properties),
        sessionId: record.get('sessionId'),
        startsAt: record.get('startsAt').toStandardDate().toISOString(),
        tutorName: record.get('displayName')?.trim() || `${record.get('firstName')} ${record.get('lastName')}`.trim() || 'Tutor',
        durationMinutes: Number(record.get('durationMinutes')) || 25,
        studentAttendance: record.get('studentAttendance') === 'absent' ? 'absent' : 'present',
        notes,
        studentComment: summary ? summary.studentComment || '' : legacySummary(notes, 'studentComment'),
        tutorMemo: summary ? summary.tutorMemo || '' : legacySummary(notes, 'tutorMemo'),
        englishLevelAssessment: summary?.englishLevelAssessment != null ? Number(summary.englishLevelAssessment) : null,
        summaryUpdatedAt: summary?.updatedAt || null,
      }; }).filter(entry => tab !== 'current' || entry.studentAttendance === 'absent' || entry.notes.length > 0 || entry.studentComment.trim() || entry.tutorMemo.trim() || entry.summaryUpdatedAt)
        .slice(0, tab === 'current' ? 1 : tab === 'first' ? 2 : 10);
    } finally {
      await session.close();
    }
  }

  async getLessonNotes(sessionId: string, tutorId: string): Promise<ClassroomLessonNotes> {
    const entry = (await this.listLessonNotes(sessionId, tutorId, 'current'))[0];
    const window = await this.getEditWindow(sessionId, tutorId);
    return { materials: entry?.notes || [], studentAttendance: window.studentAttendance, studentComment: entry?.studentComment || '', tutorMemo: entry?.tutorMemo || '', englishLevelAssessment: entry?.englishLevelAssessment ?? null, updatedAt: entry?.summaryUpdatedAt || null };
  }

  async saveLessonNotes(sessionId: string, tutorId: string, studentComment: string, tutorMemo: string, clientUpdatedAt?: number, englishLevelAssessment?: number | null): Promise<void> {
    if (englishLevelAssessment != null && (!Number.isInteger(englishLevelAssessment) || englishLevelAssessment < 1 || englishLevelAssessment > 10)) {
      throw new Error('Choose an English level from 1 to 10');
    }
    await this.ensureSchema();
    const session = getDriver().session();
    try {
      await session.executeWrite(async tx => {
      const booking = await this.lockLesson(tx, sessionId, tutorId);
      assertLessonFeedback(studentComment, tutorMemo);
      if (clientUpdatedAt != null) {
        const saved = (await tx.run('MATCH (n:ClassroomLessonNote {sessionId: $sessionId}) RETURN n.clientUpdatedAt AS version', { sessionId })).records[0]?.get('version');
        if (saved != null && Number(saved) > clientUpdatedAt) return;
      }
      await this.markDraft(tx, sessionId, booking);
      await tx.run(`MERGE (note:ClassroomLessonNote {sessionId: $sessionId})
        ON CREATE SET note.createdAt = $now
        WITH note WHERE $clientUpdatedAt IS NULL OR note.clientUpdatedAt IS NULL OR $clientUpdatedAt >= note.clientUpdatedAt
        SET note.tutorId = $tutorId, note.studentComment = $studentComment,
            note.englishLevelAssessment = CASE WHEN $hasAssessment THEN $englishLevelAssessment ELSE note.englishLevelAssessment END,
            note.tutorMemo = $tutorMemo, note.updatedAt = $now,
            note.clientUpdatedAt = COALESCE($clientUpdatedAt, note.clientUpdatedAt)`,
        { sessionId, tutorId, studentComment, tutorMemo, hasAssessment: englishLevelAssessment !== undefined, englishLevelAssessment: englishLevelAssessment ?? null, clientUpdatedAt: clientUpdatedAt ?? null, now: new Date().toISOString() });
      });
    } finally { await session.close(); }
  }

  async saveNotes(input: SaveClassroomNotesInput): Promise<ClassroomNotesRecord> {
    await this.ensureSchema();
    const {
      sessionId,
      tutorId,
      studentId = null,
      materialType,
      materialId,
      materialTitle = null,
      courseId = null,
      lessonId = null,
      articleId = null,
      vocabularyItems,
      grammarItems,
      pronunciationItems,
      studentComment,
      tutorMemo,
    } = input;

    const key = this.key(sessionId, materialType, materialId);
    const hasProgress = input.completionStatus !== undefined || input.stoppedAt !== undefined || input.progressDetails !== undefined;
    let stoppedAtLabel: string | null = null;
    if (materialType !== 'daily-dispatch' && input.completionStatus !== 'completed' && input.stoppedAt) {
      if (materialType === 'conversational-skills' && isExcludedConversationalStoppingPoint(input.stoppedAt)) throw new InvalidMaterialProgress('Parts 5 and 6 are not stopping points');
      if (materialType === 'business-english' && isExcludedBusinessStoppingPoint(input.stoppedAt)) throw new InvalidMaterialProgress('Open Talk and Wrap-up are not stopping points');
      stoppedAtLabel = (await this.getSections(materialType, materialId, studentId)).find(section => section.id === input.stoppedAt)?.label || null;
      if (!stoppedAtLabel) {
        const previous = await this.getNotes(sessionId, materialType, materialId);
        if (previous?.stoppedAt === input.stoppedAt) stoppedAtLabel = previous.stoppedAtLabel;
        else {
          const continuation = (await this.getMaterialProgress(sessionId, tutorId, materialType, materialId)).previous;
          if (continuation?.completionStatus === 'in_progress' && continuation.stoppedAt === input.stoppedAt) stoppedAtLabel = continuation.stoppedAtLabel;
          else throw new InvalidMaterialProgress('Choose a stopping point from this material');
        }
      }
      if (materialType === 'conversational-skills' && isExcludedConversationalStoppingPoint(input.stoppedAt, stoppedAtLabel)) throw new InvalidMaterialProgress('Parts 5 and 6 are not stopping points');
    }
    const session = getDriver().session();
    try {
      return await session.executeWrite(async tx => {
      const booking = await this.lockLesson(tx, sessionId, tutorId);
      if (input.clientUpdatedAt != null) {
        const existing = (await tx.run('MATCH (n:ClassroomMaterialNote {key: $key}) RETURN n', { key })).records[0]?.get('n').properties;
        if (existing?.clientUpdatedAt != null && Number(existing.clientUpdatedAt) > input.clientUpdatedAt) return this.mapNode(existing);
      }
      await this.markDraft(tx, sessionId, booking);
      const result = await tx.run(
        `MERGE (note:ClassroomMaterialNote {key: $key})
         ON CREATE SET note.id = $id, note.createdAt = $now
         WITH note WHERE $clientUpdatedAt IS NULL OR note.clientUpdatedAt IS NULL OR $clientUpdatedAt >= note.clientUpdatedAt
         SET note.sessionId = $sessionId, note.tutorId = $tutorId,
             note.studentId = $studentId, note.materialType = $materialType,
             note.materialId = $materialId, note.courseId = $courseId,
             note.materialTitle = COALESCE($materialTitle, note.materialTitle),
             note.isUsed = COALESCE(note.isUsed, false) OR $isUsed,
             note.completionStatus = CASE WHEN $materialType = 'daily-dispatch' THEN 'completed' ELSE COALESCE($completionStatus, note.completionStatus, 'in_progress') END,
             note.lessonId = $lessonId, note.articleId = $articleId,
             note.vocabularyItemsJson = $vocabularyItemsJson,
             note.grammarItemsJson = $grammarItemsJson,
             note.pronunciationItemsJson = $pronunciationItemsJson,
             note.studentComment = COALESCE($studentComment, note.studentComment, ''),
             note.tutorMemo = COALESCE($tutorMemo, note.tutorMemo, ''),
             note.updatedAt = $now
         SET note.clientUpdatedAt = COALESCE($clientUpdatedAt, note.clientUpdatedAt)
         SET note.stoppedAt = CASE WHEN note.completionStatus = 'completed' THEN null WHEN $hasProgress THEN $stoppedAt ELSE note.stoppedAt END,
             note.stoppedAtLabel = CASE WHEN note.completionStatus = 'completed' THEN null WHEN $hasProgress THEN $stoppedAtLabel ELSE note.stoppedAtLabel END,
             note.progressDetails = CASE WHEN note.completionStatus = 'completed' THEN '' WHEN $hasProgress THEN $progressDetails ELSE COALESCE(note.progressDetails, '') END
         SET note.hasContent = $hasLearningContent OR trim(note.studentComment) <> '' OR trim(note.tutorMemo) <> ''
         RETURN note`,
        {
          key, id: generateNoteId(), now: new Date().toISOString(), sessionId, tutorId,
          clientUpdatedAt: input.clientUpdatedAt ?? null,
          hasProgress, completionStatus: input.completionStatus ?? null, stoppedAt: input.stoppedAt ?? null, stoppedAtLabel,
          progressDetails: input.progressDetails?.trim() || '',
          studentId, materialType, materialId, materialTitle, courseId, lessonId, articleId,
          hasLearningContent: hasNotesContent({ studentComment: '', tutorMemo: '', vocabularyItems, grammarItems, pronunciationItems }),
          isUsed: Boolean(input.isUsed || hasNotesContent({ studentComment: studentComment || '', tutorMemo: tutorMemo || '', vocabularyItems, grammarItems, pronunciationItems })),
          vocabularyItemsJson: JSON.stringify(vocabularyItems || []),
          grammarItemsJson: JSON.stringify(grammarItems || []),
          pronunciationItemsJson: JSON.stringify(pronunciationItems || []),
          studentComment: studentComment ?? null, tutorMemo: tutorMemo ?? null,
        },
      );
      const record = result.records[0];
      if (!record) {
        const existing = (await tx.run('MATCH (note:ClassroomMaterialNote {key: $key}) RETURN note', { key })).records[0]?.get('note');
        if (existing) return this.mapNode(existing.properties);
        throw new Error('Failed to save classroom notes');
      }
      await tx.run(
        `MATCH (note:ClassroomMaterialNote {key: $key})
         MATCH (booking:Booking {bookingId: $sessionId})-[:BOOKED_BY]->(student)
         MERGE (booking)-[:HAS_CLASSROOM_NOTE]->(note)
         MERGE (student)-[:HAS_CLASSROOM_NOTE]->(note)`,
        { key, sessionId },
      );
      if (lessonId) {
        await tx.run(
          `MATCH (note:ClassroomMaterialNote {key: $key})
           MATCH (lesson:LessonMaterial {id: $lessonId})
           MERGE (lesson)-[:HAS_CLASSROOM_NOTE]->(note)`,
          { key, lessonId },
        );
      }
      return this.mapNode(record.get('note').properties);
      });
    } finally {
      await session.close();
    }
  }
}
