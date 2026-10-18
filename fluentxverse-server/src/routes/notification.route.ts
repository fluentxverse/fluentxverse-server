import Elysia, { t } from 'elysia';
import { NotificationService } from '../services/notification.services/notification.service';
import { verifyAuthToken, refreshJwtCookie, type JwtAuthPayload } from '../utils/jwt';
import { getIO } from '../socket/socket.server';
import { safePaginationLimit, safePaginationOffset, MAX_PAGINATION_LIMITS } from '../utils/rateLimiter';

const notificationService = new NotificationService();

const Notification = new Elysia({ prefix: '/notifications' })
  /**
   * Get all notifications for the current user
   * GET /notifications
   */
  .get('/', async ({ query, cookie, set }) => {
    try {
      // Check auth cookies (tutor, student, admin)
      const isAdmin = !!cookie.adminAuth?.value;
      let raw = cookie.tutorAuth?.value || cookie.studentAuth?.value || cookie.adminAuth?.value;
      const cookieName = cookie.tutorAuth?.value ? 'tutorAuth' : cookie.studentAuth?.value ? 'studentAuth' : 'adminAuth';
      
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const userId = payload.userId;

      // Refresh JWT cookie on every request (adminAuth refresh not supported)
      if (!isAdmin) {
        await refreshJwtCookie(cookie, payload, cookieName as 'tutorAuth' | 'studentAuth');
      }

      const limit = safePaginationLimit(query.limit, 50, MAX_PAGINATION_LIMITS.list);
      const offset = safePaginationOffset(query.offset, 0);

      const filters: any = {
        userId,
        limit,
        offset
      };

      // Support unread-only filtering: /notifications?isRead=false
      if (typeof query.isRead !== 'undefined') {
        const isReadStr = Array.isArray(query.isRead) ? query.isRead[0] : query.isRead;
        if (typeof isReadStr === 'string') {
          filters.isRead = isReadStr.toLowerCase() === 'true';
        }
      }

      // Optional type filter: /notifications?type=interview_scheduled
      if (typeof query.type !== 'undefined') {
        const typeStr = Array.isArray(query.type) ? query.type[0] : query.type;
        if (typeof typeStr === 'string' && typeStr.length > 0) {
          filters.type = typeStr;
        }
      }

      const notifications = await notificationService.getNotifications(filters);

      const unreadCount = await notificationService.getUnreadCount(userId);

      return {
        success: true,
        data: {
          notifications,
          unreadCount
        }
      };
    } catch (error) {
      console.error('Error in GET /notifications:', error);
      set.status = 500;
      return {
        success: false,
        error: 'Failed to get notifications'
      };
    }
  })

  /**
   * Get unread notification count
   * GET /notifications/unread-count
   */
  .get('/unread-count', async ({ cookie, set }) => {
    try {
      const isAdmin = !!cookie.adminAuth?.value;
      let raw = cookie.tutorAuth?.value || cookie.studentAuth?.value || cookie.adminAuth?.value;
      const cookieName = cookie.tutorAuth?.value ? 'tutorAuth' : cookie.studentAuth?.value ? 'studentAuth' : 'adminAuth';
      
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const userId = payload.userId;

      // Refresh JWT cookie on every request (adminAuth refresh not supported)
      if (!isAdmin) {
        await refreshJwtCookie(cookie, payload, cookieName as 'tutorAuth' | 'studentAuth');
      }

      const unreadCount = await notificationService.getUnreadCount(userId);

      return {
        success: true,
        data: { unreadCount }
      };
    } catch (error) {
      console.error('Error in GET /notifications/unread-count:', error);
      set.status = 500;
      return {
        success: false,
        error: 'Failed to get unread count'
      };
    }
  })

  /**
   * Mark a notification as read
   * POST /notifications/:id/read
   */
  .post('/:id/read', async ({ params, cookie, set }) => {
    try {
      const isAdmin = !!cookie.adminAuth?.value;
      let raw = cookie.tutorAuth?.value || cookie.studentAuth?.value || cookie.adminAuth?.value;
      const cookieName = cookie.tutorAuth?.value ? 'tutorAuth' : cookie.studentAuth?.value ? 'studentAuth' : 'adminAuth';
      
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const userId = payload.userId;

      // Refresh JWT cookie on every request (adminAuth refresh not supported)
      if (!isAdmin) {
        await refreshJwtCookie(cookie, payload, cookieName as 'tutorAuth' | 'studentAuth');
      }

      const success = await notificationService.markAsRead(params.id, userId);

      if (!success) {
        set.status = 404;
        return { success: false, error: 'Notification not found' };
      }

      // Emit live sync over sockets
      const io = getIO();
      if (io) {
        io.to(`notifications:${userId}`).emit('notification:read', {
          notificationId: params.id,
          unreadCount: await notificationService.getUnreadCount(userId)
        });
      }

      return { success: true };
    } catch (error) {
      console.error('Error in POST /notifications/:id/read:', error);
      set.status = 500;
      return {
        success: false,
        error: 'Failed to mark notification as read'
      };
    }
  })

  /**
   * Mark all notifications as read
   * POST /notifications/read-all
   */
  .post('/read-all', async ({ cookie, set }) => {
    try {
      const isAdmin = !!cookie.adminAuth?.value;
      let raw = cookie.tutorAuth?.value || cookie.studentAuth?.value || cookie.adminAuth?.value;
      const cookieName = cookie.tutorAuth?.value ? 'tutorAuth' : cookie.studentAuth?.value ? 'studentAuth' : 'adminAuth';
      
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const userId = payload.userId;

      // Refresh JWT cookie on every request (adminAuth refresh not supported)
      if (!isAdmin) {
        await refreshJwtCookie(cookie, payload, cookieName as 'tutorAuth' | 'studentAuth');
      }

      const updated = await notificationService.markAllAsRead(userId);

      // Emit live sync over sockets
      const io = getIO();
      if (io) {
        io.to(`notifications:${userId}`).emit('notification:read-all', {
          unreadCount: 0
        });
      }

      return {
        success: true,
        data: { updated }
      };
    } catch (error) {
      console.error('Error in POST /notifications/read-all:', error);
      set.status = 500;
      return {
        success: false,
        error: 'Failed to mark all notifications as read'
      };
    }
  })

  /**
   * Delete a notification
   * DELETE /notifications/:id
   */
  .delete('/:id', async ({ params, cookie, set }) => {
    try {
      const isAdmin = !!cookie.adminAuth?.value;
      let raw = cookie.tutorAuth?.value || cookie.studentAuth?.value || cookie.adminAuth?.value;
      const cookieName = cookie.tutorAuth?.value ? 'tutorAuth' : cookie.studentAuth?.value ? 'studentAuth' : 'adminAuth';
      
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const userId = payload.userId;

      // Refresh JWT cookie on every request (adminAuth refresh not supported)
      if (!isAdmin) {
        await refreshJwtCookie(cookie, payload, cookieName as 'tutorAuth' | 'studentAuth');
      }

      const success = await notificationService.deleteNotification(params.id, userId);

      if (!success) {
        set.status = 404;
        return { success: false, error: 'Notification not found' };
      }

      // Emit live sync over sockets
      const io = getIO();
      if (io) {
        io.to(`notifications:${userId}`).emit('notification:delete', {
          notificationId: params.id,
          unreadCount: await notificationService.getUnreadCount(userId)
        });
      }

      return { success: true };
    } catch (error) {
      console.error('Error in DELETE /notifications/:id:', error);
      set.status = 500;
      return {
        success: false,
        error: 'Failed to delete notification'
      };
    }
  });

export default Notification;
