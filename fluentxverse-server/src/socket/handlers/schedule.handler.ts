import { Socket, Server } from 'socket.io';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData
} from '../types/socket.types';

type SocketType = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type ServerType = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

// Map tutorId -> Set of socket IDs subscribed to their schedule
const scheduleSubscriptions = new Map<string, Set<string>>();

export const registerScheduleHandlers = (io: ServerType, socket: SocketType) => {
  // Tutor subscribes to their own schedule updates
  socket.on('schedule:subscribe', ({ tutorId }) => {
    
    // Store the tutor ID in socket data
    socket.data.scheduleSubscribedTo = tutorId;
    
    // Add to subscriptions map
    if (!scheduleSubscriptions.has(tutorId)) {
      scheduleSubscriptions.set(tutorId, new Set());
    }
    scheduleSubscriptions.get(tutorId)!.add(socket.id);
    
    // Join a room for this tutor's schedule
    socket.join(`schedule:${tutorId}`);
  });

  socket.on('schedule:unsubscribe', () => {
    const tutorId = socket.data.scheduleSubscribedTo;
    if (tutorId) {
      
      // Remove from subscriptions map
      scheduleSubscriptions.get(tutorId)?.delete(socket.id);
      if (scheduleSubscriptions.get(tutorId)?.size === 0) {
        scheduleSubscriptions.delete(tutorId);
      }
      
      // Leave the room
      socket.leave(`schedule:${tutorId}`);
      delete socket.data.scheduleSubscribedTo;
    }
  });

  // Clean up on disconnect
  socket.on('disconnect', () => {
    const tutorId = socket.data.scheduleSubscribedTo;
    if (tutorId) {
      scheduleSubscriptions.get(tutorId)?.delete(socket.id);
      if (scheduleSubscriptions.get(tutorId)?.size === 0) {
        scheduleSubscriptions.delete(tutorId);
      }
    }
  });
};

// Helper function to emit schedule booking event to a specific tutor
export const emitSlotBooked = (
  io: ServerType,
  tutorId: string,
  data: {
    slotKey: string;
    bookingId?: string;
    studentId: string;
    studentName?: string;
    date: string;
    time: string;
  }
) => {
  io.to(`schedule:${tutorId}`).emit('schedule:slot-booked', {
    tutorId,
    ...data
  });
};

// Helper function to emit schedule cancellation event to a specific tutor
export const emitSlotCancelled = (
  io: ServerType,
  tutorId: string,
  data: {
    slotKey: string;
    date: string;
    time: string;
  }
) => {
  io.to(`schedule:${tutorId}`).emit('schedule:slot-cancelled', {
    tutorId,
    ...data
  });
};
