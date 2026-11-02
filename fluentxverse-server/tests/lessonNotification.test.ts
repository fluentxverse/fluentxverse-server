import { expect, test } from 'bun:test';
import { notificationData, resolveLessonNotification } from '../src/services/notification.services/lessonNotification';

const notice = { id: 'notes-reminder:lesson:pending', type: 'system', title: 'Submit lesson notes', message: 'Submit now',
  data: { bookingId: 'lesson', link: '/lesson/lesson' } };
test('submitted notes clear reminders without losing the lesson link', () => {
  const result = resolveLessonNotification(notice, { status: 'completed', notesSubmittedAt: '2026-10-31', notesDraftDirty: false });
  expect(result?.isRead).toBe(true);
  expect(result?.data).toMatchObject({ bookingId: 'lesson', link: '/lesson/lesson', actionResolved: 'submitted' });
});
test('unsaved updates and draft notes still need attention', () => {
  expect(resolveLessonNotification(notice, { status: 'completed' })).toBeNull();
  expect(resolveLessonNotification(notice, { status: 'completed', notesSubmittedAt: '2026-10-31', notesDraftDirty: true })).toBeNull();
});
test('absent and cancelled lessons do not keep asking for notes', () => {
  for (const state of [{ attendanceTutor: 'absent' }, { attendanceStudent: 'absent' }, { status: 'cancelled' }])
    expect(resolveLessonNotification(notice, state)?.data.actionResolved).toBe('not_required');
});
test('cancellation clears an upcoming-session notice, not unrelated notices', () => {
  expect(resolveLessonNotification({ ...notice, id: 'uuid', type: 'session_reminder' }, { status: 'cancelled' })?.data.actionResolved).toBe('cancelled');
  expect(resolveLessonNotification({ ...notice, id: 'uuid', type: 'payment_received', data: { bookingId: 'lesson' } })).toBeNull();
});
test('missing lessons become read-only history and cannot navigate to a dead link', () => {
  const result = resolveLessonNotification(notice);
  expect(result?.isRead).toBe(true); expect(result?.data.actionUnavailable).toBe(true);
  expect(result?.data.link).toBeUndefined();
});
test('malformed legacy payloads do not break the whole notification feed', () => {
  for (const value of ['{', 'null', '[]', '2', null]) expect(notificationData(value)).toEqual({});
  expect(notificationData('{"bookingId":"lesson"}')).toEqual({ bookingId: 'lesson' });
});
test('actual sessionId reminders resolve to lesson history, not a closed classroom', () => {
  const legacy = {...notice,id:'legacy',type:'session_reminder',data:{sessionId:'lesson',link:'/classroom/lesson'}};
  expect(resolveLessonNotification(legacy,{status:'cancelled'})?.data).toMatchObject({actionResolved:'cancelled',link:'/lesson/lesson'});
  expect(resolveLessonNotification(legacy,{status:'completed'})?.data).toMatchObject({actionResolved:'ended',link:'/lesson/lesson'});
  expect(resolveLessonNotification(legacy,{status:'confirmed'})).toBeNull();
  expect(resolveLessonNotification(legacy)?.data.actionUnavailable).toBe(true);
});
