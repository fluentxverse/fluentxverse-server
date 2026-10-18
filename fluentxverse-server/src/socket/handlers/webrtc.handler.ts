import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from '../types/socket.types';
import { getIceConfiguration } from '../iceConfiguration';
import { canCommunicateInClassroom } from '../classroomTiming';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export const webrtcHandler = (io: TypedServer, socket: TypedSocket, getConfiguration = getIceConfiguration) => {
  socket.on('webrtc:ice-config', async callback => {
    if (typeof callback !== 'function') return;
    const roomId = socket.data.sessionId || socket.data.interviewRoomId;
    if (!roomId || !socket.rooms.has(roomId)) {
      callback({ iceServers: [], error: 'Join an authorized call room before requesting relay settings.' });
      return;
    }
    try {
      const configuration = await getConfiguration(socket.data.userId);
      if (!socket.rooms.has(roomId)
        || (socket.data.sessionId !== roomId && socket.data.interviewRoomId !== roomId)) {
        callback({ iceServers: [], error: 'Call setup was cancelled.' });
        return;
      }
      callback(configuration);
    } catch (error) {
      console.error('Unable to issue call relay credentials:', error instanceof Error ? error.message : 'Unknown error');
      callback({ iceServers: [], error: 'Unable to load call relay settings. Please retry.' });
    }
  });

  socket.on('webrtc:ready', () => {
    if (socket.data.mediaProvider === 'realtimekit') return;
    const sessionId = socket.data.sessionId;
    if (sessionId && socket.rooms.has(sessionId) && socket.data.userType === 'student' && canCommunicateInClassroom(socket.data.lessonStartsAt, socket.data.lessonEndsAt)) {
      socket.to(sessionId).emit('webrtc:ready', { from: socket.data.userId });
    }
  });

  // Handle WebRTC offer
  socket.on('webrtc:offer', async (data, callback) => {
    if (socket.data.mediaProvider === 'realtimekit') { callback?.({ delivered: false }); return; }
    if (!canCommunicateInClassroom(socket.data.lessonStartsAt, socket.data.lessonEndsAt)) { callback?.({ delivered: false }); return; }
    try {
      const { offer, to } = data;
      const from = socket.data.userId;
      const sessionId = socket.data.sessionId;

      if (!sessionId || !socket.rooms.has(sessionId) || !offer || typeof to !== 'string') {
        console.error('No session ID found for WebRTC offer');
        return;
      }

      // Find target socket in the same session
      const sockets = await io.in(sessionId).fetchSockets();
      const targetSocket = sockets.find(s => s.data.userId === to);

      if (targetSocket) {
        targetSocket.emit('webrtc:offer', { offer, from });
        callback?.({ delivered: true });
      } else {
        console.error(`Target socket not found for user ${to}`);
        callback?.({ delivered: false });
      }
    } catch (error) {
      console.error('Error handling webrtc:offer:', error);
      callback?.({ delivered: false });
    }
  });

  // Handle WebRTC answer
  socket.on('webrtc:answer', async (data) => {
    if (socket.data.mediaProvider === 'realtimekit') return;
    if (!canCommunicateInClassroom(socket.data.lessonStartsAt, socket.data.lessonEndsAt)) return;
    try {
      const { answer, to } = data;
      const from = socket.data.userId;
      const sessionId = socket.data.sessionId;

      if (!sessionId || !socket.rooms.has(sessionId) || !answer || typeof to !== 'string') {
        console.error('No session ID found for WebRTC answer');
        return;
      }

      // Find target socket in the same session
      const sockets = await io.in(sessionId).fetchSockets();
      const targetSocket = sockets.find(s => s.data.userId === to);

      if (targetSocket) {
        targetSocket.emit('webrtc:answer', { answer, from });
      } else {
        console.error(`Target socket not found for user ${to}`);
      }
    } catch (error) {
      console.error('Error handling webrtc:answer:', error);
    }
  });

  // Handle ICE candidate
  socket.on('webrtc:ice-candidate', async (data) => {
    if (socket.data.mediaProvider === 'realtimekit') return;
    if (!canCommunicateInClassroom(socket.data.lessonStartsAt, socket.data.lessonEndsAt)) return;
    try {
      const { candidate, to } = data;
      const from = socket.data.userId;
      const sessionId = socket.data.sessionId;

      if (!sessionId || !socket.rooms.has(sessionId) || !candidate || typeof to !== 'string') {
        console.error('No session ID found for ICE candidate');
        return;
      }

      // Find target socket in the same session
      const sockets = await io.in(sessionId).fetchSockets();
      const targetSocket = sockets.find(s => s.data.userId === to);

      if (targetSocket) {
        targetSocket.emit('webrtc:ice-candidate', { candidate, from });
      } else {
        console.error(`Target socket not found for user ${to}`);
      }
    } catch (error) {
      console.error('Error handling webrtc:ice-candidate:', error);
    }
  });

};
