import 'dotenv/config';
import { closePool, query } from '../src/db/postgres';
import { closeDriver, getDriver, initDriver } from '../src/db/memgraph';

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();

const jsonArray = (value: unknown): string => {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(Array.isArray(parsed) ? parsed : []);
    } catch { return '[]'; }
  }
  return '[]';
};

const tableExists = async (name: string): Promise<boolean> => {
  const result = await query('SELECT to_regclass($1) AS name', [`public.${name}`]);
  return Boolean(result.rows[0]?.name);
};

async function linkToLessonGraph(label: 'ClassroomMaterialNote' | 'ClassroomExerciseMark', key: string, sessionId: string, lessonId: string | null) {
  const session = getDriver().session();
  try {
    await session.run(
      `MATCH (node:${label} {key: $key})
       MATCH (booking:Booking {bookingId: $sessionId})-[:BOOKED_BY]->(student)
       MERGE (booking)-[:HAS_${label === 'ClassroomMaterialNote' ? 'CLASSROOM_NOTE' : 'EXERCISE_MARK'}]->(node)
       MERGE (student)-[:HAS_${label === 'ClassroomMaterialNote' ? 'CLASSROOM_NOTE' : 'EXERCISE_MARK'}]->(node)`,
      { key, sessionId },
    );
    if (lessonId) {
      await session.run(
        `MATCH (node:${label} {key: $key})
         MATCH (lesson:LessonMaterial {id: $lessonId})
         MERGE (lesson)-[:HAS_${label === 'ClassroomMaterialNote' ? 'CLASSROOM_NOTE' : 'EXERCISE_MARK'}]->(node)`,
        { key, lessonId },
      );
    }
  } finally {
    await session.close();
  }
}

await initDriver(
  process.env.MEMGRAPH_URI || 'bolt://localhost:7687',
  process.env.MEMGRAPH_USER || '',
  process.env.MEMGRAPH_PASSWORD || '',
);

try {
  const schemaSession = getDriver().session();
  try {
    await schemaSession.run('CREATE CONSTRAINT ON (note:ClassroomMaterialNote) ASSERT note.key IS UNIQUE');
    await schemaSession.run('CREATE CONSTRAINT ON (mark:ClassroomExerciseMark) ASSERT mark.key IS UNIQUE');
    await schemaSession.run('CREATE INDEX ON :ClassroomExerciseMark(sessionId)');
    await schemaSession.run('CREATE INDEX ON :ClassroomExerciseMark(studentId)');
  } finally { await schemaSession.close(); }

  let notesCount = 0;
  let marksCount = 0;

  if (await tableExists('classroom_material_notes')) {
    const rows = (await query('SELECT * FROM classroom_material_notes ORDER BY id')).rows;
    for (const row of rows) {
      const key = JSON.stringify([row.session_id, row.material_type, row.material_id]);
      const properties = {
        id: row.id, sessionId: row.session_id, tutorId: row.tutor_id,
        studentId: row.student_id, materialType: row.material_type,
        materialId: row.material_id, courseId: row.course_id,
        lessonId: row.lesson_id, articleId: row.article_id,
        vocabularyItemsJson: jsonArray(row.vocabulary_items),
        grammarItemsJson: jsonArray(row.grammar_items),
        pronunciationItemsJson: jsonArray(row.pronunciation_items),
        studentComment: row.student_comment || '', tutorMemo: row.tutor_memo || '',
        createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
      };
      const session = getDriver().session();
      try {
        await session.run(
          'MERGE (note:ClassroomMaterialNote {key: $key}) ON CREATE SET note += $properties',
          { key, properties },
        );
      } finally { await session.close(); }
      await linkToLessonGraph('ClassroomMaterialNote', key, row.session_id, row.lesson_id);
      notesCount++;
    }
  }

  if (await tableExists('classroom_exercise_marks')) {
    const rows = (await query('SELECT * FROM classroom_exercise_marks ORDER BY session_id, lesson_id, step, item_index')).rows;
    for (const row of rows) {
      const key = JSON.stringify([row.session_id, row.lesson_id, row.step, row.item_index]);
      const properties = {
        sessionId: row.session_id, tutorId: row.tutor_id, studentId: row.student_id,
        lessonId: row.lesson_id, step: row.step, itemIndex: row.item_index,
        itemType: row.item_type, prompt: row.prompt, answerKey: row.answer_key,
        isCorrect: row.is_correct, studentResponse: row.student_response || '',
        createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
      };
      const session = getDriver().session();
      try {
        await session.run(
          'MERGE (mark:ClassroomExerciseMark {key: $key}) ON CREATE SET mark += $properties',
          { key, properties },
        );
      } finally { await session.close(); }
      await linkToLessonGraph('ClassroomExerciseMark', key, row.session_id, row.lesson_id);
      marksCount++;
    }
  }

  console.log(`Processed ${notesCount} classroom notes and ${marksCount} exercise marks. PostgreSQL rows were left intact.`);
} finally {
  await closePool();
  await closeDriver();
}
