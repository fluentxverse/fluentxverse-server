import type { Server, Socket } from 'socket.io';
import type { TicketReceivedData, TicketBalanceData } from '../types/socket.types';

// Map to track user socket connections for ticket notifications
const userTicketSockets = new Map<string, Set<string>>();

export const ticketHandler = (io: Server, socket: Socket) => {
  const userId = socket.data.userId;

  // Subscribe to ticket notifications - join user-specific room
  socket.on('ticket:subscribe', () => {
    try {
      const room = `tickets:${userId}`;
      socket.join(room);
      
      // Track socket in userTicketSockets map
      if (!userTicketSockets.has(userId)) {
        userTicketSockets.set(userId, new Set());
      }
      userTicketSockets.get(userId)?.add(socket.id);
      
    } catch (error) {
      console.error('Error subscribing to ticket notifications:', error);
    }
  });

  // Unsubscribe from ticket notifications
  socket.on('ticket:unsubscribe', () => {
    try {
      const room = `tickets:${userId}`;
      socket.leave(room);
      
      const sockets = userTicketSockets.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userTicketSockets.delete(userId);
        }
      }
      
    } catch (error) {
      console.error('Error unsubscribing from ticket notifications:', error);
    }
  });

  // Handle disconnect - clean up tracking
  socket.on('disconnect', () => {
    const sockets = userTicketSockets.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        userTicketSockets.delete(userId);
      }
    }
  });
};

/**
 * Notify a user that they received tickets
 * Called from ticket purchase flow after blockchain confirmation
 */
export const notifyTicketReceived = (
  io: Server, 
  userId: string, 
  data: Omit<TicketReceivedData, 'userId' | 'timestamp'>
) => {
  const room = `tickets:${userId}`;
  const notification: TicketReceivedData = {
    userId,
    ...data,
    timestamp: new Date().toISOString(),
  };
  
  io.to(room).emit('ticket:received', notification);
};

/**
 * Notify a user of their updated ticket balance
 * Can be called after any balance-changing operation
 */
export const notifyBalanceUpdated = (
  io: Server, 
  userId: string, 
  balance: TicketBalanceData['balance']
) => {
  const room = `tickets:${userId}`;
  const data: TicketBalanceData = {
    userId,
    balance,
  };
  
  io.to(room).emit('ticket:balance-updated', data);
};

/**
 * Check if a user is connected for ticket notifications
 */
export const isUserSubscribedToTickets = (userId: string): boolean => {
  const sockets = userTicketSockets.get(userId);
  return sockets ? sockets.size > 0 : false;
};
