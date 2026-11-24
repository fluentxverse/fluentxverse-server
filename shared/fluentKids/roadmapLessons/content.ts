export type Bilingual = readonly [english: string, japanese: string];

export interface Picture {
  key: string;
  alt: string;
}

export interface StudyCard {
  title: Bilingual;
  text: Bilingual;
  picture?: Picture;
}

export interface StudyTable {
  title: Bilingual;
  columns: readonly Bilingual[];
  rows: readonly (readonly Bilingual[])[];
  layout?: 'map';
}

export type Question = readonly [prompt: Bilingual, answer: Bilingual, other: Bilingual, why: Bilingual, picture?: Picture];

export interface SpeakingTask {
  title: Bilingual;
  steps: readonly [Bilingual, Bilingual, Bilingual];
}

export interface RoadmapLesson {
  titleJa: string;
  unitJa: string;
  goal: Bilingual;
  art: Picture;
  opening: Bilingual;
  study: Bilingual;
  cards: readonly StudyCard[];
  table?: StudyTable;
  models: readonly [StudyCard, StudyCard];
  storyTitle: Bilingual;
  dialogue: readonly (readonly [speaker: string, line: Bilingual])[];
  questions: readonly Question[];
  missionTitle: Bilingual;
  younger: SpeakingTask;
  older: SpeakingTask;
  tutor: Bilingual;
  checks: readonly Bilingual[];
  bonus: Bilingual;
}

export type RoadmapId = `fluent-kids-l${2 | 3}-u${number}-l${number}`;
