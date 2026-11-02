import { lessonNotesStatus } from '../../utils/lessonNotesStatus';

type Lesson = Parameters<typeof lessonNotesStatus>[0];
type Notice = { id: string; type: string; title: string; message: string; data?: Record<string, any> };

export function lessonNotificationBookingId(notice: Pick<Notice, 'type' | 'data'>): string | null {
  const id = notice.data?.bookingId
    ?? (['session_reminder', 'session_started'].includes(notice.type) ? notice.data?.sessionId : undefined);
  return typeof id === 'string' && id ? id : null;
}

export function notificationData(raw: unknown): Record<string, any> {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

type Resolution = { isRead: boolean; title: string; message: string; data: Record<string, any> };
export function resolveLessonNotification(notice: Notice, lesson?: Lesson): Resolution | null {
  const bookingId = lessonNotificationBookingId(notice);
  if (!bookingId) return null;
  const notes = notice.id.startsWith('notes-reminder:');
  const reminder = ['booking_new', 'session_reminder', 'session_started'].includes(notice.type);
  if (!notes && !reminder && !(typeof notice.data?.link === 'string' && notice.data.link.startsWith('/lesson/'))) return null;
  if (!lesson) return { isRead: true, title: notice.title,
    message: 'This lesson is no longer available. Check your schedule for current lessons.',
    data: { ...notice.data, actionUnavailable: true, link: undefined } };
  const state = lessonNotesStatus(lesson);
  if (notes && ['submitted', 'not_required'].includes(state))
    return { isRead: true, title: 'Lesson notes reminder cleared',
      message: state === 'submitted' ? 'Your lesson notes have been submitted. No action is needed.' : 'Notes are not required for this lesson. No action is needed.',
      data: { ...notice.data, actionResolved: state } };
  if (reminder && ['cancelled', 'completed'].includes(lesson.status || ''))
    return { isRead: true, title: 'Lesson reminder cleared',
      message: lesson.status === 'cancelled' ? 'This lesson was cancelled. No action is needed.' : 'This lesson has ended. View the lesson page for details.',
      data: { ...notice.data, actionResolved: lesson.status === 'cancelled' ? 'cancelled' : 'ended', link: '/lesson/' + encodeURIComponent(bookingId) } };
  return null;
}
