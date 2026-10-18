import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import neo4j from 'neo4j-driver';
import { conversationalLessonErrors } from '../../../../src/utils/conversationalLessonValidation';
import { buildLesson4 } from './lesson-4-speaking';

const oldId = 'conversational-skills-L3-C1-4-reading-ja-v1';
const newId = 'conversational-skills-L3-C1-4-speaking-ja-v1';
const expectedUpdatedAt = process.env.LESSON_EXPECTED_UPDATED_AT;
const dbUri = process.env.LESSON_AUTHORING_DB_URI;
if (!dbUri || !expectedUpdatedAt) throw new Error('Set LESSON_AUTHORING_DB_URI and LESSON_EXPECTED_UPDATED_AT.');

const driver = neo4j.driver(dbUri, neo4j.auth.basic(process.env.MEMGRAPH_USER || '', process.env.MEMGRAPH_PASSWORD || ''));
const session = driver.session();
const jsonFields = ['introductionData', 'learnData', 'stepBData', 'applyData', 'exerciseData', 'missionData', 'missionData2', 'feedbackData', 'storyData'] as const;

try {
  const source = await session.run('MATCH (l:LessonMaterial) WHERE l.id IN [$oldId, $newId] RETURN l', { oldId, newId });
  if (source.records.length !== 1) throw new Error('Expected exactly one Lesson 4 draft.');
  const raw = source.records[0]!.get('l').properties;
  const currentId = raw.id;
  if (raw.updatedAt !== expectedUpdatedAt) throw new Error(`Lesson changed at ${raw.updatedAt}; refusing to overwrite it.`);

  const previous: Record<string, any> = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, neo4j.isInt(value) ? value.toNumber() : value]),
  );
  for (const key of jsonFields) previous[key] = previous[key] ? JSON.parse(previous[key]) : null;
  const changes = buildLesson4(previous, 'https://api.fluentxverse.xyz');
  const candidate = { ...previous, ...changes };
  const errors = conversationalLessonErrors(candidate);
  if (errors.length) throw new Error(`Lesson validation failed: ${errors.join(' ')}`);
  if (JSON.stringify(candidate).includes('localhost:8765')) throw new Error('Lesson still contains localhost image URLs.');
  if (/https?:\/\/[^" ]+\.(?:webp|png|jpe?g)/i.test(JSON.stringify(changes))) throw new Error('Lesson 4 must not include images yet.');

  const chapterPath = resolve(import.meta.dir, 'chapter.json');
  const chapter = await Bun.file(chapterPath).json();
  const index = chapter.findIndex((lesson: any) => lesson.id === currentId);
  if (index < 0) throw new Error('Chapter export does not contain Lesson 4.');

  const now = new Date().toISOString();
  const backups = resolve(import.meta.dir, 'backups');
  await mkdir(backups, { recursive: true });
  const backupPath = resolve(backups, `before-lesson-4-speaking-${now.replace(/[:.]/g, '-')}.json`);
  await Bun.write(backupPath, JSON.stringify(previous, null, 2));

  const updates: Record<string, any> = { updatedAt: now };
  for (const [key, value] of Object.entries(changes)) {
    updates[key] = jsonFields.includes(key as (typeof jsonFields)[number]) ? JSON.stringify(value) : value;
  }
  const saved = await session.run(
    'MATCH (l:LessonMaterial {id: $currentId}) WHERE l.updatedAt = $expectedUpdatedAt SET l += $updates RETURN l.id AS id',
    { currentId, expectedUpdatedAt, updates },
  );
  if (saved.records.length !== 1) throw new Error('Lesson changed during update; no lesson data was overwritten.');

  chapter[index] = { ...candidate, updatedAt: now };
  await Bun.write(chapterPath, JSON.stringify(chapter, null, 2));
  console.log(JSON.stringify({ id: newId, updatedAt: now, backupPath }, null, 2));
} finally {
  await session.close();
  await driver.close();
}
