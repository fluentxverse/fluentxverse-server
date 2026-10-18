import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from '../types/socket.types';
import { classroomMediaService } from '../../services/classroomMedia.service';
import { qaRecordingService } from '../../services/qaRecording.service';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function classroomMediaHandler(_io: TypedServer, socket: TypedSocket, media = classroomMediaService) {
  let noticePending = false;
  let lastNotice = 0;
  const notice = async (decision: { accepted: boolean; authority: boolean; version: string } | null, callback: (result: any) => void) => {
    if (typeof callback !== 'function') return;
    const bookingId = socket.data.sessionId, role = socket.data.userType;
    if (!bookingId || !socket.rooms.has(bookingId) || !['student','tutor'].includes(role) || noticePending || Date.now()-lastNotice < 500) {
      callback({ error: 'Recording notice unavailable. Please retry.' }); return;
    }
    noticePending = true; lastNotice = Date.now();
    try {
      const result = decision
        ? await qaRecordingService.acknowledge(bookingId,socket.data.userId,role as 'student'|'tutor',decision.accepted,decision.authority,decision.version)
        : await qaRecordingService.participantState(bookingId,socket.data.userId,role as 'student'|'tutor');
      if (socket.data.sessionId !== bookingId || !socket.connected || !socket.rooms.has(bookingId)) throw new Error('Room changed');
      callback(result);
    } catch { callback({ error: 'Recording notice unavailable. Please retry.' }); }
    finally { noticePending = false; }
  };
  socket.on('classroom:recording-state', callback => void notice(null,callback));
  socket.on('classroom:recording-consent', (decision,callback) => {
    if (!decision || typeof decision.accepted !== 'boolean' || typeof decision.authority !== 'boolean' || typeof decision.version !== 'string') {
      if (typeof callback === 'function') callback({ error: 'Invalid recording acknowledgement' }); return;
    }
    void notice(decision,callback);
  });
  let pending = false;
  let lastRequest = 0;
  socket.on('classroom:media-token', async callback => {
    if (typeof callback !== 'function') return;
    const bookingId = socket.data.sessionId;
    const role = socket.data.userType;
    if (!bookingId || !socket.rooms.has(bookingId) || !['student', 'tutor'].includes(role)) {
      callback({ error: 'Join an authorized classroom before requesting call access.' }); return;
    }
    if (pending || Date.now() - lastRequest < 2000) {
      callback({ error: 'Call setup is already in progress. Please retry shortly.' }); return;
    }
    pending = true;
    lastRequest = Date.now();
    try {
      const credentials = await media.credentials(bookingId, socket.data.userId, role as 'student' | 'tutor');
      if (!socket.connected || socket.data.sessionId !== bookingId || !socket.rooms.has(bookingId)) {
        callback({ error: 'Call setup was cancelled.' }); return;
      }
      callback(credentials);
    } catch (error) {
      console.warn('Classroom media access failed:', error instanceof Error ? error.message : 'Unknown error');
      callback({ error: 'Unable to join the lesson call. Please retry.' });
    } finally { pending = false; }
  });
}
