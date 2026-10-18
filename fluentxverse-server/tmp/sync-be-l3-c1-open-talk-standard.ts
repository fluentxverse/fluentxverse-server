import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { initDriver, closeDriver } from '../src/db/memgraph';
import { lessonMaterialService } from '../src/services/lessonMaterial.service';

const ROOT = path.resolve(import.meta.dir, '../..');
const FIXED_TEXT = 'You can ask follow-up questions and have a natural conversation with the student until the time for feedback.';

const LESSONS = [
  { lessonNumber: 1, file: 'ch01-L1-pleased-to-meet-you.json', tmp: 'L1-updated.json' },
  { lessonNumber: 2, file: 'ch01-L2-all-about-me.json', tmp: 'L2-updated.json' },
  { lessonNumber: 3, file: 'ch01-L3-tell-me-about-yourself.json', tmp: 'L3-updated.json' },
  { lessonNumber: 4, file: 'ch01-L4-whos-who.json', tmp: 'L4-updated.json' },
  { lessonNumber: 5, file: 'ch01-L5-first-impressions.json', tmp: 'L5-updated.json' },
] as const;

function ensureDiscussionTutorNotes(notes: Array<{ type?: string; text?: string }> = []) {
  const cleaned = notes.filter((note) => (note?.text || '').trim() !== FIXED_TEXT);
  const fixedNote = { type: 'instruction', text: FIXED_TEXT };
  const insertAt = cleaned.findIndex((note) => (
    note?.type === 'tip' ||
    (note?.type === 'script' && /feedback/i.test(note?.text || ''))
  ));

  if (insertAt === -1) {
    return [...cleaned, fixedNote];
  }

  return [
    ...cleaned.slice(0, insertAt),
    fixedNote,
    ...cleaned.slice(insertAt),
  ];
}

async function syncFiles() {
  const updatedLessons: Array<{ lessonNumber: number; lesson: any }> = [];

  for (const config of LESSONS) {
    const lessonPath = path.join(
      ROOT,
      'docs/lesson-materials/business-conversation/level-03/lesson-data',
      config.file
    );
    const tmpPath = path.join(ROOT, 'fluentxverse-server/tmp', config.tmp);
    const raw = await readFile(lessonPath, 'utf8');
    const lesson = JSON.parse(raw);

    lesson.beData = lesson.beData || {};
    lesson.beData.discussion = lesson.beData.discussion || {};
    lesson.beData.discussion.tutorNotes = ensureDiscussionTutorNotes(lesson.beData.discussion.tutorNotes || []);

    await writeFile(lessonPath, `${JSON.stringify(lesson, null, 2)}\n`);
    await writeFile(tmpPath, `${JSON.stringify(lesson, null, 2)}\n`);
    updatedLessons.push({ lessonNumber: config.lessonNumber, lesson });
  }

  return updatedLessons;
}

async function syncDb(updatedLessons: Array<{ lessonNumber: number; lesson: any }>) {
  await initDriver(
    process.env.MEMGRAPH_URI || 'bolt://localhost:7687',
    process.env.MEMGRAPH_USER || 'fluentxverse',
    process.env.MEMGRAPH_PASSWORD || 'devpassword123!ChangeMe'
  );

  try {
    const lessons = await lessonMaterialService.listByCourse('business-english');

    for (const updated of updatedLessons) {
      const existing = lessons.find((item) => (
        item.level === 3 &&
        item.chapter === 1 &&
        item.lessonNumber === updated.lessonNumber
      ));

      if (!existing) {
        throw new Error(`Could not find DB lesson for Level 3 Chapter 1 Lesson ${updated.lessonNumber}.`);
      }

      await lessonMaterialService.updateHeader(existing.id, {
        chapterName: updated.lesson.chapterName,
        lessonName: updated.lesson.lessonName,
        goalTextEn: updated.lesson.goalTextEn,
        goalTextJp: updated.lesson.goalTextKr,
        beData: updated.lesson.beData,
      });

      console.log(`Updated DB lesson: ${existing.id}`);
    }
  } finally {
    await closeDriver();
  }
}

async function main() {
  const updatedLessons = await syncFiles();
  await syncDb(updatedLessons);
  console.log('Open-talk discussion instruction synced for Level 3 Chapter 1 Lessons 1-5.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
