import Elysia, { t } from 'elysia';
import { inboxService } from '../services/inbox.services/inbox.service';
import { db } from '../db/postgres';
import { verifyAuthToken, verifyAdminToken, refreshJwtCookie, type JwtAuthPayload } from '../utils/jwt';
import { safePaginationLimit, safePaginationOffset, MAX_PAGINATION_LIMITS } from '../utils/rateLimiter';
import type { MessageCategory, TargetAudience, MessagePriority } from '../services/inbox.services/inbox.interface';

/**
 * Helper to get authenticated user from cookies
 */
async function getAuthUser(cookie: any, set: any): Promise<{ payload: JwtAuthPayload; userType: 'tutor' | 'student'; cookieName: string } | null> {
  const tutorRaw = cookie.tutorAuth?.value;
  const studentRaw = cookie.studentAuth?.value;
  
  if (tutorRaw) {
    const payload = await verifyAuthToken(String(tutorRaw));
    if (payload) return { payload, userType: 'tutor', cookieName: 'tutorAuth' };
  }
  
  if (studentRaw) {
    const payload = await verifyAuthToken(String(studentRaw));
    if (payload) return { payload, userType: 'student', cookieName: 'studentAuth' };
  }
  
  set.status = 401;
  return null;
}

const Inbox = new Elysia({ prefix: '/inbox' })

  /**
   * Health check for inbox - verifies database tables exist
   * GET /inbox/health
   */
  .get('/health', async () => {
    try {
      // Check if tables exist
      const tablesResult = await db`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('system_messages', 'system_message_recipients')
      `;
      
      const tables = tablesResult.map((r: any) => r.table_name);
      const messagesTableExists = tables.includes('system_messages');
      const recipientsTableExists = tables.includes('system_message_recipients');
      
      // Get message count
      let messageCount = 0;
      if (messagesTableExists) {
        const countResult = await db`SELECT COUNT(*) as count FROM system_messages`;
        messageCount = parseInt(countResult[0]?.count || '0', 10);
      }
      
      return {
        success: true,
        data: {
          messagesTableExists,
          recipientsTableExists,
          messageCount,
          tables
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: 'Database check failed',
        details: error?.message
      };
    }
  })

  /**
   * Get messages for a user (student or tutor)
   * GET /inbox/messages
   * SECURITY: Requires authentication, returns only the authenticated user's messages
   */
  .get('/messages', async ({ query, cookie, set }) => {
    try {
      // SECURITY: Authenticate user from cookie - no longer trust query params
      const auth = await getAuthUser(cookie, set);
      if (!auth) {
        return { success: false, error: 'Not authenticated' };
      }
      
      const { payload, userType, cookieName } = auth;
      const userId = payload.userId;
      
      // Refresh JWT cookie
      await refreshJwtCookie(cookie, payload, cookieName as 'tutorAuth' | 'studentAuth');

      const result = await inboxService.getUserMessages({
        userId,
        userType,
        category: query.category as MessageCategory,
        isRead: query.isRead === 'true' ? true : query.isRead === 'false' ? false : undefined,
        isPinned: query.isPinned === 'true' ? true : query.isPinned === 'false' ? false : undefined,
        limit: safePaginationLimit(query.limit, 50, MAX_PAGINATION_LIMITS.list),
        offset: safePaginationOffset(query.offset, 0)
      });

      return {
        success: true,
        data: result
      };
    } catch (error: any) {
      console.error('Error in /inbox/messages:', error);
      return {
        success: false,
        error: 'Failed to get messages'
      };
    }
  })

  /**
   * Get unread count for a user
   * GET /inbox/unread-count
   * SECURITY: Requires authentication
   */
  .get('/unread-count', async ({ cookie, set }) => {
    try {
      const auth = await getAuthUser(cookie, set);
      if (!auth) {
        return { success: false, error: 'Not authenticated' };
      }
      
      const { payload, userType, cookieName } = auth;
      const userId = payload.userId;
      
      await refreshJwtCookie(cookie, payload, cookieName as 'tutorAuth' | 'studentAuth');

      const count = await inboxService.getUnreadCount(userId, userType);

      return {
        success: true,
        data: { unreadCount: count }
      };
    } catch (error: any) {
      console.error('Error in /inbox/unread-count:', error);
      return {
        success: false,
        error: 'Failed to get unread count'
      };
    }
  })

  /**
   * Mark a message as read
   * POST /inbox/mark-read/:messageId
   * SECURITY: Requires authentication, only marks for authenticated user
   */
  .post('/mark-read/:messageId', async ({ params, cookie, set }) => {
    try {
      const auth = await getAuthUser(cookie, set);
      if (!auth) {
        return { success: false, error: 'Not authenticated' };
      }
      
      const { payload, userType, cookieName } = auth;
      const userId = payload.userId;
      
      await refreshJwtCookie(cookie, payload, cookieName as 'tutorAuth' | 'studentAuth');

      await inboxService.markAsRead({
        messageId: params.messageId,
        userId,
        userType
      });

      return {
        success: true,
        message: 'Message marked as read'
      };
    } catch (error) {
      console.error('Error in /inbox/mark-read:', error);
      return {
        success: false,
        error: 'Failed to mark message as read'
      };
    }
  })

  /**
   * Mark all messages as read for a user
   * POST /inbox/mark-all-read
   * SECURITY: Requires authentication
   */
  .post('/mark-all-read', async ({ cookie, set }) => {
    try {
      const auth = await getAuthUser(cookie, set);
      if (!auth) {
        return { success: false, error: 'Not authenticated' };
      }
      
      const { payload, userType, cookieName } = auth;
      const userId = payload.userId;
      
      await refreshJwtCookie(cookie, payload, cookieName as 'tutorAuth' | 'studentAuth');

      const count = await inboxService.markAllAsRead(userId, userType);

      return {
        success: true,
        message: `${count} messages marked as read`
      };
    } catch (error) {
      console.error('Error in /inbox/mark-all-read:', error);
      return {
        success: false,
        error: 'Failed to mark all messages as read'
      };
    }
  })

  /**
   * Toggle pin status for a message
   * POST /inbox/toggle-pin/:messageId
   * SECURITY: Requires authentication
   */
  .post('/toggle-pin/:messageId', async ({ params, cookie, set }) => {
    try {
      const auth = await getAuthUser(cookie, set);
      if (!auth) {
        return { success: false, error: 'Not authenticated' };
      }
      
      const { payload, userType, cookieName } = auth;
      const userId = payload.userId;
      
      await refreshJwtCookie(cookie, payload, cookieName as 'tutorAuth' | 'studentAuth');

      const isPinned = await inboxService.togglePin({
        messageId: params.messageId,
        userId,
        userType
      });

      return {
        success: true,
        data: { isPinned }
      };
    } catch (error) {
      console.error('Error in /inbox/toggle-pin:', error);
      return {
        success: false,
        error: 'Failed to toggle pin'
      };
    }
  })

  /**
   * Admin: Create a new system message
   * POST /inbox/admin/create
   * SECURITY: Requires admin authentication
   */
  .post('/admin/create', async ({ body, cookie, set }) => {
    try {
      // Verify admin authentication
      const adminRaw = cookie.adminAuth?.value;
      if (!adminRaw) {
        set.status = 401;
        return { success: false, error: 'Admin authentication required' };
      }
      
      const adminPayload = await verifyAdminToken(String(adminRaw));
      if (!adminPayload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired admin token' };
      }

      const { title, content, category, targetAudience, priority } = body as {
        title: string;
        content: string;
        category: MessageCategory;
        targetAudience: TargetAudience;
        priority?: MessagePriority;
      };

      if (!title || !content || !category || !targetAudience) {
        return {
          success: false,
          error: 'title, content, category, and targetAudience are required'
        };
      }

      const message = await inboxService.createMessage({
        title,
        content,
        category,
        targetAudience,
        priority,
        createdBy: adminPayload.userId
      });

      return {
        success: true,
        data: message
      };
    } catch (error) {
      console.error('Error in /inbox/admin/create:', error);
      return {
        success: false,
        error: 'Failed to create message'
      };
    }
  })

  /**
   * Admin: Get all system messages
   * GET /inbox/admin/messages
   * SECURITY: Requires admin authentication
   */
  .get('/admin/messages', async ({ query, cookie, set }) => {
    try {
      const adminRaw = cookie.adminAuth?.value;
      if (!adminRaw) {
        set.status = 401;
        return { success: false, error: 'Admin authentication required' };
      }
      
      const adminPayload = await verifyAdminToken(String(adminRaw));
      if (!adminPayload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired admin token' };
      }

      const result = await inboxService.getAllMessages({
        category: query.category as MessageCategory,
        targetAudience: query.targetAudience as TargetAudience,
        limit: safePaginationLimit(query.limit, 50, MAX_PAGINATION_LIMITS.list),
        offset: safePaginationOffset(query.offset, 0)
      });

      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('Error in /inbox/admin/messages:', error);
      return {
        success: false,
        error: 'Failed to get messages'
      };
    }
  })

  /**
   * Admin: Update a system message
   * PUT /inbox/admin/update/:messageId
   * SECURITY: Requires admin authentication
   */
  .put('/admin/update/:messageId', async ({ params, body, cookie, set }) => {
    try {
      const adminRaw = cookie.adminAuth?.value;
      if (!adminRaw) {
        set.status = 401;
        return { success: false, error: 'Admin authentication required' };
      }
      
      const adminPayload = await verifyAdminToken(String(adminRaw));
      if (!adminPayload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired admin token' };
      }

      const updates = body as {
        title?: string;
        content?: string;
        category?: MessageCategory;
        targetAudience?: TargetAudience;
        priority?: MessagePriority;
      };

      const message = await inboxService.updateMessage(params.messageId, updates);

      if (!message) {
        return {
          success: false,
          error: 'Message not found'
        };
      }

      return {
        success: true,
        data: message
      };
    } catch (error) {
      console.error('Error in /inbox/admin/update:', error);
      return {
        success: false,
        error: 'Failed to update message'
      };
    }
  })

  /**
   * Admin: Delete a system message
   * DELETE /inbox/admin/delete/:messageId
   * SECURITY: Requires admin authentication
   */
  .delete('/admin/delete/:messageId', async ({ params, cookie, set }) => {
    try {
      const adminRaw = cookie.adminAuth?.value;
      if (!adminRaw) {
        set.status = 401;
        return { success: false, error: 'Admin authentication required' };
      }
      
      const adminPayload = await verifyAdminToken(String(adminRaw));
      if (!adminPayload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired admin token' };
      }

      const deleted = await inboxService.deleteMessage(params.messageId);

      return {
        success: true,
        message: deleted ? 'Message deleted' : 'Message not found'
      };
    } catch (error) {
      console.error('Error in /inbox/admin/delete:', error);
      return {
        success: false,
        error: 'Failed to delete message'
      };
    }
  });

export default Inbox;
