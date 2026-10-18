import path from 'node:path';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { initDriver, closeDriver } from '../src/db/memgraph';
import { lessonMaterialService } from '../src/services/lessonMaterial.service';

const ROOT = path.resolve(import.meta.dir, '../..');
const DOCS_ROOT = path.join(ROOT, 'docs/lesson-materials/business-conversation');
const TMP_ROOT = path.join(ROOT, 'fluentxverse-server/tmp');
const FIXED_TEXT = 'You can ask follow-up questions and have a natural conversation with the student until the time for feedback.';

async function findLessonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return findLessonFiles(fullPath);
    if (entry.isFile() && /lesson-data\/.*\.json$/.test(fullPath)) return [fullPath];
    return [];
  }));
  return nested.flat();
}

function parseMeta(filePath: string) {
  const levelMatch = filePath.match(/level-(\d+)/);
  const lessonMatch = path.basename(filePath).match(/^ch(\d+)-L(\d+)-/);
  if (!levelMatch || !lessonMatch) return null;
  return {
    level: Number(levelMatch[1]),
    chapter: Number(lessonMatch[1]),
    lessonNumber: Number(lessonMatch[2]),
  };
}

function buildDiscussionNotes(notes: Array<{ type?: string; text?: string }> = []) {
  const openingScript = notes.find((note) => note?.type === 'script' && (note?.text || '').trim())?.text?.trim()
    || '"Now, let\'s have a discussion."';

  return [
    { type: 'script', text: openingScript },
    { type: 'instruction', text: 'Read the instruction.' },
    { type: 'instruction', text: 'Ask the student to choose a category.' },
    { type: 'instruction', text: FIXED_TEXT },
  ];
}

async function syncFiles() {
  const files = (await findLessonFiles(DOCS_ROOT)).sort();
  const lessonMap = new Map<string, any>();

  for (const lessonPath of files) {
    const raw = await readFile(lessonPath, 'utf8');
    const lesson = JSON.parse(raw);
    lesson.beData = lesson.beData || {};
    lesson.beData.discussion = lesson.beData.discussion || {};
    lesson.beData.discussion.tutorNotes = buildDiscussionNotes(lesson.beData.discussion.tutorNotes || []);

    await writeFile(lessonPath, `${JSON.stringify(lesson, null, 2)}\n`);

    const meta = parseMeta(lessonPath);
    if (meta) {
      lessonMap.set(`${meta.level}-${meta.chapter}-${meta.lessonNumber}`, lesson);
      if (meta.level === 3 && meta.chapter === 1) {
        await writeFile(path.join(TMP_ROOT, `L${meta.lessonNumber}-updated.json`), `${JSON.stringify(lesson, null, 2)}\n`);
      }
    }
  }

  return lessonMap;
}

async function syncDb(lessonMap: Map<string, any>) {
  await initDriver(
    process.env.MEMGRAPH_URI || 'bolt://localhost:7687',
    process.env.MEMGRAPH_USER || 'fluentxverse',
    process.env.MEMGRAPH_PASSWORD || 'devpassword123!ChangeMe'
  );

  try {
    const lessons = await lessonMaterialService.listByCourse('business-english');
    for (const existing of lessons) {
      const key = `${existing.level}-${existing.chapter}-${existing.lessonNumber}`;
      const sourceLesson = lessonMap.get(key);
      if (!sourceLesson) continue;

      await lessonMaterialService.updateHeader(existing.id, {
        chapterName: sourceLesson.chapterName,
        lessonName: sourceLesson.lessonName,
        goalTextEn: sourceLesson.goalTextEn,
        goalTextJp: sourceLesson.goalTextKr,
        beData: sourceLesson.beData,
      });

      console.log(`Updated DB lesson: ${existing.id}`);
    }
  } finally {
    await closeDriver();
  }
}

async function main() {
  const lessonMap = await syncFiles();
  await syncDb(lessonMap);
  console.log('Open Talk teaching notes synced to the screenshot-style 4-note format.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
