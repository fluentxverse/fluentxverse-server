import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chapter3ApprovedArtwork as assets, chapter3ArtworkSlots as slots, chapter3ArtworkUpdates } from '../content/conversational-skills/ja/level-3-chapter-3/artwork';
import { buildToeicLesson } from '../content/conversational-skills/ja/toeic-language';
import type { StoryLessonNumber } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';

const stringifyFields = (lesson: any) => ({ ...lesson, ...Object.fromEntries(['introductionData','applyData','missionData','learnData'].map(k => [k, JSON.stringify(lesson[k])])) });
const lesson = (n: number) => buildToeicLesson(3, 3, n as StoryLessonNumber);
const stripMedia = (value: any): any => Array.isArray(value) ? value.filter(v => v?.type !== 'images').map(stripMedia) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([k]) => !['image','images','introImage','situationImage','backgroundImage'].includes(k)).map(([k,v]) => [k,stripMedia(v)])) : value;

test('all approved review images have unique WebP URLs and unmodified source/content hashes', () => {
  expect(assets).toHaveLength(72);
  expect(new Set(assets.map(a => a.url)).size).toBe(72);
  const review = JSON.parse(readFileSync(new URL('../../output/chapter3-art-previews/review-2026-11-17/manifest.json', import.meta.url), 'utf8'));
  for (const a of assets) {
    const original = review.assets.find((p: any) => p.lesson === a.lesson && p.key === a.key);
    expect(a.approvedPreviewSha256).toBe(original.sha256);
    const bytes = readFileSync(new URL(`../content/conversational-skills/ja/level-3-chapter-3/images/${a.filename}`, import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(a.webpSha256);
    expect(bytes.length).toBe(a.webpBytes); expect(bytes.toString('ascii',0,4)).toBe('RIFF');
    expect(a.url).toBe(`https://api.fluentxverse.com/lesson/files${a.storagePath}`);
  }
});

test('insertion changes only image slots and retains all text, IDs, status, feedback and learner properties', () => {
  for (const n of slots) {
    const l = lesson(n);
    const original = stringifyFields({ ...l, id: `saved-id-${n}`, status: n === 1 ? 'published' : 'draft', studentNotes: 'retain notes', exerciseMarks: { 1: false }, savedCheckpoint: { goal: 'keep' } });
    const before = JSON.stringify(original), updates = chapter3ArtworkUpdates(original);
    expect(Object.keys(updates).sort()).toEqual(['applyData','backgroundImage','introductionData','learnData','missionData']);
    const changed = { ...original, ...updates };
    for (const key of ['id','status','studentNotes','exerciseMarks','savedCheckpoint','feedbackData','storyData','exerciseData','missionData2']) expect(changed[key]).toEqual(original[key]);
    for (const key of ['introductionData','applyData','missionData','learnData']) expect(stripMedia(JSON.parse(changed[key]))).toEqual(stripMedia(JSON.parse(original[key])));
    expect(JSON.stringify(original)).toBe(before);
    const own = assets.filter(a => a.lesson === n);
    expect(own.filter(a => a.kind === 'watercolor')).toHaveLength(3); expect(own.filter(a => a.kind === 'photo')).toHaveLength(6);
    expect(JSON.parse(changed.introductionData).introImage).toBe(own.find(a => a.key === 'introduce')!.url);
    expect(JSON.parse(changed.applyData).situationImage).toBe(own.find(a => a.key === 'apply')!.url);
    expect(JSON.parse(changed.missionData).image).toBe(own.find(a => a.key === 'challenge1')!.url);
    const items = JSON.parse(changed.learnData).steps[0].vocabularyItems;
    for (const item of items) expect(item.image).toBe(own.find(a => a.kind === 'photo' && a.label === item.highlightedWord && a.sentence === item.englishText)!.url);
  }
});

test('reading missions display the approved watercolor once without replacing reading evidence or supplemental images', () => {
  for (const n of [3,8]) {
    const l = lesson(n), passageBefore = structuredClone(l.missionData.readingPassage);
    l.missionData.image = 'previous-primary.webp';
    l.missionData.readingPassage.blocks.push({ type:'images', images:['supplement.webp','previous-primary.webp'] });
    const first = chapter3ArtworkUpdates(stringifyFields(l));
    const m = JSON.parse(first.missionData!);
    expect(m.readingPassage.blocks.slice(0,passageBefore.blocks.length)).toEqual(passageBefore.blocks);
    expect(m.readingPassage.blocks.at(-1).images).toEqual(['supplement.webp',m.image]);
    const again = chapter3ArtworkUpdates({ ...stringifyFields(l), ...first });
    expect(again).toEqual(first);
    expect(m.readingPassage.blocks.flatMap((b: any) => b.images || []).filter((u: string) => u === m.image)).toHaveLength(1);
  }
});

test('checkpoints, unrelated chapters, renamed lessons and changed vocabulary are rejected before writing', () => {
  for (const n of [5,10]) expect(() => chapter3ArtworkUpdates({ ...lesson(1), lessonNumber:n })).toThrow('Unexpected lesson slot');
  expect(() => chapter3ArtworkUpdates({ ...lesson(1), chapter:2 })).toThrow('Unexpected lesson slot');
  expect(() => chapter3ArtworkUpdates({ ...lesson(1), lessonName:'A different story' })).toThrow('Lesson title differs');
  const l = lesson(1); l.learnData.steps[0].vocabularyItems[0].englishText = 'An edited meaning.';
  expect(() => chapter3ArtworkUpdates(l)).toThrow('Vocabulary changed since review');
});

test('writer has transactional snapshot and exact media guards, immutable uploads and full-record verification', () => {
  const source = readFileSync(new URL('../../scripts/apply-chapter3-artwork.ts', import.meta.url), 'utf8');
  expect(source).toContain('Concurrent edit detected; no references changed');
  expect(source).toContain('rollback all image references');
  expect(source).toContain('Refusing to overwrite a different asset');
  expect(source).toContain('Full-record read-back mismatch');
  expect(source).toContain('mode: 0o600');
  expect(source).not.toMatch(/createAgent|\.generate\(|API_KEY|publishLesson|DELETE /);
});
