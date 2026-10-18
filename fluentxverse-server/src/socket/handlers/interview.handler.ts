import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from '../types/socket.types';
import { getDriver } from '../../db/memgraph';
import { getIceConfiguration } from '../iceConfiguration';
import { adminCapabilities } from '../../utils/adminOperations';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

// Store interview room participants
const interviewRooms = new Map<string, { tutorSocketId?: string; adminSocketId?: string; recording?: boolean }>();

export const canJoinInterview = async (roomId: string, role: 'tutor' | 'admin', userId: string) => {
  if (!/^interview-[a-zA-Z0-9_-]{1,100}$/.test(roomId) || roomId === 'interview-default') return false;
  const session = getDriver().session();
  try {
    if (role === 'admin') {
      const admin = (await session.run('MATCH (a:Admin {id: $userId}) RETURN a', { userId })).records[0]?.get('a')?.properties;
      if (!admin || !['admin', 'superadmin'].includes(admin.role || 'admin') || !adminCapabilities(admin).includes('operations')) return false;
    }
    const result = await session.run(
      `MATCH (slot:InterviewSlot {id: $slotId, status: 'booked'})
       WHERE $role = 'admin' OR slot.tutorId = $userId
       WITH slot WHERE slot.mediaClosedAt IS NULL
       RETURN slot.id AS id LIMIT 1`,
      { slotId: roomId.slice('interview-'.length), role, userId }
    );
    return result.records.length > 0;
  } finally {
    await session.close();
  }
};

export const interviewHandler = (io: TypedServer, socket: TypedSocket) => {
  // Join interview room
  socket.on('interview:join', async (data: { roomId: string; odIuser?: string; role: 'tutor' | 'admin' }) => {
    try {
      const { roomId, role } = data;
      if (role !== socket.data.userType || (role !== 'tutor' && role !== 'admin') ||
          !await canJoinInterview(roomId, role, socket.data.userId)) {
        socket.emit('interview:error', { message: 'You do not have access to this interview' });
        return;
      }

      const previousRoomId = socket.data.interviewRoomId;
      if (previousRoomId && previousRoomId !== roomId) {
        socket.leave(previousRoomId);
        const previous = interviewRooms.get(previousRoomId);
        if (previous?.tutorSocketId === socket.id) delete previous.tutorSocketId;
        if (previous?.adminSocketId === socket.id) delete previous.adminSocketId;
      }
      
      // Leave any existing interview rooms
      socket.rooms.forEach(room => {
        if (room.startsWith('interview-')) {
          socket.leave(room);
        }
      });
      
      // Join the new room
      socket.join(roomId);
      socket.data.interviewRoomId = roomId;
      socket.data.interviewRole = role;
      const configuration = await getIceConfiguration(socket.data.userId);
      if (socket.data.interviewRoomId !== roomId || !socket.rooms.has(roomId)) return;
      socket.emit('webrtc:ice-configuration', configuration);
      
      // Update room participants
      if (!interviewRooms.has(roomId)) {
        interviewRooms.set(roomId, {});
      }
      
      const room = interviewRooms.get(roomId)!;
      const replacedSocketId = role === 'tutor' ? room.tutorSocketId : room.adminSocketId;
      if (replacedSocketId && replacedSocketId !== socket.id) {
        const replaced = io.sockets.sockets.get(replacedSocketId);
        replaced?.leave(roomId);
        if (replaced) {
          replaced.data.interviewRoomId = undefined;
          replaced.data.interviewRole = undefined;
          replaced.emit('interview:ended');
        }
      }
      if (role === 'tutor') {
        room.tutorSocketId = socket.id;
      } else if (role === 'admin') {
        room.adminSocketId = socket.id;
      }
      socket.emit('interview:joined', { roomId, configuration, peerPresent: Boolean(role === 'admin' ? room.tutorSocketId : room.adminSocketId), peerId: role === 'admin' ? room.tutorSocketId : room.adminSocketId });
      socket.emit('interview:recording-status', { recording: Boolean(room.recording) });
      
      
      // Notify other participant
      if (role === 'admin' && room.tutorSocketId) {
        // Admin joined, notify tutor
        io.to(room.tutorSocketId).emit('interview:admin-joined' as any, { peerId: socket.id });
      } else if (role === 'tutor' && room.adminSocketId) {
        // Tutor joined, notify admin
        io.to(room.adminSocketId).emit('interview:tutor-joined' as any, { peerId: socket.id });
        io.to(socket.id).emit('interview:admin-joined' as any, { peerId: room.adminSocketId });
      }
    } catch (error) {
      console.error('Error joining interview room:', error);
      socket.emit('interview:error', { message: 'Unable to join the interview right now' });
    }
  });

  socket.on('interview:renegotiate', (data: { roomId: string }) => {
    const room = interviewRooms.get(data?.roomId);
    if (socket.data.interviewRoomId === data?.roomId && room?.adminSocketId === socket.id && room.tutorSocketId) {
      io.to(room.tutorSocketId).emit('interview:renegotiate');
    }
  });
  socket.on('interview:recording-status', (data: { roomId: string; recording: boolean }) => {
    const room = interviewRooms.get(data?.roomId);
    if (typeof data?.recording !== 'boolean' || socket.data.interviewRoomId !== data.roomId || room?.adminSocketId !== socket.id) return;
    room.recording = data.recording;
    io.to(data.roomId).emit('interview:recording-status', { recording: data.recording });
  });

  // Handle interview offer (tutor -> admin)
  socket.on('interview:offer', async (data: { roomId: string; offer: { type: string; sdp?: string }; negotiationId?: string }) => {
    try {
      const { roomId, offer } = data;
      const room = interviewRooms.get(roomId);
      
      if (socket.data.interviewRoomId === roomId && socket.data.interviewRole === 'tutor' &&
          room?.tutorSocketId === socket.id && room.adminSocketId) {
        io.to(room.adminSocketId).emit('interview:offer' as any, { offer, negotiationId: data.negotiationId, from: socket.id });
      }
    } catch (error) {
      console.error('Error handling interview offer:', error);
    }
  });

  // Handle interview answer (admin -> tutor)
  socket.on('interview:answer', async (data: { roomId: string; answer: { type: string; sdp?: string }; negotiationId?: string }) => {
    try {
      const { roomId, answer } = data;
      const room = interviewRooms.get(roomId);
      
      if (socket.data.interviewRoomId === roomId && socket.data.interviewRole === 'admin' &&
          room?.adminSocketId === socket.id && room.tutorSocketId) {
        io.to(room.tutorSocketId).emit('interview:answer' as any, { answer, negotiationId: data.negotiationId, from: socket.id });
      }
    } catch (error) {
      console.error('Error handling interview answer:', error);
    }
  });

  // Handle ICE candidates
  socket.on('interview:ice-candidate', async (data: { roomId: string; candidate: { candidate: string; sdpMid?: string; sdpMLineIndex?: number }; negotiationId?: string }) => {
    try {
      const { roomId, candidate } = data;
      const room = interviewRooms.get(roomId);
      const senderRole = socket.data.interviewRole;
      if (socket.data.interviewRoomId !== roomId ||
          (senderRole === 'tutor' ? room?.tutorSocketId !== socket.id : room?.adminSocketId !== socket.id)) return;
      
      // Send to the other participant
      const targetSocketId = senderRole === 'tutor' ? room?.adminSocketId : room?.tutorSocketId;
      
      if (targetSocketId) {
        io.to(targetSocketId).emit('interview:ice-candidate' as any, { candidate, negotiationId: data.negotiationId, from: socket.id });
      }
    } catch (error) {
      console.error('Error handling interview ICE candidate:', error);
    }
  });

  // End interview
  socket.on('interview:end', async (data: { roomId: string }) => {
    try {
      const { roomId } = data;
      const room = interviewRooms.get(roomId);
      if (socket.data.interviewRoomId !== roomId ||
          (room?.tutorSocketId !== socket.id && room?.adminSocketId !== socket.id)) return;
      const session = getDriver().session();
      try { await session.run('MATCH (s:InterviewSlot {id: $id}) SET s.mediaClosedAt = coalesce(s.mediaClosedAt, $at)', {
        id: roomId.slice('interview-'.length), at: new Date().toISOString(),
      }); } finally { await session.close(); }
      
      // Notify all participants
      io.to(roomId).emit('interview:ended' as any);
      for (const id of [room?.adminSocketId, room?.tutorSocketId]) {
        const member = id ? io.sockets.sockets.get(id) : null;
        if (member) { member.leave(roomId); member.data.interviewRoomId = undefined; member.data.interviewRole = undefined; }
      }
      
      // Cleanup room
      interviewRooms.delete(roomId);
      
    } catch (error) {
      console.error('Error ending interview:', error);
    }
  });

  // Handle disconnect - cleanup interview rooms
  socket.on('disconnect', () => {
    const roomId = socket.data.interviewRoomId;
    if (roomId) {
      const room = interviewRooms.get(roomId);
      if (room) {
        const role = socket.data.interviewRole;
        if (role === 'tutor' && room.tutorSocketId === socket.id) {
          delete room.tutorSocketId;
          // Notify admin
          if (room.adminSocketId) {
            io.to(room.adminSocketId).emit('interview:tutor-left' as any);
          }
        } else if (role === 'admin' && room.adminSocketId === socket.id) {
          delete room.adminSocketId;
          room.recording = false;
          io.to(roomId).emit('interview:recording-status', { recording: false });
          // Notify tutor
          if (room.tutorSocketId) {
            io.to(room.tutorSocketId).emit('interview:admin-left' as any);
          }
        }
        
        // Cleanup if room is empty
        if (!room.tutorSocketId && !room.adminSocketId) {
          interviewRooms.delete(roomId);
        }
      }
    }
  });
};
