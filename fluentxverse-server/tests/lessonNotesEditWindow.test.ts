import { describe, expect, test } from 'bun:test';
import { lessonNotesEditWindow } from '../src/utils/lessonNotesEditWindow';

describe('lesson notes editing window', () => {
  const start = '2026-10-06T12:00:00Z';
  const end = Date.parse(start) + 25 * 60_000;
  const deadline = end + 48 * 60 * 60_000;
  test('opens at lesson start and closes exactly 48 hours after the scheduled end', () => {
    expect(lessonNotesEditWindow(start, 25, 'confirmed', Date.parse(start) - 1).reason).toBe('not_started');
    expect(lessonNotesEditWindow(start, 25, 'confirmed', Date.parse(start)).canEdit).toBe(true);
    expect(lessonNotesEditWindow(start, 25, 'completed', deadline - 1).canEdit).toBe(true);
    expect(lessonNotesEditWindow(start, 25, 'completed', deadline).reason).toBe('expired');
    expect(lessonNotesEditWindow(start, 25, 'completed', deadline).canEdit).toBe(false);
  });
  test('uses duration with a 25-minute fallback and never opens cancelled lessons', () => {
    expect(lessonNotesEditWindow(start, 30, 'completed', end).endsAt).toBe('2026-10-06T12:30:00.000Z');
    expect(lessonNotesEditWindow(start, null, 'completed', end).endsAt).toBe('2026-10-06T12:25:00.000Z');
    expect(lessonNotesEditWindow(start, -1, 'completed', end).endsAt).toBe('2026-10-06T12:25:00.000Z');
    expect(lessonNotesEditWindow(start, 25, 'cancelled', end).canEdit).toBe(false);
    expect(lessonNotesEditWindow(start, 25, 'cancelled', end).reason).toBe('cancelled');
  });
});
