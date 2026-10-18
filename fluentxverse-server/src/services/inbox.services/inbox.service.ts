import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/postgres';
import type {
  SystemMessage,
  SystemMessageWithStatus,
  CreateSystemMessageParams,
  UpdateMessageStatusParams,
  GetUserMessagesParams,
  GetAllMessagesParams,
  MessageStats
} from './inbox.interface';

export class InboxService {
  /**
   * Create a new system message (admin only)
   */
  async createMessage(params: CreateSystemMessageParams): Promise<SystemMessage> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const result = await db`
      INSERT INTO system_messages (id, title, content, category, target_audience, priority, created_by, created_at, updated_at)
      VALUES (${id}, ${params.title}, ${params.content}, ${params.category}, ${params.targetAudience}, ${params.priority || 'normal'}, ${params.createdBy}, ${now}, ${now})
      RETURNING *
    `;

    const row = result[0];
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      category: row.category,
      targetAudience: row.target_audience,
      priority: row.priority,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Get all system messages for admin dashboard
   */
  async getAllMessages(params: GetAllMessagesParams): Promise<{ messages: SystemMessage[]; total: number }> {
    const limit = Math.max(1, Math.min(100, params.limit || 50));
    const offset = Math.max(0, params.offset || 0);

    // Build parameterized query to prevent SQL injection
    let whereConditions: string[] = [];
    let queryParams: any[] = [];
    let paramIndex = 1;

    if (params.category) {
      // Validate category against allowed values
      const allowedCategories = ['announcement', 'update', 'promotion', 'alert', 'general'];
      if (allowedCategories.includes(params.category)) {
        whereConditions.push(`category = $${paramIndex}`);
        queryParams.push(params.category);
        paramIndex++;
      }
    }
    if (params.targetAudience) {
      // Validate targetAudience against allowed values
      const allowedAudiences = ['all', 'students', 'tutors'];
      if (allowedAudiences.includes(params.targetAudience)) {
        whereConditions.push(`target_audience = $${paramIndex}`);
        queryParams.push(params.targetAudience);
        paramIndex++;
      }
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}` 
      : '';

    const messagesResult = await db.unsafe(`
      SELECT * FROM system_messages
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...queryParams, limit, offset]);

    const countResult = await db.unsafe(`
      SELECT COUNT(*) as total FROM system_messages ${whereClause}
    `, queryParams);

    const messages: SystemMessage[] = messagesResult.map((row: any) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      category: row.category,
      targetAudience: row.target_audience,
      priority: row.priority,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    return {
      messages,
      total: parseInt(countResult[0]?.total || '0', 10)
    };
  }

  /**
   * Get messages for a specific user (student or tutor)
   */
  async getUserMessages(params: GetUserMessagesParams): Promise<{ messages: SystemMessageWithStatus[]; stats: MessageStats }> {
    const limit = Math.max(1, Math.min(100, params.limit || 50));
    const offset = Math.max(0, params.offset || 0);
    
    // Validate userType
    if (!['student', 'tutor'].includes(params.userType)) {
      throw new Error('Invalid user type');
    }
    
    const targetAudiences = params.userType === 'student' 
      ? ['all', 'students'] 
      : ['all', 'tutors'];

    // First, ensure recipient records exist for this user
    await this.ensureRecipientRecords(params.userId, params.userType, targetAudiences);

    const targetAudiencePlaceholders = targetAudiences
      .map((_, index) => `$${index + 1}::varchar`)
      .join(', ');

    // Build parameterized query
    let whereConditions: string[] = [`sm.target_audience IN (${targetAudiencePlaceholders})`];
    let queryParams: any[] = [...targetAudiences];
    let paramIndex = queryParams.length + 1;

    if (params.category) {
      // Validate category
      const allowedCategories = ['announcement', 'update', 'promotion', 'alert', 'general'];
      if (allowedCategories.includes(params.category)) {
        whereConditions.push(`sm.category = $${paramIndex}::varchar`);
        queryParams.push(params.category);
        paramIndex++;
      }
    }
    if (params.isRead !== undefined) {
      whereConditions.push(`COALESCE(smr.is_read, false) = $${paramIndex}::boolean`);
      queryParams.push(params.isRead);
      paramIndex++;
    }
    if (params.isPinned !== undefined) {
      whereConditions.push(`COALESCE(smr.is_pinned, false) = $${paramIndex}::boolean`);
      queryParams.push(params.isPinned);
      paramIndex++;
    }

    const userIdParam = paramIndex;
    queryParams.push(params.userId);
    paramIndex++;

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    const messagesResult = await db.unsafe(`
      SELECT 
        sm.*,
        COALESCE(smr.is_read, false) as is_read,
        COALESCE(smr.is_pinned, false) as is_pinned,
        smr.read_at
      FROM system_messages sm
      LEFT JOIN system_message_recipients smr 
        ON sm.id = smr.message_id AND smr.user_id = $${userIdParam}::varchar
      ${whereClause}
      ORDER BY smr.is_pinned DESC NULLS LAST, sm.created_at DESC
      LIMIT $${paramIndex}::int OFFSET $${paramIndex + 1}::int
    `, [...queryParams, limit, offset]);

    // Get stats
    const statsUserIdParam = targetAudiences.length + 1;

    const statsResult = await db.unsafe(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE COALESCE(smr.is_read, false) = false) as unread,
        COUNT(*) FILTER (WHERE COALESCE(smr.is_pinned, false) = true) as pinned
      FROM system_messages sm
      LEFT JOIN system_message_recipients smr 
        ON sm.id = smr.message_id AND smr.user_id = $${statsUserIdParam}::varchar
      WHERE sm.target_audience IN (${targetAudiencePlaceholders})
    `, [...targetAudiences, params.userId]);

    const messages: SystemMessageWithStatus[] = messagesResult.map((row: any) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      category: row.category,
      targetAudience: row.target_audience,
      priority: row.priority,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isRead: row.is_read,
      isPinned: row.is_pinned,
      readAt: row.read_at
    }));

    const stats: MessageStats = {
      total: parseInt(statsResult[0]?.total || '0', 10),
      unread: parseInt(statsResult[0]?.unread || '0', 10),
      pinned: parseInt(statsResult[0]?.pinned || '0', 10)
    };

    return { messages, stats };
  }

  /**
   * Ensure recipient records exist for all relevant messages
   */
  private async ensureRecipientRecords(userId: string, userType: 'tutor' | 'student', targetAudiences: string[]): Promise<void> {
    // Validate userType to prevent injection
    if (!['tutor', 'student'].includes(userType)) {
      throw new Error('Invalid user type');
    }
    
    const targetAudiencePlaceholders = targetAudiences
      .map((_, index) => `$${index + 3}::varchar`)
      .join(', ');

    await db.unsafe(`
      INSERT INTO system_message_recipients (id, message_id, user_id, user_type, is_read, is_pinned, created_at)
      SELECT 
        uuid_generate_v4(),
        sm.id,
        $1::varchar,
        $2::varchar,
        false,
        false,
        NOW()
      FROM system_messages sm
      WHERE sm.target_audience IN (${targetAudiencePlaceholders})
        AND NOT EXISTS (
          SELECT 1 FROM system_message_recipients smr 
          WHERE smr.message_id = sm.id AND smr.user_id = $1::varchar
        )
    `, [userId, userType, ...targetAudiences]);
  }

  /**
   * Mark a message as read
   */
  async markAsRead(params: UpdateMessageStatusParams): Promise<void> {
    const now = new Date().toISOString();
    
    await db`
      INSERT INTO system_message_recipients (id, message_id, user_id, user_type, is_read, read_at, created_at)
      VALUES (${uuidv4()}, ${params.messageId}, ${params.userId}, ${params.userType}, true, ${now}, ${now})
      ON CONFLICT (message_id, user_id) 
      DO UPDATE SET is_read = true, read_at = ${now}
    `;
  }

  /**
   * Mark all messages as read for a user
   */
  async markAllAsRead(userId: string, userType: 'tutor' | 'student'): Promise<number> {
    const targetAudiences = userType === 'student' 
      ? ['all', 'students'] 
      : ['all', 'tutors'];
    const now = new Date().toISOString();

    // First ensure all recipient records exist
    await this.ensureRecipientRecords(userId, userType, targetAudiences);

    // Then mark all as read
    const result = await db`
      UPDATE system_message_recipients
      SET is_read = true, read_at = ${now}
      WHERE user_id = ${userId} AND is_read = false
    `;

    return result.length;
  }

  /**
   * Toggle pin status for a message
   */
  async togglePin(params: UpdateMessageStatusParams): Promise<boolean> {
    const now = new Date().toISOString();

    // First, ensure the recipient record exists
    await db`
      INSERT INTO system_message_recipients (id, message_id, user_id, user_type, is_read, is_pinned, created_at)
      VALUES (${uuidv4()}, ${params.messageId}, ${params.userId}, ${params.userType}, false, false, ${now})
      ON CONFLICT (message_id, user_id) DO NOTHING
    `;

    // Toggle the pin status
    const result = await db`
      UPDATE system_message_recipients
      SET is_pinned = NOT is_pinned
      WHERE message_id = ${params.messageId} AND user_id = ${params.userId}
      RETURNING is_pinned
    `;

    return result[0]?.is_pinned || false;
  }

  /**
   * Get unread count for a user
   */
  async getUnreadCount(userId: string, userType: 'tutor' | 'student'): Promise<number> {
    const targetAudiences = userType === 'student' 
      ? ['all', 'students'] 
      : ['all', 'tutors'];

    const result = await db`
      SELECT COUNT(*) as unread
      FROM system_messages sm
      LEFT JOIN system_message_recipients smr 
        ON sm.id = smr.message_id AND smr.user_id = ${userId}
      WHERE sm.target_audience IN (${db.unsafe(targetAudiences.map(t => `'${t}'`).join(','))})
        AND COALESCE(smr.is_read, false) = false
    `;

    return parseInt(result[0]?.unread || '0', 10);
  }

  /**
   * Delete a system message (admin only)
   */
  async deleteMessage(messageId: string): Promise<boolean> {
    const result = await db`
      DELETE FROM system_messages WHERE id = ${messageId}
    `;
    return result.length > 0;
  }

  /**
   * Update a system message (admin only)
   */
  async updateMessage(messageId: string, updates: Partial<CreateSystemMessageParams>): Promise<SystemMessage | null> {
    const now = new Date().toISOString();

    const setClauses: string[] = ['updated_at = $1'];
    const values: any[] = [now];
    let paramIndex = 2;

    if (updates.title) {
      setClauses.push(`title = $${paramIndex++}`);
      values.push(updates.title);
    }
    if (updates.content) {
      setClauses.push(`content = $${paramIndex++}`);
      values.push(updates.content);
    }
    if (updates.category) {
      setClauses.push(`category = $${paramIndex++}`);
      values.push(updates.category);
    }
    if (updates.targetAudience) {
      setClauses.push(`target_audience = $${paramIndex++}`);
      values.push(updates.targetAudience);
    }
    if (updates.priority) {
      setClauses.push(`priority = $${paramIndex++}`);
      values.push(updates.priority);
    }

    values.push(messageId);

    const result = await db.unsafe(
      `UPDATE system_messages SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.length === 0) return null;

    const row = result[0];
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      category: row.category,
      targetAudience: row.target_audience,
      priority: row.priority,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export const inboxService = new InboxService();
