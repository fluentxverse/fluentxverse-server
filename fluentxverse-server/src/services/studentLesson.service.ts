import { getDriver } from '../db/memgraph';
import { ClassroomNotesService } from './classroomNotes.services/classroomNotes.service';
import { notesState } from './lessonWorkflow.service';

export class StudentLessonAccessError extends Error {}
export class StudentMaterialRequestError extends Error {}

export class StudentLessonService {
  private notes = new ClassroomNotesService();

  async getOwnedLesson(bookingId: string, studentId: string) {
    const session = getDriver().session();
    try {
      const result = await session.run(`MATCH (booking:Booking {bookingId: $bookingId})-[:BOOKED_BY]->(:Student {id: $studentId}) RETURN booking`, { bookingId, studentId });
      if (!result.records.length) throw new StudentLessonAccessError('Lesson not found or you do not have access to this lesson');
      const booking = result.records[0]!.get('booking').properties;
      return { startsAt: booking.slotDateTime.toStandardDate().toISOString(), durationMinutes: Number(booking.durationMinutes) || 25, status: booking.status,
        tutorId: booking.tutorId as string,
        tutorRoomAttendedAt: booking.tutorRoomAttendedAt?.toStandardDate?.().toISOString() as string | undefined,
        tutorRoomEnteredAt: booking.tutorRoomEnteredAt?.toStandardDate?.().toISOString() as string | undefined };
    } finally { await session.close(); }
  }

  async getMaterialRequest(bookingId: string, studentId: string) {
    const lesson = await this.getOwnedLesson(bookingId, studentId);
    const session = getDriver().session();
    try {
      const result = await session.run('MATCH (selection:ClassroomLessonSelection {studentId: $studentId, sessionId: $bookingId}) RETURN selection', { studentId, bookingId });
      const selection = result.records[0]?.get('selection').properties;
      return { canRequestMaterial: ['confirmed', 'pending'].includes(lesson.status) && Date.parse(lesson.startsAt) > Date.now(),
        materialRequest: selection?.courseId && selection.lessonId ? { courseId: selection.courseId, lessonId: selection.lessonId, title: selection.title,
          lessonNumber: Number(selection.lessonNumber) || 1, level: selection.level == null ? null : Number(selection.level),
          chapter: selection.chapter == null ? null : Number(selection.chapter), goal: selection.goal || '' } : null };
    } finally { await session.close(); }
  }

  async getRecap(bookingId: string, studentId: string) {
    const session = getDriver().session();
    try {
      const result = await session.run(`MATCH (booking:Booking {bookingId: $bookingId})-[:BOOKED_BY]->(:Student {id: $studentId})
        OPTIONAL MATCH (selection:ClassroomLessonSelection {studentId: $studentId, sessionId: $bookingId})
        RETURN booking, selection`, { bookingId, studentId });
      if (!result.records.length) throw new StudentLessonAccessError('Lesson not found or you do not have access to this lesson');
      const booking = result.records[0]!.get('booking').properties;
      const selection = result.records[0]!.get('selection')?.properties;
      const entry = (await this.notes.listLessonNotes(bookingId, booking.tutorId, 'current'))[0];
      const published = await this.notes.getPublishedNotes(bookingId);
      const visible = published ? published.materials.map(note => ({ ...note,
        materialTitle: note.materialTitle || entry?.notes.find(item => item.materialId === note.materialId)?.materialTitle || null,
        materialLevel: entry?.notes.find(item => item.materialId === note.materialId)?.materialLevel,
        materialChapter: entry?.notes.find(item => item.materialId === note.materialId)?.materialChapter }))
        : booking.notesDraftDirty == null ? entry?.notes || [] : [];
      const absent = booking.attendanceStudent === 'absent';
      const materials = absent ? [] : visible.filter(note => note.isUsed && (
        note.completionStatus || note.vocabularyItems.some(item => item.word.trim()) ||
        note.grammarItems.some(item => item.youSaid.trim() || item.correct.trim()) ||
        note.pronunciationItems.some(item => item.word.trim()) || note.studentComment.trim()
      )).map(note => ({
        materialId: note.materialId, materialType: note.materialType, courseId: note.courseId,
        materialTitle: note.materialTitle, materialLevel: note.materialLevel ?? null,
        materialChapter: note.materialChapter ?? null, completionStatus: note.completionStatus,
        stoppedAtLabel: note.stoppedAtLabel, progressDetails: note.progressDetails,
        vocabularyItems: note.vocabularyItems.filter(item => item.word.trim()).map(item => ({
          word: item.word,
          definitions: item.definitions.map(definition => ({ meaning: definition.meaning, partOfSpeech: definition.partOfSpeech,
            japaneseNative: definition.japaneseNative || '', japaneseRomanized: definition.japaneseRomanized || '' })),
          selectedDefinitionIndex: item.selectedDefinitionIndex,
        })),
        grammarItems: note.grammarItems.filter(item => item.youSaid.trim() || item.correct.trim())
          .map(item => ({ youSaid: item.youSaid, correct: item.correct })),
        pronunciationItems: note.pronunciationItems.filter(item => item.word.trim()).map(item => ({ word: item.word, phonetic: item.phonetic })),
      }));
      const neighbors: Record<string, string | null> = {};
      for (const direction of ['previous', 'next']) {
        const previous = direction === 'previous';
        const neighbor = await session.run(`MATCH (current:Booking {bookingId: $bookingId})-[:BOOKED_BY]->(student:Student {id: $studentId})
          MATCH (other:Booking)-[:BOOKED_BY]->(student)
          WHERE other.status IN ['confirmed', 'completed'] AND
            (other.slotDateTime ${previous ? '<' : '>'} current.slotDateTime OR
             (other.slotDateTime = current.slotDateTime AND other.bookingId ${previous ? '<' : '>'} current.bookingId))
          RETURN other.bookingId AS id ORDER BY other.slotDateTime ${previous ? 'DESC' : 'ASC'}, other.bookingId ${previous ? 'DESC' : 'ASC'} LIMIT 1`, { bookingId, studentId });
        neighbors[direction] = neighbor.records[0]?.get('id') || null;
      }
      // Whitelist student-visible fields; never return the tutor note record or summary directly.
      return {
        studentAttendance: absent ? 'absent' : 'present',
        workflow: notesState(booking),
        startsAt: booking.slotDateTime.toStandardDate().toISOString(),
        canRequestMaterial: ['confirmed', 'pending'].includes(booking.status) && booking.slotDateTime.toStandardDate().getTime() > Date.now(),
        materialRequest: selection?.courseId && selection.lessonId ? { courseId: selection.courseId, lessonId: selection.lessonId, title: selection.title,
          lessonNumber: Number(selection.lessonNumber) || 1, level: selection.level == null ? null : Number(selection.level),
          chapter: selection.chapter == null ? null : Number(selection.chapter), goal: selection.goal || '' } : null,
        materials, studentComment: absent ? '' : published?.studentComment || (booking.notesDraftDirty == null ? entry?.studentComment || '' : ''),
        englishLevelAssessment: absent ? null : published?.englishLevelAssessment ?? (booking.notesDraftDirty == null ? entry?.englishLevelAssessment ?? null : null),
        previousLessonId: neighbors.previous, nextLessonId: neighbors.next,
      };
    } finally { await session.close(); }
  }

  async setMaterialRequest(bookingId: string, studentId: string, courseId: string | null, materialId?: string) {
    const session = getDriver().session();
    try {
      return await session.executeWrite(async tx => {
        const owned = await tx.run(`MATCH (booking:Booking {bookingId: $bookingId})-[:BOOKED_BY]->(:Student {id: $studentId})
          SET booking.materialRequestVersion = COALESCE(booking.materialRequestVersion, 0) + 1 RETURN booking`, { bookingId, studentId });
        if (!owned.records.length) throw new StudentLessonAccessError('Lesson not found or you do not have access to this lesson');
        const booking = owned.records[0]!.get('booking').properties;
        if (!['confirmed', 'pending'].includes(booking.status) || booking.slotDateTime.toStandardDate().getTime() <= Date.now())
          throw new StudentMaterialRequestError('Advance material requests can only be changed before an upcoming lesson starts.');
        if (!courseId) {
          // Retain an empty scoped record so the legacy profile selection cannot reappear after clearing.
          await tx.run(`MATCH (student:Student {id: $studentId})
            MERGE (selection:ClassroomLessonSelection {studentId: $studentId, sessionId: $bookingId})
            SET selection.courseId = null, selection.lessonId = null, selection.title = null,
                selection.lessonNumber = null, selection.level = null, selection.chapter = null, selection.goal = null,
                selection.updatedAt = datetime()
            MERGE (student)-[:SELECTED_MATERIAL_FOR]->(selection)`, { studentId, bookingId });
          return null;
        }
        if (!['daily-dispatch', 'conversational-skills', 'business-english'].includes(courseId)) throw new StudentMaterialRequestError('Choose a supported course.');
        const daily = courseId === 'daily-dispatch';
        const result = await tx.run(daily
          ? `MATCH (material:DispatchArticle {id: $materialId}) WHERE material.status = 'published' OR material.status IS NULL RETURN material`
          : `MATCH (material:LessonMaterial {id: $materialId, course: $courseId, status: 'published'}) RETURN material`, { materialId: materialId || '', courseId });
        const material = result.records[0]?.get('material').properties;
        if (!material) throw new StudentMaterialRequestError('This material is no longer available. Choose a published material.');
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        const posted = material.postedDate;
        const publishedAt = new Date(posted || material.createdAt);
        const postDate = typeof posted === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(posted) ? posted
          : Number.isFinite(publishedAt.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(publishedAt) : null;
        if (daily && (!postDate || postDate > today)) throw new StudentMaterialRequestError('This article is not available yet.');
        const data = { courseId, lessonId: materialId!, title: daily ? material.title : `Lesson ${Number(material.lessonNumber) || 1}: ${material.lessonName || 'Lesson'}`,
          lessonNumber: Number(material.lessonNumber) || 1, level: daily ? null : Number(material.level) || null,
          chapter: daily ? null : Number(material.chapter) || null, goal: daily ? '' : material.goalTextEn || '' };
        await tx.run(`MATCH (student:Student {id: $studentId})
          MERGE (selection:ClassroomLessonSelection {studentId: $studentId, sessionId: $bookingId})
          SET selection.courseId = $courseId, selection.lessonId = $lessonId, selection.title = $title,
              selection.lessonNumber = $lessonNumber, selection.level = $level, selection.chapter = $chapter,
              selection.goal = $goal, selection.viewedAt = $viewedAt, selection.updatedAt = datetime()
          MERGE (student)-[:SELECTED_MATERIAL_FOR]->(selection)`, { studentId, bookingId, ...data, viewedAt: Date.now() });
        return data;
      });
    } finally { await session.close(); }
  }
}
