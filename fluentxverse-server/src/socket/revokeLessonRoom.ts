import type { Server } from 'socket.io';

export function revokeLessonRoom(io: Server | null, bookingId: string) {
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.sessionId !== bookingId && !socket.rooms.has(bookingId)) continue;
    socket.data.lessonStartsAt = undefined;
    socket.data.lessonEndsAt = undefined;
    socket.emit('session:error', { message: 'This lesson has been cancelled. Classroom access is closed.' });
    socket.disconnect(true);
  }
}
