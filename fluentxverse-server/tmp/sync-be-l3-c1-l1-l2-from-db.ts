import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { initDriver, closeDriver } from '../src/db/memgraph';
import { lessonMaterialService } from '../src/services/lessonMaterial.service';

const ROOT = path.resolve(import.meta.dir, '../..');
const DOCS_DIR = path.join(ROOT, 'docs/lesson-materials/business-conversation/level-03/lesson-data');
const TMP_DIR = path.join(ROOT, 'fluentxverse-server/tmp');

const FILE_MAP: Record<number, string> = {
  1: 'ch01-L1-pleased-to-meet-you.json',
  2: 'ch01-L2-all-about-me.json',
};

await initDriver('bolt://localhost:7687', 'fluentxverse', 'devpassword123!ChangeMe');
try {
  const lessons = await lessonMaterialService.listByCourse('business-english');
  const targets = lessons
    .filter((l) => l.level === 3 && l.chapter === 1 && (l.lessonNumber === 1 || l.lessonNumber === 2))
    .sort((a, b) => a.lessonNumber - b.lessonNumber);

  for (const lesson of targets) {
    const payload = {
      chapterName: lesson.chapterName,
      lessonName: lesson.lessonName,
      goalTextEn: lesson.goalTextEn,
      goalTextKr: lesson.goalTextJp,
      beData: lesson.beData,
    };
    const fileName = FILE_MAP[lesson.lessonNumber];
    if (!fileName) {
      continue;
    }
    await writeFile(path.join(DOCS_DIR, fileName), `${JSON.stringify(payload, null, 2)}\n`);
    await writeFile(path.join(TMP_DIR, `L${lesson.lessonNumber}-updated.json`), `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`Synced Lesson ${lesson.lessonNumber} from DB`);
  }
} finally {
  await closeDriver();
}
