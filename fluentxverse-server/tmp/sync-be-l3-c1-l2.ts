import fs from 'fs';
import path from 'path';
import neo4j from 'neo4j-driver';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';

const sourcePath = path.resolve(
  process.cwd(),
  '../docs/lesson-materials/business-conversation/level-03/lesson-data/ch01-L2-all-about-me.json',
);

async function main() {
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

  await initDriver(
    process.env.MEMGRAPH_URI || 'bolt://localhost:7687',
    process.env.MEMGRAPH_USER || 'fluentxverse',
    process.env.MEMGRAPH_PASSWORD || 'devpassword123!ChangeMe',
  );
  const driver = getDriver();
  const session = driver.session();

  try {
    const result = await session.run(
      `MATCH (l:LessonMaterial {
        course: $course,
        level: $level,
        chapter: $chapter,
        lessonNumber: $lessonNumber
      })
      RETURN l.id AS id, l.skill AS skill
      ORDER BY l.updatedAt DESC
      LIMIT 1`,
      {
        course: 'business-english',
        level: neo4j.int(3),
        chapter: neo4j.int(1),
        lessonNumber: neo4j.int(2),
      },
    );

    if (result.records.length === 0) {
      throw new Error('Lesson not found in DB');
    }

    const lessonRecord = result.records[0];
    if (!lessonRecord) {
      throw new Error('Lesson not found in DB');
    }
    const lessonId = lessonRecord.get('id');

    await session.run(
      `MATCH (l:LessonMaterial {id: $id})
       SET l.chapterName = $chapterName,
           l.lessonName = $lessonName,
           l.goalTextEn = $goalTextEn,
           l.goalTextJp = $goalTextJp,
           l.beData = $beData,
           l.updatedAt = datetime()
       RETURN l.id AS id`,
      {
        id: lessonId,
        chapterName: source.chapterName,
        lessonName: source.lessonName,
        goalTextEn: source.goalTextEn || '',
        goalTextJp: source.goalTextJp || source.goalTextKr || '',
        beData: JSON.stringify(source.beData),
      },
    );

    const verifyResult = await session.run(
      `MATCH (l:LessonMaterial {id: $id})
       RETURN l.beData AS beData`,
      { id: lessonId },
    );

    const verifyRecord = verifyResult.records[0];
    if (!verifyRecord) {
      throw new Error('Lesson verification failed');
    }
    const verified = verifyRecord.get('beData');

    console.log(
      JSON.stringify(
        {
          lessonId,
          patternCount: verified.present?.patterns?.length ?? 0,
          tutorNoteCount: verified.present?.tutorNotes?.length ?? 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await session.close();
    await closeDriver();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
