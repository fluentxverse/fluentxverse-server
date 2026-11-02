import { expect, test } from 'bun:test';
import { lessonNotesStatus } from '../src/utils/lessonNotesStatus';

test('only submitted, clean notes are complete; drafts and pending edits are distinct', () => {
  expect(lessonNotesStatus({ status: 'completed' })).toBe('draft');
  expect(lessonNotesStatus({ notesDraftDirty: true })).toBe('draft');
  expect(lessonNotesStatus({ notesSubmittedAt: '2026-10-28T12:00:00Z' })).toBe('submitted');
  expect(lessonNotesStatus({ notesSubmittedAt: '2026-10-28T12:00:00Z', notesDraftDirty: true })).toBe('changes_pending');
});

test('absence and cancellation never appear as missing required notes', () => {
  for (const booking of [{ status: 'cancelled' }, { attendanceTutor: 'absent' }, { attendanceStudent: 'absent' }]) {
    expect(lessonNotesStatus(booking)).toBe('not_required');
    expect(lessonNotesStatus({ ...booking, notesSubmittedAt: 'previous', notesDraftDirty: true })).toBe('not_required');
  }
});
