import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import neo4j from 'neo4j-driver';
import { conversationalLessonErrors } from '../../../../src/utils/conversationalLessonValidation';
import { buildArcLesson } from './lessons-6-9';

const dbUri = process.env.LESSON_AUTHORING_DB_URI;
const expectedUpdatedAt = process.env.LESSON_EXPECTED_UPDATED_AT;
if (!dbUri || !expectedUpdatedAt) throw new Error('Set LESSON_AUTHORING_DB_URI and LESSON_EXPECTED_UPDATED_AT.');

const numbers = [6, 7, 8, 9] as const;
const oldIds = [
  'conversational-skills-L3-C1-6-listening-ja-v1',
  'conversational-skills-L3-C1-7-speaking-ja-v1',
  'conversational-skills-L3-C1-8-reading-ja-v1',
  'conversational-skills-L3-C1-9-listening-ja-v1',
];
const jsonFields = ['introductionData', 'learnData', 'stepBData', 'applyData', 'exerciseData', 'missionData', 'missionData2', 'feedbackData', 'storyData'] as const;
const driver = neo4j.driver(dbUri, neo4j.auth.basic(process.env.MEMGRAPH_USER || '', process.env.MEMGRAPH_PASSWORD || ''));
const session = driver.session();

try {
  const found = await session.run('MATCH (l:LessonMaterial) WHERE l.id IN $oldIds RETURN l', { oldIds });
  if (found.records.length !== 4) throw new Error('Expected exactly four unchanged Lesson 6-9 drafts.');

  const chapterPath = resolve(import.meta.dir, 'chapter.json');
  const chapter = await Bun.file(chapterPath).json();
  const before: Record<string, any>[] = [];
  const items: { oldId: string; expectedUpdatedAt: string; updates: Record<string, unknown> }[] = [];
  const now = new Date().toISOString();

  for (const number of numbers) {
    const oldId = oldIds[number - 6]!;
    const record = found.records.find(record => record.get('l').properties.id === oldId);
    if (!record) throw new Error(`Missing draft for Lesson ${number}.`);
    const raw = record.get('l').properties;
    if (raw.status !== 'draft' || raw.updatedAt !== expectedUpdatedAt) {
      throw new Error(`Lesson ${number} changed or was published at ${raw.updatedAt}; refusing to overwrite it.`);
    }
    const previous: Record<string, any> = Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, neo4j.isInt(value) ? value.toNumber() : value]),
    );
    for (const key of jsonFields) previous[key] = previous[key] ? JSON.parse(previous[key]) : null;
    const changes = buildArcLesson(number, previous, 'https://api.fluentxverse.xyz');
    const candidate = { ...previous, ...changes, updatedAt: now };
    const errors = conversationalLessonErrors(candidate);
    if (errors.length) throw new Error(`Lesson ${number} validation failed: ${errors.join(' ')}`);
    if (/https?:\/\/[^" ]+\.(?:webp|png|jpe?g)/i.test(JSON.stringify(changes))) {
      throw new Error(`Lesson ${number} contains an image URL.`);
    }
    const index = chapter.findIndex((lesson: any) => lesson.id === oldId);
    if (index < 0) throw new Error(`Chapter export does not contain Lesson ${number}.`);
    chapter[index] = candidate;
    before.push(previous);

    const updates: Record<string, unknown> = { updatedAt: now };
    for (const [key, value] of Object.entries(changes)) {
      updates[key] = jsonFields.includes(key as (typeof jsonFields)[number]) ? JSON.stringify(value) : value;
    }
    items.push({ oldId, expectedUpdatedAt, updates });
  }

  const newIds = items.map(item => item.updates.id);
  const collision = await session.run('MATCH (l:LessonMaterial) WHERE l.id IN $newIds AND NOT l.id IN $oldIds RETURN l.id AS id', { newIds, oldIds });
  if (collision.records.length) throw new Error(`A destination lesson ID already exists: ${collision.records[0]?.get('id')}`);

  const backups = resolve(import.meta.dir, 'backups');
  await mkdir(backups, { recursive: true });
  const backupPath = resolve(backups, `before-lessons-6-9-${now.replace(/[:.]/g, '-')}.json`);
  await Bun.write(backupPath, JSON.stringify(before, null, 2));

  const saved = await session.run(
    `UNWIND $items AS item
     MATCH (l:LessonMaterial {id: item.oldId})
     WHERE l.updatedAt = item.expectedUpdatedAt AND l.status = 'draft'
     WITH collect({lesson: l, updates: item.updates}) AS matched
     WHERE size(matched) = 4
     UNWIND matched AS pair
     WITH pair.lesson AS l, pair.updates AS updates
     SET l += updates
     RETURN count(l) AS updated`,
    { items },
  );
  const updated = saved.records[0]?.get('updated');
  if ((neo4j.isInt(updated) ? updated.toNumber() : updated) !== 4) {
    throw new Error('Drafts changed during update; no lesson data was overwritten.');
  }
  await Bun.write(chapterPath, JSON.stringify(chapter, null, 2));
  console.log(JSON.stringify({ lessonIds: newIds, updatedAt: now, backupPath }, null, 2));
} finally {
  await session.close();
  await driver.close();
}
