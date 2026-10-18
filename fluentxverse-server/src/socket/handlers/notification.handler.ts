import type { Server, Socket } from 'socket.io';
import { NotificationService } from '../../services/notification.services/notification.service';

const notificationService = new NotificationService();

// Map to track user socket connections for notifications
const userSockets = new Map<string, Set<string>>();

export const notificationHandler = (io: Server, socket: Socket) => {
  const userId = socket.data.userId;
  const userType = socket.data.userType;
  const room = `notifications:${userId}`;

  const joinNotificationRooms = () => {
    socket.join(room);

    if (userType === 'admin') {
      socket.join('notifications:admin');
    }

    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)?.add(socket.id);
  };

  const emitNotificationList = async (limit = 20, offset = 0) => {
    const notifications = await notificationService.getNotifications({
      userId,
      limit,
      offset
    });

    const unreadCount = await notificationService.getUnreadCount(userId);

    socket.emit('notification:list', {
      notifications,
      unreadCount
    });
  };

  // Join the user's notification room immediately so realtime events are not
  // missed while the client is still opening menus or requesting the first list.
  joinNotificationRooms();

  // Subscribe to notifications - join user-specific room
  socket.on('notification:subscribe', async () => {
    try {
      joinNotificationRooms();
      await emitNotificationList();
    } catch (error) {
      console.error('Error subscribing to notifications:', error);
    }
  });

  // Join admin room explicitly (for dashboard)
  socket.on('join:admin', async () => {
    try {
      socket.join('notifications:admin');
    } catch (error) {
      console.error('Error joining admin room:', error);
    }
  });

  // Get all notifications
  socket.on('notification:get-all', async (data?: { limit?: number; offset?: number }) => {
    try {
      await emitNotificationList(data?.limit || 50, data?.offset || 0);
    } catch (error) {
      console.error('Error getting notifications:', error);
    }
  });

  // Mark notification as read
  socket.on('notification:mark-read', async (notificationId: string) => {
    try {
      await notificationService.markAsRead(notificationId, userId);
      
      const unreadCount = await notificationService.getUnreadCount(userId);
      
      // Emit to all sockets for this user
      io.to(`notifications:${userId}`).emit('notification:read', {
        notificationId,
        unreadCount
      });
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  });

  // Mark all notifications as read
  socket.on('notification:mark-all-read', async () => {
    try {
      await notificationService.markAllAsRead(userId);
      
      io.to(`notifications:${userId}`).emit('notification:read-all', {
        unreadCount: 0
      });
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  });

  // Handle disconnect - clean up tracking
  socket.on('disconnect', () => {
    const sockets = userSockets.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        userSockets.delete(userId);
      }
    }
  });
};

/**
 * Send a notification to a specific user via socket
 */
export const sendNotificationToUser = (io: Server, userId: string, notification: any) => {
  const room = `notifications:${userId}`;
  io.to(room).emit('notification:new', notification);
};

/**
 * Helper to broadcast notification from other services
 */
export const broadcastNotification = (io: Server, userId: string, notification: any) => {
  sendNotificationToUser(io, userId, notification);
};
