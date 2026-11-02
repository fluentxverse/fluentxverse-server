export type LessonNotesStatus = 'draft' | 'changes_pending' | 'submitted' | 'not_required';

export function lessonNotesStatus(booking: {
  status?: string;
  attendanceStudent?: string;
  attendanceTutor?: string;
  notesSubmittedAt?: unknown;
  notesDraftDirty?: unknown;
}): LessonNotesStatus {
  if (booking.status === 'cancelled' || booking.attendanceStudent === 'absent' || booking.attendanceTutor === 'absent') return 'not_required';
  if (!booking.notesSubmittedAt) return 'draft';
  return booking.notesDraftDirty ? 'changes_pending' : 'submitted';
}
