import { expect, test } from 'bun:test';
import { writtenFixture } from './application.fixtures';
import { validateNewWrittenContent, validateWrittenReview, writtenReviewInput, mergeWrittenAuthorRepairs, parseWrittenReviews, normalizeWrittenAuthor, finalizeWrittenReview, shuffleWrittenOptions } from '../src/services/exam.services/writtenQuality';

const fixture = () => {
  const exam = writtenFixture();
  exam.passages[0]!.content = Array.from({ length: 160 }, (_, i) => `word${i}`).join(' ');
  for (const q of exam.questions) {
    if (q.type === 'comprehension') q.question = `According to paragraph ${q.id}, when does the lesson start?`;
    else q.sentence = `In classroom ${q.id}, the lesson ____ soon.`;
  }
  return exam;
};
const reviews = () => ({ reviews: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, validOptions: [i < 20 ? 'starts' : 'Monday'], issue: 'none', reason: 'One option fits the supplied context.' })) });
const authoredFixture = () => { const exam = fixture(); return { ...exam,
  questions: exam.questions.map(({ correctAnswer, ...q }) => q) }; };

test('new assessments enforce ordered sections, one blank, unique stems, and passage length/use', () => {
  expect(validateNewWrittenContent(fixture()).questions).toHaveLength(30);
  for (const mutate of [
    (e: any) => e.questions.reverse(),
    (e: any) => e.questions[0].sentence = 'The lesson starts soon.',
    (e: any) => e.questions[0].sentence = 'The ____ lesson ____ soon.',
    (e: any) => e.questions[1].sentence = e.questions[0].sentence,
    (e: any) => e.passages[0].content = 'Too short.',
    (e: any) => e.passages.push({ id: 2, title: 'Unused', content: e.passages[0].content }),
  ]) {
    const exam = fixture(); mutate(exam);
    expect(() => validateNewWrittenContent(exam)).toThrow('quality check');
  }
});

test('reviewer sees the exact option wording and passages, but not the proposed answer key', () => {
  const exam = fixture();
  const input = writtenReviewInput(exam), parsed = JSON.parse(input);
  expect(input).not.toContain('correctAnswer');
  expect(parsed.questions[10].options).toEqual(exam.questions[10]!.options);
  expect(parsed.passages).toEqual(exam.passages);
});

test('quality gate requires every item to have exactly one independently matching answer', () => {
  expect(() => validateWrittenReview(fixture(), reviews())).not.toThrow();
  for (const mutate of [
    (r: any) => r.reviews.pop(),
    (r: any) => r.reviews[1].id = 1,
    (r: any) => r.reviews[10].validOptions = [],
    (r: any) => r.reviews[10].validOptions = ['starts', 'start'],
    (r: any) => r.reviews[10].validOptions = ['starts', 'starts'],
    (r: any) => r.reviews[10].validOptions = ['start'],
    (r: any) => r.reviews[10].validOptions = ['invented option'],
    (r: any) => r.reviews[10].issue = 'grammar',
    (r: any) => r.reviews[20].issue = 'unsupported',
    (r: any) => r.reviews[20].issue = 'ambiguous',
  ]) {
    const review = reviews(); mutate(review);
    expect(() => validateWrittenReview(fixture(), review)).toThrow();
  }
});

test('bad passive-voice vocabulary cannot pass a flagged review, even with a matching answer key', () => {
  const exam = fixture();
  Object.assign(exam.questions[12]!, { sentence: 'The old building was scheduled to be ____ next month.',
    options: ['construct', 'destroy', 'create', 'design'], correctAnswer: 1 });
  const review = reviews(); review.reviews[12] = { id: 13, validOptions: [], issue: 'grammar', reason: 'All options are bare verbs; a passive participle is required.' };
  expect(() => validateWrittenReview(exam, review)).toThrow('quality check');
});

test('targeted repairs cannot rewrite approved questions, passages, IDs, or section types', () => {
  const exam = authoredFixture(), original = structuredClone(exam);
  const replacement = { ...exam.questions[12]!, sentence: 'The unsafe building was to be ____ rather than repaired.',
    options: ['demolished', 'decorated', 'enlarged', 'occupied'] };
  const next = mergeWrittenAuthorRepairs(exam, { questions: [replacement] }, [13]);
  expect(next.questions[12]).toEqual(replacement);
  expect(next.passages).toEqual(exam.passages);
  expect(next.questions.filter(q => q.id !== 13)).toEqual(exam.questions.filter(q => q.id !== 13));
  expect(exam).toEqual(original);
  for (const questions of [[], [replacement, replacement], [{ ...replacement, id: 12 }], [{ ...replacement, type: 'grammar' }]])
    expect(() => mergeWrittenAuthorRepairs(exam, { questions }, [13])).toThrow();
  expect(parseWrittenReviews({ reviews: [reviews().reviews[12]] }, [exam.questions[12]!])).toHaveLength(1);
  expect(() => parseWrittenReviews({ reviews: [reviews().reviews[11]] }, [exam.questions[12]!])).toThrow();
});

test('the blind solver establishes stored indexes from literal choices, never model-supplied positions', () => {
  const authored = authoredFixture();
  authored.questions[0]!.options = ['start', 'starting', 'started', 'starts'];
  const review = reviews();
  const normalized = finalizeWrittenReview(normalizeWrittenAuthor(authored), review);
  expect(normalized.questions[0]!.correctAnswer).toBe(3);
  expect(JSON.stringify(normalized)).not.toContain('correctOption');
  review.reviews[0]!.validOptions = ['STARTS'];
  expect(finalizeWrittenReview(authored, review).questions[0]!.correctAnswer).toBe(3);
  review.reviews[0]!.validOptions = ['not an option'];
  expect(() => finalizeWrittenReview(authored, review)).toThrow('quality check');
});

test('one malformed authored item can be repaired without regenerating all thirty', () => {
  const draft = authoredFixture(), original = structuredClone(draft.questions[4]!);
  draft.questions[4]!.options = ['either', 'neither', 'both', 'either'];
  expect(() => normalizeWrittenAuthor(draft)).toThrow();
  const repaired = mergeWrittenAuthorRepairs(draft, { questions: [original] }, [5]);
  expect(normalizeWrittenAuthor(repaired).questions).toHaveLength(30);
  expect(repaired.passages).toEqual(draft.passages);
});

test('every option permutation preserves the correct literal answer and leaves saved source untouched', () => {
  const source = fixture(), original = structuredClone(source);
  const permutations = new Set<string>();
  for (let a = 0; a < 4; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 2; c++) {
    for (let answer = 0; answer < 4; answer++) {
      const exam = structuredClone(source);
      exam.questions.forEach(q => { q.correctAnswer = answer as 0 | 1 | 2 | 3; });
      let call = 0;
      const shuffled = shuffleWrittenOptions(exam, () => [a, b, c][call++ % 3]!);
      permutations.add(shuffled.questions[0]!.options.join('|'));
      for (let i = 0; i < 30; i++) {
        const before = exam.questions[i]!, after = shuffled.questions[i]!;
        expect(after.options[after.correctAnswer]).toBe(before.options[answer]!);
        expect([...after.options].sort()).toEqual([...before.options].sort());
        expect(after.id).toBe(before.id);
        expect(after.type).toBe(before.type);
      }
      expect(validateNewWrittenContent(shuffled).questions).toEqual(shuffled.questions);
    }
  }
  expect(permutations.size).toBe(24);
  expect(source).toEqual(original);
  expect(() => shuffleWrittenOptions(source, () => 4)).toThrow('Invalid shuffle index');
});

test('weak reading distractors trigger targeted repair even when a unique answer exists', () => {
  const exam = authoredFixture(), review = reviews();
  review.reviews[20] = { id: 21, validOptions: ['Monday'], issue: 'weak_distractors',
    reason: 'The unrelated alternatives reveal the answer without reading.' };
  try {
    finalizeWrittenReview(exam, review);
    throw Error('Expected rejection');
  } catch (error: any) {
    expect(error.questionIds).toEqual([21]);
    expect(error.feedback).toContain('weak_distractors');
  }
});
