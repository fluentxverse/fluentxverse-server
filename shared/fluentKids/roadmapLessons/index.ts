import { lostAndFound } from './lostAndFound';
import { market } from './market';
import { onTheMove } from './onTheMove';
import { dayOut } from './dayOut';
import { clubFair } from './clubFair';
import { wildlifeReport } from './wildlifeReport';
import { designCafe } from './designCafe';
import { planChanged } from './planChanged';
import { missingBag } from './missingBag';
import { betterPark } from './betterPark';
import { kidsNews } from './kidsNews';
import type { RoadmapLesson } from './content';
import type { PublishedRoadmapLessonId } from './publication';

export const roadmapLessons = {
  ...lostAndFound,
  ...market,
  ...onTheMove,
  ...dayOut,
  ...clubFair,
  ...wildlifeReport,
  ...designCafe,
  ...planChanged,
  ...missingBag,
  ...betterPark,
  ...kidsNews,
} satisfies Record<PublishedRoadmapLessonId, RoadmapLesson>;
