import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { discussionTopics } from '../content/discussion-questions/topics';
import { buildDiscussionCourse, buildDiscussionMaterial, discussionMaterialErrors, discussionId } from '../content/discussion-questions/build';

const lessons = buildDiscussionCourse();
const words = (s: string) => s.trim().split(/\s+/).length;

test('Discussion Questions fills exactly ten speaking topics at each of five levels', () => {
  expect(lessons).toHaveLength(50);
  expect(new Set(lessons.map(l => l.id)).size).toBe(50);
  expect(new Set(lessons.map(l => l.lessonName)).size).toBe(50);
  for (const level of [1, 2, 3, 4, 5]) {
    const group = lessons.filter(l => l.level === level);
    expect(group.map(l => l.lessonNumber)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    expect(group.flatMap(l => l.discussionQuestionsData.questions)).toHaveLength(200);
    for (const l of group) {
      expect(l.id).toBe(discussionId(level, l.lessonNumber));
      expect([l.course, l.chapter, l.skill, l.status]).toEqual(['discussion-questions', 1, 'speaking', 'draft']);
      expect(discussionMaterialErrors(l)).toEqual([]);
    }
  }
});

test('all one thousand questions are complete, numbered and distinct within each bank', () => {
  const ids: string[] = [];
  for (const l of lessons) {
    const qs = l.discussionQuestionsData.questions;
    expect(qs).toHaveLength(20);
    expect(qs.map((q: {number: number}) => q.number)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(qs.map((q: {question: string}) => q.question.toLowerCase())).size).toBe(20);
    for (const q of qs) {
      ids.push(q.id);
      expect(q.question).toEndWith('?');
      expect(q.question).not.toMatch(/\[topic\]|TODO|TBD|Question \d|<[^>]+>/i);
    }
  }
  expect(ids).toHaveLength(1000); expect(new Set(ids).size).toBe(1000);
});

test('question length and communication demands progress without importing unrelated TOEIC labels', () => {
  const caps = [0, 10, 14, 16, 20, 24];
  const averages: number[] = [];
  for (const level of [1,2,3,4,5]) {
    const qs = lessons.filter(l => l.level === level).flatMap(l => l.discussionQuestionsData.questions);
    expect(Math.max(...qs.map(q => words(q.question)))).toBeLessThanOrEqual(caps[level]!);
    averages.push(qs.reduce((n,q) => n + words(q.question), 0) / qs.length);
  }
  for (let i = 1; i < averages.length; i++) expect(averages[i]).toBeGreaterThan(averages[i - 1]!);
  expect(lessons[40]!.discussionQuestionsData.tutorSteps[1]!.tip).toContain('assumptions, evidence and trade-offs');
  expect(lessons[0]!.discussionQuestionsData.tutorSteps[1]!.tip).toContain('Accept a word or short phrase');
  expect(JSON.stringify(lessons)).not.toMatch(/TOEIC|C1–C2|STEP A|Part III|\bIPA\b/);
});

test('English-only objective-first guides allow selective discussion and voluntary examples', () => {
  for (const l of lessons) {
    const d = l.discussionQuestionsData;
    expect(l.supportLanguage).toBe('en'); expect(l.goalTextJp).toBe('');
    expect(JSON.stringify(l)).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    expect(d.tutorSteps).toHaveLength(5); expect(d.tutorDuration).toBe('20 minutes');
    expect(d.tutorSteps[0]!.script).toStartWith(`Our lesson goal today is: ${l.goalTextEn}`);
    expect(d.tutorSteps[0]!.tip).toContain('real, invented or third-person');
    expect(d.tutorSteps[0]!.tip).toContain('skip a question');
    expect(d.tutorSteps[1]!.instruction).toContain('tutor asks first');
    expect(d.tutorSteps[1]!.script).toBe(d.questions[0]!.question);
    expect(d.tutorSteps[2]!.tip).toContain('not a requirement to finish all 20');
    expect(d.tutorSteps[3]!.tip).toContain('do not request private details');
    expect(d.tutorSteps[4]!.tip).toContain('Do not require a speech');
  }
});

test('feedback is complete, level-appropriate and based on observed responses rather than invented mistakes', () => {
  for (const l of lessons) {
    const f = l.discussionQuestionsData.feedbackData;
    expect(f.goal).toBe(l.goalTextEn); expect(f.goalJp).toBe('');
    expect(f.tutorSteps).toHaveLength(6);
    expect(f.rubricLevels.map((r: {score: number}) => r.score)).toEqual([4,3,2,1]);
    expect(f.categories.map((c: {title: string}) => c.title)).toEqual(['CONTENT & IDEAS', 'ACCURACY', 'FLUENCY & INTERACTION']);
    expect(f.rememberNote).toContain('not claims about this student');
    expect(f.tutorSteps[3]!.tips![0]!.text).toContain('observed performance');
    expect(f.tutorSteps[4]!.tips![0]!.text).toContain('Do not treat an opinion or voluntary refusal as a language mistake');
    expect(f.categories.every((c: {titleJp: string}) => c.titleJp === '')).toBe(true);
  }
});

test('compiler preserves identities, artwork, author, publication state, feedback and learner properties', () => {
  const previous: any = {
    id: 'existing-motorcycle-id', status: 'published', createdBy: 'Ann', createdAt: 'original',
    backgroundImage: 'keep.webp', overlayColor: '#123456cc', studentNotes: 'keep notes', exerciseMarks: [2],
    checkpoint: { text: 'keep review' }, feedbackData: { fixed: true },
    discussionQuestionsData: { customProperty: 'keep', backgroundImage: 'inner.webp', overlayColor: '#000000aa',
      questions: [{ id: 'keep-question-id' }], feedbackData: { fixed: true } },
  };
  const before = JSON.stringify(previous), l: any = buildDiscussionMaterial(discussionTopics[0]!, previous);
  for (const k of ['id','status','createdBy','createdAt','backgroundImage','overlayColor','studentNotes','exerciseMarks','checkpoint','feedbackData']) expect(l[k]).toEqual(previous[k]);
  expect(l.discussionQuestionsData.feedbackData).toEqual({ fixed: true });
  expect(l.discussionQuestionsData.customProperty).toBe('keep');
  expect(l.discussionQuestionsData.backgroundImage).toBe('inner.webp');
  expect(l.discussionQuestionsData.questions[0].id).toBe('keep-question-id');
  expect(JSON.stringify(previous)).toBe(before);
});

test('sensitive themes use hypothetical scenarios and qualified evaluation rather than assumed outcomes', () => {
  expect(discussionTopics[0]!.description).toContain('do not need to ride');
  expect(discussionTopics[13]!.description).toContain('without discussing personal finances');
  const advanced = discussionTopics.filter(t => t.level === 5);
  expect(advanced.every(t => /hypothetical|fictional|imagined/i.test(t.description))).toBe(true);
  expect(advanced[0]!.questions).toContain('What evidence would make you expand or stop a hypothetical trial?');
  expect(advanced[2]!.questions).toContain('When might deciding not to publish be the more responsible outcome?');
  expect(advanced[9]!.questions).toContain('Imagine a committee agrees on priorities but none are completed yet. How should it report progress?');
});

test('validation catches incomplete, repeated and translated topic data before persistence', () => {
  const good = structuredClone(lessons[0]!);
  const incomplete: any = structuredClone(good); incomplete.discussionQuestionsData.questions.pop();
  expect(discussionMaterialErrors(incomplete)).toContain('Expected twenty questions');
  const repeated: any = structuredClone(good); repeated.discussionQuestionsData.questions[1].question = repeated.discussionQuestionsData.questions[0].question;
  expect(discussionMaterialErrors(repeated)).toContain('Repeated question 2');
  const translated: any = structuredClone(good); translated.discussionQuestionsData.topicDescription = '翻訳';
  expect(discussionMaterialErrors(translated)).toContain('Expected English-only content');
});

test('guarded writer preserves occupied drafts and metadata and has no model-backed authoring path', () => {
  const source = readFileSync(new URL('../../scripts/apply-discussion-questions.ts', import.meta.url), 'utf8');
  expect(source).toContain('Concurrent edit detected; no topics changed');
  expect(source).toContain('Full record read-back mismatch');
  expect(source).toContain('Existing manually filled topic requires review');
  expect(source).toContain("mode: 0o600");
  expect(source).toContain('digest(after.metadata) !== digest(before.metadata)');
  expect(source).not.toMatch(/\.generate\(|createAgent|fetch\(|API_KEY|publishLesson|DELETE /);
  for (const name of ['topics.ts', 'build.ts']) {
    const content = readFileSync(new URL(`../content/discussion-questions/${name}`, import.meta.url), 'utf8');
    expect(content).not.toMatch(/\.generate\(|createAgent|fetch\(|API_KEY/);
  }
});
