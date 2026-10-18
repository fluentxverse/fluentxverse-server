import { expect, mock, test } from 'bun:test';
import { scheduleClassroomExpiry, CLASSROOM_CLOSED_MESSAGE } from '../src/socket/classroomExpiry';

test('expiry disconnects the room at the three-minute boundary', async () => {
  const socket = { data: { sessionId: 'room', lessonStartsAt: 1, lessonEndsAt: 2 }, emit: mock(() => {}), disconnect: mock(() => {}) };
  const cancel = scheduleClassroomExpiry(socket as any, 'room', Date.now() - 180000);
  await Bun.sleep(15);
  expect(socket.emit).toHaveBeenCalledWith('session:classroom-closed', { sessionId: 'room', message: CLASSROOM_CLOSED_MESSAGE });
  expect(socket.disconnect).toHaveBeenCalledWith(true);
  expect(socket.data.lessonEndsAt).toBeUndefined();
  cancel();
});

test('leaving or moving to another room does not expire the new room', async () => {
  const socket = { data: { sessionId: 'new-room' }, emit: mock(() => {}), disconnect: mock(() => {}) };
  const cancel = scheduleClassroomExpiry(socket as any, 'old-room', Date.now() - 180000);
  await Bun.sleep(15);
  expect(socket.disconnect).not.toHaveBeenCalled();
  cancel();
  const cancelFuture = scheduleClassroomExpiry(socket as any, 'new-room', Date.now() - 179990);
  cancelFuture();
  await Bun.sleep(20);
  expect(socket.disconnect).not.toHaveBeenCalled();
});
