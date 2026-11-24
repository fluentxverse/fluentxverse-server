import { expect, test } from 'bun:test';
import { requireDefined } from '../../shared/requireDefined';

test('required authored values reject null and missing entries with context', () => {
  expect(() => requireDefined(undefined, 'lesson goal')).toThrow('Missing required value: lesson goal');
  expect(() => requireDefined(null, 'lesson goal')).toThrow('Missing required value: lesson goal');
  const items: string[] = [];
  expect(() => requireDefined(items[0], 'first item')).toThrow('Missing required value: first item');
});

test('required values preserve falsy values and object identity', () => {
  expect(requireDefined(0, 'score')).toBe(0);
  expect(requireDefined(false, 'enabled')).toBe(false);
  expect(requireDefined('', 'text')).toBe('');
  const value = { title: 'Saved lesson' };
  expect(requireDefined(value, 'lesson')).toBe(value);
});
