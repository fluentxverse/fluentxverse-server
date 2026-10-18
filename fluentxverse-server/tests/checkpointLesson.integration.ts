import { strict as assert } from 'node:assert';
import { closeDriver, getDriver, initDriver } from '../src/db/memgraph';
import { CheckpointLessonService } from '../src/services/checkpointLesson.service';

const uri = process.env.TEST_MEMGRAPH_URI;
if (!uri) throw new Error('TEST_MEMGRAPH_URI is required');

await initDriver(uri, process.env.MEMGRAPH_USER || '', process.env.MEMGRAPH_PASSWORD || '', 1);
const graph = getDriver().session();
const suffix = crypto.randomUUID();
const studentId = `checkpoint-test-student-${suffix}`;
const lessonIds = [1, 2, 3, 4].map(number => `conversational-skills-L99-C99-${number}-speaking-${suffix}`);
const checkpointId = 'conversational-skills-L99-C99-5-review';
const checkpointKey = JSON.stringify([studentId, 'conversational-skills', 99, 99, 5]);
const content = {
  introduction: 'You are planning a community event.', introductionJp: '地域のイベントを計画しています。',
  stepA: [1, 2, 3, 4, 1, 2].map((sourceLessonNumber, index) => ({ sourceLessonNumber, sentence: `Incorrect ${index}`, answer: `Correct ${index}` })),
  stepB: [1, 2, 3, 4, 1].map((sourceLessonNumber, index) => ({ sourceLessonNumber, prompt: `Purpose ${index}`, optionA: 'Clear sentence.', optionB: 'Unclear sentence.', answer: 'A' })),
  challenge1: { situation: 'Introduce your plan.', situationJp: '計画を紹介しましょう。', instruction: 'Give a short talk.', instructionJp: '短く話しましょう。', prompts: ['What is your plan?', 'Why?', 'What next?'] },
  challenge2: { situation: 'Read the notice.', situationJp: '案内を読みましょう。', title: 'Community Event',
    passage: 'The community event starts at ten on Saturday morning. Visitors can join a short walk, then meet at the cafe for lunch. Registration is free, but lunch is not included. Please bring a water bottle and arrive early.',
    questions: [{ question: 'When does it start?', answer: 'At ten.' }, { question: 'Where is lunch?', answer: 'At the cafe.' }, { question: 'Is lunch included?', answer: 'No.' }] },
  challenge3: { situation: 'Invite a friend.', situationJp: '友人を誘いましょう。', instruction: 'Explain the event.', instructionJp: 'イベントを説明しましょう。', prompts: ['What is happening?', 'When?', 'What should I bring?'] },
};

try {
  await graph.run('CREATE (student:Student {id: $studentId})', { studentId });
  for (const [index, lessonId] of lessonIds.entries()) {
    const number = index + 1;
    await graph.run(
      `CREATE (lesson:LessonMaterial {
        id: $id, course: 'conversational-skills', level: 99, chapter: 99, lessonNumber: $lessonNumber,
        skill: 'speaking', status: 'published', chapterName: 'Test Chapter', lessonName: $lessonName,
        goalTextEn: $goal, goalTextJp: '目標', backgroundImage: '', overlayColor: '',
        createdBy: 'test', createdByName: 'Test', createdAt: '', updatedAt: '',
        stepBData: $stepBData, learnData: $learnData
      })`,
      { id: lessonId, lessonNumber: number, lessonName: `Test Lesson ${number}`, goal: `Use rule ${number}`,
        stepBData: JSON.stringify({ stepType: 'grammar-tip', grammarTip: { explanations: [{ ruleText: `Rule ${number}`, ruleTranslation: '文法', examples: [] }] } }),
        learnData: JSON.stringify({ steps: [{ vocabularyItems: [{ image: '', englishText: `Word ${number}`, translation: '' }] }] }),
      },
    );
  }
  let calls = 0;
  const useLiveAi = process.env.CHECKPOINT_TEST_LIVE_AI === '1';
  const service = useLiveAi
    ? new CheckpointLessonService()
    : new CheckpointLessonService(async () => { calls++; return content; });
  const first = await service.getOrCreate(studentId, checkpointId);
  const again = await service.getOrCreate(studentId, checkpointId);
  if (!useLiveAi) assert.equal(calls, 1);
  assert.deepEqual(again, first);
  assert.equal(first.missionData3?.challengeNumber, 3);
  const stored = await graph.run(
    `MATCH (student:Student {id: $studentId})-[:HAS_CHECKPOINT_LESSON]->(checkpoint:StudentCheckpointLesson {key: $key})
     RETURN checkpoint.materialJson AS materialJson`,
    { studentId, key: checkpointKey },
  );
  assert.equal(stored.records.length, 1);
  assert.equal(JSON.parse(stored.records[0]!.get('materialJson')).id, checkpointId);
  console.log('PASS: checkpoint generated once and persisted for the student in Memgraph');
} finally {
  await graph.run(
    `MATCH (node)
     WHERE node.id = $studentId OR node.id IN $lessonIds OR node.key = $checkpointKey
     DETACH DELETE node`,
    { studentId, lessonIds, checkpointKey },
  );
  await graph.close();
  await closeDriver();
}
