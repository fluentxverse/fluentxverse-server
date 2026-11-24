import { expect, test } from 'bun:test';
import { planConversationalLevel4Move, type CurriculumSnapshot } from '../../scripts/lib/conversational-level4-plan';
import { buildAfterTruthChapter } from '../content/conversational-skills/ja/level-4-chapter-1/build';
import { buildNewPathsChapter } from '../content/conversational-skills/ja/level-4-chapter-2/build';
import { buildLittleCloserChapter } from '../content/conversational-skills/ja/level-4-chapter-3/build';

const now = '2026-11-13T08:00:00.000Z';
const fixture = (): CurriculumSnapshot => ({
  lessons: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(chapter => ({
    course: 'conversational-skills', level: 3, chapter, lessonNumber: 1,
    id: `stable-${chapter}`, chapterName: `Story ${chapter}`, status: 'draft',
    exerciseData: '{"answers":["keep"]}', feedbackData: '{"categories":["KEEP"]}',
  })),
  metadata: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(chapter => ({ course: 'conversational-skills', type: 'chapter', level: 3, chapter, name: `Story ${chapter}`, theme: 'Keep' })),
  evidence: { count: 0, digest: 'unchanged' },
});
test('the migration maps Chapters 6-10 to Level 4 Chapters 1-5 without changing IDs or content', () => {
  const before = fixture(), frozen = JSON.stringify(before);
  const plan = planConversationalLevel4Move(before, now);
  expect(plan.lessons.map(move => [move.fromChapter, move.patch.level, move.patch.chapter])).toEqual([[6, 4, 1], [7, 4, 2], [8, 4, 3], [9, 4, 4], [10, 4, 5]]);
  for (const move of plan.lessons) {
    expect(move.id).toBe(`stable-${move.fromChapter}`);
    expect(Object.keys(move.patch).sort()).toEqual(['chapter', 'chapterLabel', 'level', 'levelBadge', 'updatedAt']);
    expect(move.patch.chapterLabel).toBe(`Chapter ${move.fromChapter - 5}: Story ${move.fromChapter}`);
  }
  expect(plan.metadata.map(move => move.patch.chapter)).toEqual([1, 2, 3, 4, 5]);
  expect(JSON.stringify(before)).toBe(frozen);
});
test('the migration refuses occupied lesson or metadata destinations and published content', () => {
  const occupied = fixture(); occupied.lessons.push({ level: 4, chapter: 1 });
  expect(() => planConversationalLevel4Move(occupied, now)).toThrow('occupied');
  const occupiedMeta = fixture(); occupiedMeta.metadata.push({ type: 'chapter', level: 4, chapter: 2 });
  expect(() => planConversationalLevel4Move(occupiedMeta, now)).toThrow('occupied');
  const published = fixture(); published.lessons[5]!.status = 'published';
  expect(() => planConversationalLevel4Move(published, now)).toThrow('drafts');
});
test('saved evidence, duplicate slots and absent or duplicated metadata fail before writing', () => {
  const evidence = fixture(); evidence.evidence.count = 1;
  expect(() => planConversationalLevel4Move(evidence, now)).toThrow('learner evidence');
  const duplicate = fixture(); duplicate.lessons.push({ ...duplicate.lessons[5], id: 'another-id' });
  expect(() => planConversationalLevel4Move(duplicate, now)).toThrow('duplicate source slot');
  const meta = fixture(); meta.metadata = meta.metadata.filter(row => row.chapter !== 6);
  expect(() => planConversationalLevel4Move(meta, now)).toThrow('metadata');
  const empty = fixture(); empty.lessons = []; empty.metadata = [];
  expect(() => planConversationalLevel4Move(empty, now)).toThrow('No Level 3');
});
test('authoring templates now target Level 4 but preserve a saved draft ID', () => {
  for (const [index, lessons] of [buildAfterTruthChapter(), buildNewPathsChapter(), buildLittleCloserChapter()].entries()) {
    for (const lesson of lessons) {
      expect(lesson.level).toBe(4);
      expect(lesson.chapter).toBe(index + 1);
      expect(lesson.chapterLabel).toStartWith(`Chapter ${index + 1}:`);
      expect(lesson.id).toStartWith(`conversational-skills-L4-C${index + 1}-`);
    }
  }
});
