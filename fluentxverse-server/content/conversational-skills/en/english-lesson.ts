import { buildNewBeginningLesson, type Episode, type StoryLessonConfig, type StoryLessonNumber } from '../ja/level-3-chapter-1/new-beginning';
import { clearConversationalTranslations } from '../../../../shared/conversationalLanguage';
import { buildNaturalPronunciation, cleanLevel6Pronunciation, type NaturalPronunciationLesson } from './natural-pronunciation';

export interface EnglishExpressionEpisode {
  title: string; skill: Episode['skill']; goal: string; intro: string; warmup: string;
  expressions: [string, string, string][];
  discussion: string; followup: string;
  tips: { rule: string; examples: string[] }[];
  apply: Omit<Episode['apply'], 'situation'> & { situation: string };
  choose: Episode['choose']; choices: Episode['choices'];
  mission: Omit<Episode['mission'], 'situation' | 'task'> & { situation: string; task: string };
  topics: Episode['topics']; trivia: string; triviaQuestion: Episode['triviaQuestion']; closing: string;
}

function retainArtwork(previous: any, next: any): any {
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return next;
  if (Array.isArray(previous) && Array.isArray(next)) return next.map((v, i) => retainArtwork(previous[i], v));
  for (const [key, value] of Object.entries(previous)) {
    if (/image|background/i.test(key)) next[key] = structuredClone(value);
    else if (key in next) next[key] = retainArtwork(value, next[key]);
  }
  return next;
}

export function buildEnglishExpressionLesson(number: StoryLessonNumber, e: EnglishExpressionEpisode,
  previous: any, reference: any, config: Omit<StoryLessonConfig, 'episode'> & { pronunciation: NaturalPronunciationLesson }) {
  const pair = (text: string): [string, string] => [text, ''];
  const episode: Episode = { ...e, goal: pair(e.goal), intro: pair(e.intro), words: [],
    discussion: pair(e.discussion), tips: e.tips.map(t => ({ rule: pair(t.rule), examples: t.examples.map(pair) })),
    apply: { ...e.apply, situation: pair(e.apply.situation) },
    mission: { ...e.mission, situation: pair(e.mission.situation), task: pair(e.mission.task) }, trivia: pair(e.trivia) };
  const built = buildNewBeginningLesson(number, previous, 'https://api.fluentxverse.com', reference, { ...config, episode });
  const lesson = { ...previous, ...clearConversationalTranslations(built) };
  lesson.introductionData.introTexts = [{ language: 'en', text: e.intro }];
  const step = lesson.learnData.steps[0];
  step.stepType = 'expressions'; step.stepName = 'STEP A: EXPRESSIONS';
  step.partLabel = 'I. Explore the expressions with your tutor. Read the meanings and examples.';
  delete step.vocabularyItems;
  step.expressionItems = e.expressions.map(([phrase, meaning, example]) => ({ image: '',
    definitionLine: `<strong>${phrase}</strong> ${meaning}`, exampleSentence: `<em>${example}</em>` }));
  step.tutorSteps = [
    { instruction: 'Introduce Step A Expressions.', script: 'Let’s explore four expressions from today’s situation.' },
    { instruction: 'Read the instructions and check understanding.', script: 'Read each meaning and example. Is it clear?' },
    { instruction: 'Model the first expression and example, then ask the student to repeat.', tip: 'Check the meaning in context. Model natural stress, not isolated words only.' },
    { instruction: 'Repeat with the other three expressions.', tip: 'Ask for one short response using an expression. Correct the form or meaning when needed.' },
    { instruction: 'Transition to Part II.', script: 'Good. Let’s use these expressions in a conversation.' },
  ];
  step.discussionPart.tutorSteps[2] = { instruction: 'Have the student respond using a relevant expression from Part I.', tip: 'Use the assigned character and situation. Accept a natural paraphrase; do not force every expression into one answer.' };
  delete step.pronunciationPart;
  step.discussionPart.tutorSteps[4] = { instruction: 'Transition to Step B Pronunciation.', script: 'Good. Let’s go to Step B Pronunciation.' };
  lesson.stepBData = { stepType: 'pronunciation', pronunciation: buildNaturalPronunciation(config.pronunciation) };
  lesson.supportLanguage = 'en';
  return cleanLevel6Pronunciation(retainArtwork(previous, lesson));
}
