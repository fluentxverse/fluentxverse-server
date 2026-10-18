import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import neo4j from 'neo4j-driver';
import { buildChapter, assetDirectory } from './build';
import { specs } from './specs';
import { conversationalLessonErrors } from '../../../../src/utils/conversationalLessonValidation';

const source = 'conversational-skills-ja-l3-c1-v1';
const originalId = 'conversational-skills-L3-C1-1-speaking-1774155960030';
const apiBase = process.env.LESSON_ASSET_API_BASE || 'http://localhost:8765';
if (process.argv.includes('--write') && !process.env.LESSON_ASSET_API_BASE) {
  throw new Error('Set LESSON_ASSET_API_BASE to the public API origin before importing lesson image URLs.');
}
const lessons = buildChapter(apiBase);
for (const lesson of lessons) {
  const errors = conversationalLessonErrors(lesson);
  if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/u.test(JSON.stringify(lesson))) errors.push('Unexpected Korean text in Japanese edition.');
  if (!lesson.introductionData.introTexts.some(t => t.language === 'ja')) errors.push('Missing Japanese introduction.');
  if (errors.length) throw new Error(`Lesson ${lesson.lessonNumber}: ${errors.join(' ')}`);
}
if (lessons.length !== 10 || new Set(lessons.map(l => l.lessonNumber)).size !== 10) throw new Error('Chapter must have ten distinct lesson slots.');
console.log('Validated ten Japanese-support lessons; Apply and Mission skills match.');
if (!process.argv.includes('--write')) process.exit(0);

// Target must be explicit so this authoring utility cannot accidentally use a production DB.
if (!process.env.LESSON_AUTHORING_DB_URI) throw new Error('Set LESSON_AUTHORING_DB_URI to the intended Memgraph instance.');
const driver = neo4j.driver(process.env.LESSON_AUTHORING_DB_URI, neo4j.auth.basic(process.env.MEMGRAPH_USER || '', process.env.MEMGRAPH_PASSWORD || ''));
const session = driver.session();
const now = new Date().toISOString();
const backupDirectory = resolve(import.meta.dir, 'backups');
const ids = lessons.map(l => l.lessonNumber === 1 ? originalId : `conversational-skills-L3-C1-${l.lessonNumber}-${l.skill}-ja-v1`);
try {
  const existing = await session.run('MATCH (l:LessonMaterial {course: $course, level: 3, chapter: 1}) RETURN l', { course: 'conversational-skills' });
  const records = existing.records.map(r => r.get('l').properties);
  for (const record of records) {
    if (!ids.includes(record.id)) throw new Error(`Unexpected existing lesson ${record.id}; chapter not overwritten.`);
    if (record.authoringSource && record.authoringSource !== source) throw new Error(`Different authoring source on ${record.id}.`);
    if (record.authoringSource === source && record.updatedAt !== record.authoringImportedAt) throw new Error(`Admin edits detected on ${record.id}; import refused.`);
  }
  const before = JSON.stringify(records, (_, v) => neo4j.isInt(v) ? v.toNumber() : v, 2);
  await mkdir(backupDirectory, { recursive: true });
  const backup = `${backupDirectory}/${now.replace(/[:.]/g, '-')}.json`;
  await Bun.write(backup, before);
  console.log(`Original lesson backup: ${backup}`);
  const filer = process.env.LESSON_AUTHORING_FILER || 'http://localhost:8888';
  for (const spec of specs) {
    const file = Bun.file(`${import.meta.dir}/images/${spec.asset}.webp`);
    if (!await file.exists()) throw new Error(`Missing generated image: ${spec.asset}`);
    const upload = await fetch(`${filer}${assetDirectory}/${spec.asset}.webp`, { method: 'PUT', body: file, headers: { 'Content-Type': 'image/webp' } });
    if (!upload.ok) throw new Error(`Image upload failed: ${spec.asset} (${upload.status})`);
    const proxy = await fetch(`${apiBase}/lesson/files${assetDirectory}/${spec.asset}.webp`);
    if (!proxy.ok || !proxy.headers.get('content-type')?.startsWith('image/')) throw new Error(`Image proxy failed: ${spec.asset}`);
  }
  const tx = session.beginTransaction();
  try {
    for (const [index, lesson] of lessons.entries()) {
      const previous = records.find(r => r.id === ids[index]);
      const props: Record<string, any> = {
        ...lesson, id: ids[index], level: neo4j.int(3), chapter: neo4j.int(1), lessonNumber: neo4j.int(lesson.lessonNumber),
        createdAt: previous?.createdAt || now, createdBy: previous?.createdBy || 'codex', createdByName: previous?.createdByName || 'Lesson Authoring',
        updatedAt: now, authoringSource: source, authoringImportedAt: now, supportLanguage: 'ja',
      };
      for (const key of ['introductionData', 'learnData', 'stepBData', 'applyData', 'exerciseData', 'missionData', 'missionData2', 'feedbackData', 'storyData'] as const) props[key] = lesson[key] ? JSON.stringify(lesson[key]) : '';
      // Clear unused historical section payloads from the repaired source lesson.
      props.discussionQuestionsData = '';
      props.beData = '';
      if (previous) {
        const result = await tx.run('MATCH (l:LessonMaterial {id: $id}) WHERE l.updatedAt = $previousUpdated SET l += $props RETURN l.id AS id', { id: ids[index], previousUpdated: previous.updatedAt, props });
        if (result.records.length !== 1) throw new Error(`Concurrent edit detected on ${ids[index]}.`);
      } else {
        await tx.run('CREATE (l:LessonMaterial) SET l = $props', { props });
      }
    }
    await tx.commit();
  } catch (error) { await tx.rollback(); throw error; }
  const output = lessons.map((l, i) => ({ ...l, id: ids[i], levelBadge: 'BEGINNER', chapterLabel: 'Chapter 1: Nice to Meet You', lessonTitle: `Lesson ${l.lessonNumber}: ${l.lessonName}` }));
  await Bun.write(`${import.meta.dir}/chapter.json`, JSON.stringify(output, null, 2));
  console.log('Saved all ten lessons as drafts. Existing Lesson 1 keeps its ID.');
  console.table(output.map(l => ({ lesson: l.lessonNumber, skill: l.skill, title: l.lessonName, status: l.status })));
} finally {
  await session.close();
  await driver.close();
}
