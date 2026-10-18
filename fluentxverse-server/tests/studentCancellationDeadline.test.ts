import { expect, mock, test } from 'bun:test';
import { canStudentCancelLesson } from '../src/services/schedule.services/cancellationPolicy';
import { revokeLessonRoom } from '../src/socket/revokeLessonRoom';

test('student cancellation closes exactly five minutes before start', () => {
  const start = Date.now() + 3600_000;
  expect(canStudentCancelLesson('confirmed', start, start - 300_001)).toBe(true);
  for (const now of [start - 300_000, start - 1, start, start + 1]) expect(canStudentCancelLesson('confirmed', start, now)).toBe(false);
  expect(canStudentCancelLesson('cancelled', start, start - 3600_000)).toBe(false);
});

test('cancellation disconnects joined and joining classroom sockets without touching other lessons', () => {
  const makeSocket = (sessionId: string | undefined, room: string) => ({
    data: { sessionId, lessonStartsAt: 100, lessonEndsAt: 200 }, rooms: new Set([room]), emit: mock(() => {}), disconnect: mock(() => {}),
  });
  const joined = makeSocket('cancelled-room', 'cancelled-room'), joining = makeSocket(undefined, 'cancelled-room'), other = makeSocket('other', 'other');
  revokeLessonRoom({ sockets: { sockets: new Map([['joined', joined], ['joining', joining], ['other', other]]) } } as any, 'cancelled-room');
  for (const socket of [joined, joining]) {
    expect(socket.data.lessonStartsAt).toBeUndefined(); expect(socket.data.lessonEndsAt).toBeUndefined();
    expect(socket.disconnect).toHaveBeenCalledWith(true); expect(socket.emit).toHaveBeenCalledWith('session:error', expect.any(Object));
  }
  expect(other.disconnect).not.toHaveBeenCalled();
});
