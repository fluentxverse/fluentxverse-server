import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import neo4j from 'neo4j-driver';
import { conversationalLessonErrors } from '../../../../src/utils/conversationalLessonValidation';
import { buildLesson2, lesson2ImageNames } from './lesson-2-listening';

const id = 'conversational-skills-L3-C1-2-listening-ja-v1';
const assetDirectory = '/lessons/conversational-skills/ja/l3-c1/v1';
const apiBase = process.env.LESSON_ASSET_API_BASE;
const expectedUpdatedAt = process.env.LESSON_EXPECTED_UPDATED_AT;
const dbUri = process.env.LESSON_AUTHORING_DB_URI;

if (!apiBase || !apiBase.startsWith('https://')) throw new Error('Set LESSON_ASSET_API_BASE to the public HTTPS API origin.');
if (!dbUri || !expectedUpdatedAt) throw new Error('Set LESSON_AUTHORING_DB_URI and LESSON_EXPECTED_UPDATED_AT.');

const driver = neo4j.driver(dbUri, neo4j.auth.basic(process.env.MEMGRAPH_USER || '', process.env.MEMGRAPH_PASSWORD || ''));
const session = driver.session();
const jsonFields = ['introductionData', 'learnData', 'stepBData', 'applyData', 'exerciseData', 'missionData', 'missionData2', 'feedbackData'] as const;

try {
  const result = await session.run('MATCH (l:LessonMaterial {id: $id}) RETURN l', { id });
  if (result.records.length !== 1) throw new Error(`Lesson ${id} not found.`);
  const raw = result.records[0]!.get('l').properties;
  if (raw.updatedAt !== expectedUpdatedAt) throw new Error(`Lesson changed at ${raw.updatedAt}; refusing to overwrite it.`);

  const previous: Record<string, any> = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, neo4j.isInt(value) ? value.toNumber() : value]),
  );
  for (const key of jsonFields) previous[key] = previous[key] ? JSON.parse(previous[key]) : null;
  const candidate = { ...previous, ...buildLesson2(previous, apiBase) };
  const errors = conversationalLessonErrors(candidate);
  if (errors.length) throw new Error(`Lesson validation failed: ${errors.join(' ')}`);
  if (JSON.stringify(candidate).includes('localhost:8765')) throw new Error('Lesson still contains localhost image URLs.');

  const filer = process.env.LESSON_AUTHORING_FILER || 'http://localhost:8888';
  for (const name of lesson2ImageNames) {
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

  const now = new Date().toISOString();
  const backups = resolve(import.meta.dir, 'backups');
  await mkdir(backups, { recursive: true });
  const backupPath = resolve(backups, `before-lesson-2-listening-${now.replace(/[:.]/g, '-')}.json`);
  await Bun.write(backupPath, JSON.stringify(previous, null, 2));

  const changes = buildLesson2(previous, apiBase);
  const updates: Record<string, any> = { updatedAt: now };
  for (const [key, value] of Object.entries(changes)) {
    updates[key] = jsonFields.includes(key as (typeof jsonFields)[number]) ? JSON.stringify(value) : value;
  }
  const saved = await session.run(
    'MATCH (l:LessonMaterial {id: $id}) WHERE l.updatedAt = $expectedUpdatedAt SET l += $updates RETURN l.updatedAt AS updatedAt',
    { id, expectedUpdatedAt, updates },
  );
  if (saved.records.length !== 1) throw new Error('Lesson changed during update; no lesson data was overwritten.');

  const chapterPath = resolve(import.meta.dir, 'chapter.json');
  const chapter = await Bun.file(chapterPath).json();
  const index = chapter.findIndex((lesson: any) => lesson.id === id);
  if (index < 0) throw new Error('Saved lesson, but chapter export does not contain Lesson 2.');
  chapter[index] = { ...candidate, updatedAt: now };
  await Bun.write(chapterPath, JSON.stringify(chapter, null, 2));
  console.log(JSON.stringify({ id, updatedAt: now, images: lesson2ImageNames.length, backupPath }, null, 2));
} finally {
  await session.close();
  await driver.close();
}
