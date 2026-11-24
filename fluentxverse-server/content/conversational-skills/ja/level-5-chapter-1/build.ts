import { readFileSync } from "node:fs";
import { languageEpisodeErrors } from "../language-validation";
import { conversationalLanguageInstructions } from "../../../../../shared/conversationalLanguage";
import { buildNewBeginningLesson, storyLessonNumbers, type Episode, type StoryLessonNumber } from '../level-3-chapter-1/new-beginning';

export const firstImpressionsEpisodes = Object.fromEntries(storyLessonNumbers.map(number => {
  const saved = JSON.parse(readFileSync(new URL(`../toeic-revisions-v1/L5-C1-${number}.json`, import.meta.url), "utf8"));
  const errors = languageEpisodeErrors(saved.episode, 5, saved.episode.skill);
  if (!saved.review.approved || saved.review.issues.length || errors.length) throw Error(`Unapproved First Impressions lesson ${number}: ${errors.join("; ")}`);
  return [number, saved.episode];
})) as Record<StoryLessonNumber, Episode>;

export const firstImpressionsId = (number: StoryLessonNumber) => `conversational-skills-L5-C1-${number}-${firstImpressionsEpisodes[number].skill}-ja-v1`;
export function buildFirstImpressionsLesson(number: StoryLessonNumber, previous: any = {}, reference?: any) {
  const index = storyLessonNumbers.indexOf(number);
  const lesson = buildNewBeginningLesson(number, previous, 'https://api.fluentxverse.com', reference, {
    episode: firstImpressionsEpisodes[number], id: firstImpressionsId(number), chapterName: 'First Impressions',
    setting: 'Eastbridge Creative, a fictional international marketing agency in Tokyo; an informal team dinner in Shinjuku. This is a separate cast and story from Kamo House.',
    previousSummary: index === 0 ? 'A new Level 5 series, Tokyo After Hours, begins. Mika Tanaka moves from an Osaka marketing job to Eastbridge Creative in Tokyo. The Kamo House story is complete; these characters have no established link to it.' : firstImpressionsEpisodes[storyLessonNumbers[index - 1]!].closing,
    storyNotes: `${conversationalLanguageInstructions(5)}\nTokyo After Hours, First Impressions: the revised friendship-only outline. Preserve the new jobs, different audience ideas, shared task list, older report disappearing and Northstar printer cliffhanger. Ethan is from Bristol and Soo-jin from Seoul. No romance or personal dating questions. No mistaken-email or deleted-proposal incident in this chapter. No confirmed external leak or culprit. Speaking is tutor-first dialogue. Listening stays private; reading challenges have fresh evidence. Slots 5/10 remain dynamic checkpoints. No artwork.`,
  });
  lesson.storyData.storyTitle = 'Tokyo After Hours';
  const learn = lesson.learnData.steps[0];
  learn.discussionPart.tutorSteps[2].tip = 'Use the supplied character situation and short, clear reasons.';
  lesson.stepBData.grammarTip.tutorSteps[1].tip = 'Accept an example from the scene. Give one brief correction if needed.';
  learn.pronunciationPart = {
    instruction: 'Listen and repeat. Practise /s/ and /z/ in the word pairs.',
    instructionTranslation: '聞いて繰り返しましょう。単語のペアで /s/ と /z/ を練習しましょう。',
    leftColumn: { soundSymbol: '/s/', images: [], words: [{ word: 'sip', translation: '少しずつ飲む', isHighlighted: true }, { word: 'price', translation: '価格' }, { word: 'bus', translation: 'バス' }] },
    rightColumn: { soundSymbol: '/z/', images: [], words: [{ word: 'zip', translation: 'ファスナーを閉める', isHighlighted: true }, { word: 'prize', translation: '賞' }, { word: 'buzz', translation: 'ブーンという音' }] },
    tutorSteps: [
      { instruction: 'Introduce Part III and read the instructions.', script: 'Now let\'s practise /s/ and /z/. Listen and repeat.' },
      { instruction: 'Model /s/, then read each word on the left and have the student repeat.', tip: 'Let air flow without voice. Keep the final sound clear without adding a vowel.' },
      { instruction: 'Model /z/, then read each word on the right and have the student repeat.', tip: 'Keep a similar mouth position and add voice. Model a gentle vibration rather than a louder sound.' },
      { instruction: 'Read each pair and have the student repeat.', script: 'Sip, zip. Price, prize. Bus, buzz.', tip: 'Repeat one difficult pair if needed. Keep this to about one minute.' },
      { instruction: 'Transition to Step B.', script: `Great! Let\'s go to Step B ${firstImpressionsEpisodes[number].skill === 'reading' ? 'Reading' : 'Grammar'} Tip!` },
    ],
  };
  lesson.storyData.characters = [
    { id: 'mika', name: 'Mika Tanaka', role: 'main', description: 'Marketing professional from Osaka with three years of experience. New in Tokyo, observant and ambitious; learns to clarify feedback, report errors and separate facts from assumptions.' },
    { id: 'ethan', name: 'Ethan', role: 'supporting', description: 'Confident project manager who coordinates the hotel proposal, uses humour and helps Mika settle in. Has professional tension with Daichi; no romance.' },
    { id: 'soo-jin', name: 'Soo-jin', role: 'supporting', description: 'Perceptive creative director who moved from Seoul to Tokyo. Supports Mika and asks for evidence before conclusions; her reactions do not yet reveal a secret.' },
    { id: 'daichi', name: 'Daichi', role: 'supporting', description: 'Reserved senior analyst who checks the proposal research and gives direct feedback. He notices the older report disappear. His knowledge of the Northstar printer pages remains unexplained.' },
  ];
  return { ...lesson, course: 'conversational-skills', level: 5, chapter: 1, lessonNumber: number, levelBadge: 'ELEMENTARY', chapterLabel: 'Chapter 1: First Impressions', status: previous?.status || 'draft', overlayColor: '#17252bcc', supportLanguage: 'ja', authoringLanguageTarget: 'TOEIC 225-545', authoringLanguageRevision: 'toeic-v1' };
}
export function buildFirstImpressionsChapter(reference?: any) {
  return storyLessonNumbers.map(number => buildFirstImpressionsLesson(number, {}, reference));
}
