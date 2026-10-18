import { getDriver } from '../../db/memgraph';

export type ExerciseStep = 'A' | 'B';

export interface ClassroomExerciseMark {
  sessionId: string;
  tutorId: string;
  studentId: string;
  lessonId: string;
  step: ExerciseStep;
  itemIndex: number;
  itemType: string;
  prompt: string;
  answerKey: string;
  isCorrect: boolean;
  studentResponse: string;
  createdAt: string;
  updatedAt: string;
}

export type SaveExerciseMarkInput = Omit<ClassroomExerciseMark, 'createdAt' | 'updatedAt'>;

const markKey = (sessionId: string, lessonId: string, step: ExerciseStep, itemIndex: number) =>
  JSON.stringify([sessionId, lessonId, step, itemIndex]);

const mapNode = (row: any): ClassroomExerciseMark => ({
  sessionId: row.sessionId,
  tutorId: row.tutorId,
  studentId: row.studentId,
  lessonId: row.lessonId,
  step: row.step,
  itemIndex: row.itemIndex?.toNumber?.() ?? row.itemIndex,
  itemType: row.itemType,
  prompt: row.prompt,
  answerKey: row.answerKey,
  isCorrect: row.isCorrect,
  studentResponse: row.studentResponse || '',
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class ClassroomExerciseMarksService {
  private static schemaPromise: Promise<void> | null = null;

  private async ensureSchema(): Promise<void> {
    if (!ClassroomExerciseMarksService.schemaPromise) {
      ClassroomExerciseMarksService.schemaPromise = (async () => {
        const session = getDriver().session();
        try {
          await session.run('CREATE CONSTRAINT ON (mark:ClassroomExerciseMark) ASSERT mark.key IS UNIQUE');
          await session.run('CREATE INDEX ON :ClassroomExerciseMark(sessionId)');
          await session.run('CREATE INDEX ON :ClassroomExerciseMark(studentId)');
        } finally {
          await session.close();
        }
      })().catch(error => {
        ClassroomExerciseMarksService.schemaPromise = null;
        throw error;
      });
    }
    await ClassroomExerciseMarksService.schemaPromise;
  }

  async getMarks(sessionId: string, lessonId: string): Promise<ClassroomExerciseMark[]> {
    await this.ensureSchema();
    const session = getDriver().session();
    try {
      const result = await session.run(
        `MATCH (mark:ClassroomExerciseMark {sessionId: $sessionId, lessonId: $lessonId})
         RETURN mark ORDER BY mark.step, mark.itemIndex`,
        { sessionId, lessonId },
      );
      return result.records.map(record => mapNode(record.get('mark').properties));
    } finally {
      await session.close();
    }
  }

  async saveMark(input: SaveExerciseMarkInput): Promise<ClassroomExerciseMark> {
    await this.ensureSchema();
    const key = markKey(input.sessionId, input.lessonId, input.step, input.itemIndex);
    const session = getDriver().session();
    try {
      const result = await session.run(
        `MERGE (mark:ClassroomExerciseMark {key: $key})
         ON CREATE SET mark.createdAt = $now
         SET mark.sessionId = $sessionId, mark.tutorId = $tutorId,
             mark.studentId = $studentId, mark.lessonId = $lessonId,
             mark.step = $step, mark.itemIndex = $itemIndex,
             mark.itemType = $itemType, mark.prompt = $prompt,
             mark.answerKey = $answerKey, mark.isCorrect = $isCorrect,
             mark.studentResponse = $studentResponse, mark.updatedAt = $now
         RETURN mark`,
        { ...input, key, now: new Date().toISOString() },
      );
      const record = result.records[0];
      if (!record) throw new Error('Failed to save classroom exercise mark');
      await session.run(
        `MATCH (mark:ClassroomExerciseMark {key: $key})
         MATCH (booking:Booking {bookingId: $sessionId})-[:BOOKED_BY]->(student)
         MERGE (booking)-[:HAS_EXERCISE_MARK]->(mark)
         MERGE (student)-[:HAS_EXERCISE_MARK]->(mark)`,
        { key, sessionId: input.sessionId },
      );
      await session.run(
        `MATCH (mark:ClassroomExerciseMark {key: $key})
         MATCH (lesson:LessonMaterial {id: $lessonId})
         MERGE (lesson)-[:HAS_EXERCISE_MARK]->(mark)`,
        { key, lessonId: input.lessonId },
      );
      return mapNode(record.get('mark').properties);
    } finally {
      await session.close();
    }
  }

  async deleteMark(sessionId: string, lessonId: string, step: ExerciseStep, itemIndex: number): Promise<void> {
    await this.ensureSchema();
    const session = getDriver().session();
    try {
      await session.run(
        'MATCH (mark:ClassroomExerciseMark {key: $key}) DETACH DELETE mark',
        { key: markKey(sessionId, lessonId, step, itemIndex) },
      );
    } finally {
      await session.close();
    }
  }

  // The checkpoint generator can query missed items across Lessons 1-4 or 6-9.
  async listIncorrectForStudent(studentId: string, lessonIds: string[]): Promise<ClassroomExerciseMark[]> {
    if (!lessonIds.length) return [];
    await this.ensureSchema();
    const session = getDriver().session();
    try {
      const result = await session.run(
        `MATCH (mark:ClassroomExerciseMark {studentId: $studentId, isCorrect: false})
         WHERE mark.lessonId IN $lessonIds
         RETURN mark ORDER BY mark.lessonId, mark.step, mark.itemIndex, mark.updatedAt DESC`,
        { studentId, lessonIds },
      );
      return result.records.map(record => mapNode(record.get('mark').properties));
    } finally {
      await session.close();
    }
  }

  async listForStudent(studentId: string, lessonIds: string[]): Promise<ClassroomExerciseMark[]> {
    if (!lessonIds.length) return [];
    await this.ensureSchema();
    const session = getDriver().session();
    try {
      const result = await session.run(
        `MATCH (mark:ClassroomExerciseMark {studentId: $studentId})
         WHERE mark.lessonId IN $lessonIds
         RETURN mark ORDER BY mark.updatedAt DESC`,
        { studentId, lessonIds },
      );
      return result.records.map(record => mapNode(record.get('mark').properties));
    } finally {
      await session.close();
    }
  }
}
