import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import neo4j from 'neo4j-driver';
import { conversationalLessonErrors } from '../../../../src/utils/conversationalLessonValidation';
import { buildLesson3, lesson3ImageNames } from './lesson-3-reading';

const oldId = 'conversational-skills-L3-C1-3-speaking-ja-v1';
const newId = 'conversational-skills-L3-C1-3-reading-ja-v1';
const assetDirectory = '/lessons/conversational-skills/ja/l3-c1/v1';
const apiBase = process.env.LESSON_ASSET_API_BASE;
const expectedUpdatedAt = process.env.LESSON_EXPECTED_UPDATED_AT;
const dbUri = process.env.LESSON_AUTHORING_DB_URI;
if (!apiBase?.startsWith('https://')) throw new Error('Set LESSON_ASSET_API_BASE to the public HTTPS API origin.');
if (!dbUri || !expectedUpdatedAt) throw new Error('Set LESSON_AUTHORING_DB_URI and LESSON_EXPECTED_UPDATED_AT.');

const driver = neo4j.driver(dbUri, neo4j.auth.basic(process.env.MEMGRAPH_USER || '', process.env.MEMGRAPH_PASSWORD || ''));
const session = driver.session();
const jsonFields = ['introductionData', 'learnData', 'stepBData', 'applyData', 'exerciseData', 'missionData', 'missionData2', 'feedbackData'] as const;

try {
  const source = await session.run('MATCH (l:LessonMaterial) WHERE l.id IN [$oldId, $newId] RETURN l', { oldId, newId });
  if (source.records.length !== 1) throw new Error('Expected exactly one Lesson 3 draft.');
  const result = source;
  const raw = result.records[0]!.get('l').properties;
  const currentId = raw.id;
  if (raw.updatedAt !== expectedUpdatedAt) throw new Error(`Lesson changed at ${raw.updatedAt}; refusing to overwrite it.`);

  const previous: Record<string, any> = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, neo4j.isInt(value) ? value.toNumber() : value]),
  );
  for (const key of jsonFields) previous[key] = previous[key] ? JSON.parse(previous[key]) : null;
  const changes = buildLesson3(previous, apiBase);
  const candidate = { ...previous, ...changes };
  const errors = conversationalLessonErrors(candidate);
  if (errors.length) throw new Error(`Lesson validation failed: ${errors.join(' ')}`);
  if (JSON.stringify(candidate).includes('localhost:8765')) throw new Error('Lesson still contains localhost image URLs.');

  const filer = process.env.LESSON_AUTHORING_FILER || 'http://localhost:8888';
  for (const name of lesson3ImageNames) {
    const file = Bun.file(resolve(import.meta.dir, 'images', `${name}.webp`));
    if (!await file.exists()) throw new Error(`Missing image ${name}.`);
    const path = `${assetDirectory}/${name}.webp`;
    const uploaded = await fetch(`${filer}${path}`, { method: 'PUT', body: file, headers: { 'Content-Type': 'image/webp' } });
    if (!uploaded.ok) throw new Error(`Upload failed for ${name}: ${uploaded.status}`);
    const publicImage = await fetch(`${apiBase}/lesson/files${path}`);
    if (!publicImage.ok || !publicImage.headers.get('content-type')?.startsWith('image/')) {
      throw new Error(`Public image unavailable for ${name}: ${publicImage.status}`);
    }
  }

  const chapterPath = resolve(import.meta.dir, 'chapter.json');
  const chapter = await Bun.file(chapterPath).json();
  const index = chapter.findIndex((lesson: any) => lesson.id === currentId);
  if (index < 0) throw new Error('Chapter export does not contain Lesson 3.');

  const now = new Date().toISOString();
  const backups = resolve(import.meta.dir, 'backups');
  await mkdir(backups, { recursive: true });
  const backupPath = resolve(backups, `before-lesson-3-reading-${now.replace(/[:.]/g, '-')}.json`);
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
  console.log(JSON.stringify({ id: newId, updatedAt: now, images: lesson3ImageNames.length, backupPath }, null, 2));
} finally {
  await session.close();
  await driver.close();
}
