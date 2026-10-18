import type { Socket } from 'socket.io';
import { CLASSROOM_WRAP_UP_MS } from './classroomTiming';

export const CLASSROOM_CLOSED_MESSAGE = 'Classroom closed. The three-minute wrap-up has ended.';

export function scheduleClassroomExpiry(socket: Socket, sessionId: string, endsAt: number) {
  const timer = setTimeout(() => {
    if (socket.data.sessionId !== sessionId) return;
    socket.data.lessonStartsAt = undefined;
    socket.data.lessonEndsAt = undefined;
    socket.emit('session:classroom-closed', { sessionId, message: CLASSROOM_CLOSED_MESSAGE });
    socket.disconnect(true);
  }, Math.max(0, endsAt + CLASSROOM_WRAP_UP_MS - Date.now()));
  timer.unref();
  return () => clearTimeout(timer);
}
