import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildLeaveBehindChapter } from '../content/conversational-skills/en/level-6-chapter-5/build';
import { buildTraditionsChapter } from '../content/conversational-skills/en/level-6-chapter-1/build';
import { buildTasteTraditionChapter } from '../content/conversational-skills/en/level-6-chapter-3/build';
import { buildBeyondWorkshopChapter } from '../content/conversational-skills/en/level-6-chapter-2/build';
import { cleanLevel6Pronunciation, applyNaturalPronunciation, naturalPronunciationLessons } from '../content/conversational-skills/en/natural-pronunciation';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { conversationalLanguageInstructions } from '../../shared/conversationalLanguage';
import { checkpointPrompt, summarizeCheckpointEvidence } from '../src/services/checkpointLesson.service';

const lessons: any[] = [...buildTraditionsChapter(), ...buildBeyondWorkshopChapter(), ...buildTasteTraditionChapter(), ...buildLeaveBehindChapter()];
const plain = (s: string) => s.replace(/<[^>]+>/g, '');

test('all thirty-two authored Level 6 lessons use relevant linked phrases and meaning groups with partial stress highlighting', () => {
  expect(lessons).toHaveLength(32);
  let linked = 0, grouped = 0;
  for (const lesson of lessons) {
    const focus = lesson.stepBData;
    expect(focus.stepType).toBe('pronunciation');
    expect(focus.grammarTip).toBeUndefined();
    expect(focus.pronunciation.stepName).toBe('STEP B: PRONUNCIATION');
    expect(focus.pronunciation.phrases).toHaveLength(2);
    expect(focus.pronunciation.tutorSteps).toHaveLength(6);
    expect(focus.pronunciation.tip).toContain('Bold marks the stressed');
    for (const item of focus.pronunciation.phrases) {
      expect(item.phrase.length).toBeGreaterThan(8);
      expect(item.pronunciationGuide).toMatch(/^\/ .+ \/$/);
      expect(item.pronunciationGuide).toMatch(/[A-Z]{2,}/);
      const bold = [...item.exampleSentence.matchAll(/<strong>([^<]+)<\/strong>/g)].map((m: any) => m[1]);
      expect(bold.length).toBeGreaterThan(0);
      expect(bold.join('').length).toBeLessThan(plain(item.exampleSentence).length);
      expect(bold.join('')).not.toMatch(/[|‿]/);
      expect(plain(item.exampleSentence)).toMatch(/[.!?]$/);
      if (item.pronunciationGuide.includes('‿')) { linked++; expect(item.exampleSentence).toContain('‿'); }
      if (item.pronunciationGuide.includes('|')) { grouped++; expect(item.exampleSentence).toContain('|'); }
    }
    expect(lesson.learnData.steps[0].pronunciationPart).toBeUndefined();
    expect(lesson.learnData.steps[0].discussionPart.tutorSteps.at(-1).script).toContain('Step B Pronunciation');
    expect(JSON.stringify(lesson.stepBData)).not.toMatch(/reading cues|IPA|accents?/i);
    expect(conversationalLessonErrors(lesson)).toEqual([]);
  }
  expect(linked).toBeGreaterThan(10);
  expect(grouped).toBeGreaterThan(5);
});

test('bold stress remains specific to meaningful words or syllables in representative examples', () => {
  const linking = lessons.find(l => l.chapter === 2 && l.lessonNumber === 1).stepBData.pronunciation.phrases[0];
  expect(linking.exampleSentence).toContain('take‿<strong>on</strong>‿a <strong>role</strong>');
  const grouping = lessons.find(l => l.chapter === 2 && l.lessonNumber === 3).stepBData.pronunciation.phrases[0];
  expect(grouping.exampleSentence).toContain('<strong>work</strong> | but I want my <strong>own path</strong>');
  const weakWords = lessons.find(l => l.chapter === 1 && l.lessonNumber === 3).stepBData.pronunciation.phrases[0];
  expect(weakWords.exampleSentence).toContain('a <strong>cup</strong>‿of <strong>tea</strong>');
});

test('the targeted patch preserves every other property and does not mutate its input', () => {
  const previous = structuredClone(lessons[0]);
  previous.status = 'published';
  previous.id = 'stable-id';
  previous.studentNotes = { text: 'Keep private note', translation: 'Keep this too' };
  previous.exerciseMarks = [{ correct: false }];
  previous.backgroundImage = 'keep.webp';
  previous.stepBData = { stepType: 'grammar-tip', grammarTip: { explanations: [{ ruleText: 'Earlier tip' }] } };
  previous.learnData.steps[0].pronunciationPart = { instruction: 'Old Part III', tutorSteps: [{ script: 'Old transition' }] };
  previous.learnData.steps[0].discussionPart.tutorSteps.at(-1).instruction = 'Transition to Part III.';
  const snapshot = structuredClone(previous);
  const next = applyNaturalPronunciation(previous, naturalPronunciationLessons[1][1]);
  const withoutChangedFields = ({ learnData, stepBData, ...rest }: any) => rest;
  expect(withoutChangedFields(next)).toEqual(withoutChangedFields(previous));
  const oldLearn = structuredClone(previous.learnData), newLearn = structuredClone(next.learnData);
  delete oldLearn.steps[0].pronunciationPart;
  oldLearn.steps[0].discussionPart.tutorSteps.pop(); newLearn.steps[0].discussionPart.tutorSteps.pop();
  expect(newLearn).toEqual(oldLearn);
  expect(previous).toEqual(snapshot);
  expect(() => applyNaturalPronunciation({ ...previous, level: 5 }, naturalPronunciationLessons[1][1])).toThrow('Level 6');
});

test('validation catches missing guides, examples and stress highlighting, and future authoring keeps the pointer', () => {
  let lesson = structuredClone(lessons[0]);
  lesson.stepBData.pronunciation.phrases[0].pronunciationGuide = '';
  expect(conversationalLessonErrors(lesson)).toContain('Pronunciation guides must contain complete items.');
  lesson = structuredClone(lessons[0]);
  lesson.stepBData.pronunciation.phrases[0].exampleSentence = 'No stress shown here.';
  expect(conversationalLessonErrors(lesson)).toContain('Pronunciation examples must bold the stressed words or syllables.');
  lesson = structuredClone(lessons[0]);
  lesson.stepBData = { stepType: 'grammar-tip', grammarTip: { explanations: [{ ruleText: 'A complete older rule' }] } };
  expect(conversationalLessonErrors(lesson)).toContain('Level 6 onward uses Step B Pronunciation for natural connected speech.');
  for (const level of [6, 7, 8]) {
    expect(conversationalLanguageInstructions(level)).toContain('Phrase/Example table');
    expect(conversationalLanguageInstructions(level)).toContain('Bold the exact words or syllables');
  }
});

test('future checkpoint summaries include the active pronunciation focus and persistence has concurrency/evidence guards', () => {
  const prompt = checkpointPrompt(lessons.slice(0, 4), summarizeCheckpointEvidence([], []));
  expect(prompt).toContain('catch‿UP with‿old FRIENDS');
  expect(prompt).toContain('connected-speech phrasing');
  expect(prompt).toContain('generated response fields must still contain no HTML');
  expect(prompt).toContain('Do not identify or invent student weaknesses');
  const writer = readFileSync(new URL('../../scripts/apply-level6-pronunciation.ts', import.meta.url), 'utf8');
  expect(writer).toContain('Concurrent lesson, metadata or learner-evidence change');
  expect(writer).toContain('after.otherLessonDigest !== before.otherLessonDigest');
  expect(writer).toContain('after.evidenceDigest !== before.evidenceDigest');
  expect(writer).not.toMatch(/createAgent|\.generate\(|fetch\(|API_KEY/);
});


test('cleanup removes duplicate pronunciation and extra commentary while preserving Step B examples and bold stress', () => {
  const previous = structuredClone(lessons[0]);
  previous.learnData.steps[0].pronunciationPart = { instruction: 'Part III pronunciation', tutorSteps: [] };
  previous.learnData.steps[0].discussionPart.tutorSteps.at(-1).instruction = 'Transition to Part III.';
  previous.stepBData.pronunciation.tip += ' The guides are reading cues, not IPA. Follow a clear, comfortable accent.';
  previous.stepBData.pronunciation.tutorSteps[2].tip += ' Avoid exaggerated reductions and forced accents.';
  const phrases = structuredClone(previous.stepBData.pronunciation.phrases);
  const result = cleanLevel6Pronunciation(previous);
  expect(result.learnData.steps[0].pronunciationPart).toBeUndefined();
  expect(result.learnData.steps[0].discussionPart.tutorSteps.at(-1).instruction).toBe('Transition to Step B Pronunciation.');
  expect(result.stepBData.pronunciation.phrases).toEqual(phrases);
  expect(JSON.stringify(result.stepBData)).not.toMatch(/IPA|reading cues|accents?/i);
  expect(cleanLevel6Pronunciation(result)).toEqual(result);
  expect(conversationalLessonErrors(previous)).toContain('Level 6 onward must not duplicate Step B pronunciation in Learn Part III.');
});
