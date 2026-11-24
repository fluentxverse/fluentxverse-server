import { buildNewBeginningLesson, newBeginningEpisodes, storyLessonNumbers, type StoryLessonNumber } from './level-3-chapter-1/new-beginning';
import { buildKyotoLesson, chapter2Episodes } from './level-3-chapter-2/build';
import { buildEverydayLesson, chapter3Episodes } from './level-3-chapter-3/build';
import { buildCareerLesson, chapter4Episodes } from './level-3-chapter-4/build';
import { buildTwoCitiesLesson, chapter5Episodes } from './level-3-chapter-5/build';
import { buildAfterTruthLesson, afterTruthEpisodes } from './level-4-chapter-1/build';
import { buildNewPathsLesson, newPathsEpisodes } from './level-4-chapter-2/build';
import { buildLittleCloserLesson, littleCloserEpisodes } from './level-4-chapter-3/build';
import { buildDreamsInMotionLesson, dreamsInMotionEpisodes } from './level-4-chapter-4/build';
import { buildWhereWeBelongLesson, whereWeBelongEpisodes } from './level-4-chapter-5/build';
import { buildFirstImpressionsLesson, firstImpressionsEpisodes } from './level-5-chapter-1/build';

export const languageCatalog = [
  { level: 3, chapter: 1, episodes: newBeginningEpisodes, build: (n: StoryLessonNumber, p: any = {}, r?: any) => ({ ...buildNewBeginningLesson(n, p, 'https://api.fluentxverse.com', r), course: 'conversational-skills', level: 3, chapter: 1, lessonNumber: n, levelBadge: 'BEGINNER', chapterLabel: 'Chapter 1: A New Beginning', status: p.status || 'draft' }) },
  { level: 3, chapter: 2, episodes: chapter2Episodes, build: buildKyotoLesson },
  { level: 3, chapter: 3, episodes: chapter3Episodes, build: buildEverydayLesson },
  { level: 3, chapter: 4, episodes: chapter4Episodes, build: buildCareerLesson },
  { level: 3, chapter: 5, episodes: chapter5Episodes, build: buildTwoCitiesLesson },
  { level: 4, chapter: 1, episodes: afterTruthEpisodes, build: buildAfterTruthLesson },
  { level: 4, chapter: 2, episodes: newPathsEpisodes, build: buildNewPathsLesson },
  { level: 4, chapter: 3, episodes: littleCloserEpisodes, build: buildLittleCloserLesson },
  { level: 4, chapter: 4, episodes: dreamsInMotionEpisodes, build: buildDreamsInMotionLesson },
  { level: 4, chapter: 5, episodes: whereWeBelongEpisodes, build: buildWhereWeBelongLesson },
  { level: 5, chapter: 1, episodes: firstImpressionsEpisodes, build: buildFirstImpressionsLesson },
];
export const languageSlots = languageCatalog.flatMap(chapter => storyLessonNumbers.map(number => ({ ...chapter, number, key: `${chapter.level}:${chapter.chapter}:${number}` })));
