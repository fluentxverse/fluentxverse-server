import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { initDriver, closeDriver } from '../src/db/memgraph';
import { lessonMaterialService } from '../src/services/lessonMaterial.service';

const ROOT = path.resolve(import.meta.dir, '../..');
const DOCS_DIR = path.join(ROOT, 'docs/lesson-materials/business-conversation/level-03/lesson-data');
const TMP_DIR = path.join(ROOT, 'fluentxverse-server/tmp');

const FILES: Record<number, string> = {
  1: 'ch01-L1-pleased-to-meet-you.json',
  2: 'ch01-L2-all-about-me.json',
  3: 'ch01-L3-tell-me-about-yourself.json',
  4: 'ch01-L4-whos-who.json',
};

const standardChallengeNotes = (questionNotes: Array<{ type?: string; text?: string }>) => {
  const cleanQuestions = questionNotes
    .filter((note) => note?.type === 'question' && (note?.text || '').trim())
    .map((note) => ({ type: 'question', text: (note?.text || '').trim() }));

  return [
    { type: 'script', text: '"Now let\'s do simulation"' },
    { type: 'script', text: '"First please read the Key Expressions. You may use the Key Expressions in the Simulation."' },
    { type: 'instruction', text: 'Read the simulation.' },
    { type: 'script', text: '"Is it clear?" ...Now let\'s start our roleplay!' },
    { type: 'instruction', text: 'Use the prompt questions to guide the roleplay.' },
    { type: 'instruction', text: 'Give feedback after finishing.' },
    { type: 'tip', text: 'This must be a real-life simulation, distinct from Practice. Corrections should only be done after the exercise.' },
    ...cleanQuestions,
  ];
};

const standardDiscussionNotes = [
  { type: 'script', text: '"Now, let\'s have a discussion."' },
  { type: 'instruction', text: 'Read the instruction.' },
  { type: 'instruction', text: 'Ask the student to choose a category.' },
  { type: 'instruction', text: 'You can ask follow-up questions and have a natural conversation with the student until the time for feedback.' },
  { type: 'tip', text: 'If the student cannot choose, pick one. Encourage full sentences.' },
];

async function main() {
  await initDriver(
    process.env.MEMGRAPH_URI || 'bolt://localhost:7687',
    process.env.MEMGRAPH_USER || 'fluentxverse',
    process.env.MEMGRAPH_PASSWORD || 'devpassword123!ChangeMe'
  );

  try {
    const lessons = await lessonMaterialService.listByCourse('business-english');
    const targets = lessons
      .filter((lesson) => lesson.level === 3 && lesson.chapter === 1 && lesson.lessonNumber >= 1 && lesson.lessonNumber <= 4)
      .sort((a, b) => a.lessonNumber - b.lessonNumber);

    for (const lesson of targets) {
      const fileName = FILES[lesson.lessonNumber];
      if (!fileName) continue;

      const lessonPath = path.join(DOCS_DIR, fileName);
      const tmpPath = path.join(TMP_DIR, `L${lesson.lessonNumber}-updated.json`);
      const raw = await readFile(lessonPath, 'utf8');
      const source = JSON.parse(raw);

      const beData = lesson.beData || source.beData || {};
      beData.challenge = beData.challenge || {};
      beData.discussion = beData.discussion || {};
      beData.challenge.tutorNotes = standardChallengeNotes(beData.challenge.tutorNotes || []);
      beData.discussion.tutorNotes = standardDiscussionNotes;

      const updated = {
        ...source,
        chapterName: lesson.chapterName || source.chapterName,
        lessonName: lesson.lessonName || source.lessonName,
        goalTextEn: lesson.goalTextEn || source.goalTextEn,
        goalTextKr: lesson.goalTextJp || source.goalTextKr,
        beData,
      };

      await writeFile(lessonPath, `${JSON.stringify(updated, null, 2)}\n`);
      await writeFile(tmpPath, `${JSON.stringify(updated, null, 2)}\n`);

      await lessonMaterialService.updateHeader(lesson.id, {
        chapterName: updated.chapterName,
        lessonName: updated.lessonName,
        goalTextEn: updated.goalTextEn,
        goalTextJp: updated.goalTextKr,
        beData: updated.beData,
      });

      console.log(`Synced Lesson ${lesson.lessonNumber}: ${lesson.id}`);
    }
  } finally {
    await closeDriver();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
