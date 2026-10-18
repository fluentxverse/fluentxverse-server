import { strict as assert } from 'node:assert';
import { closeDriver, getDriver, initDriver } from '../src/db/memgraph';
import { ClassroomNotesService } from '../src/services/classroomNotes.services/classroomNotes.service';
import { ClassroomExerciseMarksService } from '../src/services/classroomExerciseMarks.services/classroomExerciseMarks.service';

const uri = process.env.TEST_MEMGRAPH_URI;
if (!uri) throw new Error('TEST_MEMGRAPH_URI is required');

await initDriver(uri, process.env.MEMGRAPH_USER || '', process.env.MEMGRAPH_PASSWORD || '', 1);
const graph = getDriver().session();
const suffix = crypto.randomUUID();
const sessionId = `classroom-test-${suffix}`;
const studentId = `student-test-${suffix}`;
const lessonId = `conversational-skills-test-${suffix}`;
const noteKey = JSON.stringify([sessionId, 'conversational-skills', lessonId]);
const markKey = JSON.stringify([sessionId, lessonId, 'A', 0]);

try {
  await graph.run(
    `CREATE (student:Student {id: $studentId}),
            (booking:Booking {bookingId: $sessionId, tutorId: 'test-tutor'})-[:BOOKED_BY]->(student),
            (lesson:LessonMaterial {id: $lessonId})`,
    { studentId, sessionId, lessonId },
  );

  const notes = new ClassroomNotesService();
  const marks = new ClassroomExerciseMarksService();
  const noteInput = {
    sessionId, tutorId: 'test-tutor', studentId,
    materialType: 'conversational-skills', materialId: lessonId, lessonId,
    vocabularyItems: [], grammarItems: [], pronunciationItems: [],
    tutorMemo: 'Practice the reason for moving',
  };
  const firstNote = await notes.saveNotes(noteInput);
  const updatedNote = await notes.saveNotes({ ...noteInput, tutorMemo: 'Practice follow-up questions' });
  assert.equal(updatedNote.id, firstNote.id);
  assert.equal((await notes.getNotes(sessionId, 'conversational-skills', lessonId))?.tutorMemo,
    'Practice follow-up questions');
  assert.equal((await notes.listForStudent(studentId, [lessonId]))[0]?.tutorMemo,
    'Practice follow-up questions');

  const markInput = {
    sessionId, tutorId: 'test-tutor', studentId, lessonId,
    step: 'A' as const, itemIndex: 0, itemType: 'choose',
    prompt: 'Choose the correct word', answerKey: 'went',
  };
  await marks.saveMark({ ...markInput, isCorrect: false, studentResponse: 'go' });
  assert.equal((await marks.getMarks(sessionId, lessonId))[0]?.studentResponse, 'go');
  assert.equal((await marks.listIncorrectForStudent(studentId, [lessonId])).length, 1);
  assert.equal((await marks.listForStudent(studentId, [lessonId]))[0]?.studentResponse, 'go');

  const links = await graph.run(
    `MATCH (student:Student {id: $studentId})-[:HAS_CLASSROOM_NOTE]->(:ClassroomMaterialNote)
     MATCH (student)-[:HAS_EXERCISE_MARK]->(:ClassroomExerciseMark)
     RETURN count(student) AS count`,
    { studentId },
  );
  assert.equal(links.records[0]?.get('count').toNumber(), 1);

  await marks.saveMark({ ...markInput, isCorrect: true, studentResponse: '' });
  assert.equal((await marks.listIncorrectForStudent(studentId, [lessonId])).length, 0);
  assert.equal((await marks.listForStudent(studentId, [lessonId]))[0]?.isCorrect, true);
  await marks.deleteMark(sessionId, lessonId, 'A', 0);
  assert.equal((await marks.getMarks(sessionId, lessonId)).length, 0);
  console.log('PASS: Memgraph notes, item marks, student links, and missed-item lookup');
} finally {
  await graph.run(
    `MATCH (node)
     WHERE node.id IN [$studentId, $lessonId]
        OR node.bookingId = $sessionId
        OR node.key IN [$noteKey, $markKey]
     DETACH DELETE node`,
    { studentId, lessonId, sessionId, noteKey, markKey },
  );
  await graph.close();
  await closeDriver();
}
