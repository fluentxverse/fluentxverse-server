import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { conversationalChapterCount, conversationalChapters, isLessonChapterAllowed } from '../../shared/conversationalCurriculum';

test('all non-starter levels are limited to five chapters, including Levels 3 and 4', () => {
  expect(conversationalChapterCount(1)).toBe(1);
  expect(conversationalChapters(1)).toEqual([1]);
  for (const level of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    expect(conversationalChapterCount(level)).toBe(5);
    expect(conversationalChapters(level)).toEqual([1, 2, 3, 4, 5]);
  }
});
test('API bounds preserve other courses and reject fractional or out-of-range chapters', () => {
  for (const level of [3, 4]) {
    for (const chapter of [1, 5]) expect(isLessonChapterAllowed('conversational-skills', level, chapter)).toBe(true);
    for (const chapter of [0, -1, 2.5, 6, 10, 11, NaN, Infinity]) expect(isLessonChapterAllowed('conversational-skills', level, chapter)).toBe(false);
  }
  expect(isLessonChapterAllowed('conversational-skills', 1, 2)).toBe(false);
  for (const course of ['business-english', 'workplace-communication', 'daily-dispatch']) {
    expect(isLessonChapterAllowed(course, 3, 5)).toBe(true);
    expect(isLessonChapterAllowed(course, 3, 6)).toBe(false);
  }
});
test('editor, creation API and AI structure generator share the curriculum policy', () => {
  const editor = readFileSync(new URL('../../fluentxverse-dashboard/src/pages/ConversationalSkillsEditorPage.tsx', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/routes/lessonMaterial.route.ts', import.meta.url), 'utf8');
  const ai = readFileSync(new URL('../src/services/ai.service.ts', import.meta.url), 'utf8');
  expect(editor).toContain('const getChaptersForLevel = conversationalChapters;');
  expect(route).toContain('chapter: t.Integer({ minimum: 1, maximum: 5 })');
  expect(route).toContain('isLessonChapterAllowed(body.course, body.level, body.chapter)');
  expect(ai).toContain('const chapterCount = conversationalChapterCount(level);');
  expect(route).toContain('isLessonChapterAllowed(params.course, Number(params.level), Number(params.chapter))');
  expect(route).toContain('body.chapters.some(chapter => !isLessonChapterAllowed');
  expect(ai).toContain('Levels 2-10 have exactly 5 chapters');
  expect(ai).not.toContain('Level 3 has exactly 10 chapters');
});
