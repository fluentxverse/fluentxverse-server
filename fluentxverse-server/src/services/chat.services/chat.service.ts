import { query } from '../../db/postgres';
import type { SharedClassroomMaterial } from '../../socket/types/socket.types';

export interface ChatMessage {
  id: string;
  session_id: string;
  sender_id: string;
  sender_type: 'tutor' | 'student';
  message_text: string;
  display_text: string;
  correction_text: string | null;
  edited_message_text: string | null;
  edited_at: Date | null;
  is_deleted: boolean;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  material: SharedClassroomMaterial | null;
}

export interface SaveMessageData {
  sessionId: string;
  senderId: string;
  senderType: 'tutor' | 'student';
  text: string;
  correction?: string;
  material?: SharedClassroomMaterial;
}

// Generate a unique message ID (cryptographically secure)
const generateMessageId = (): string => {
  return `msg-${crypto.randomUUID()}`;
};

export class ChatService {
  private schemaReady: Promise<void> | null = null;

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
        await query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_message_text TEXT`);
        await query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP`);
        await query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false`);
        await query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
        await query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS material JSONB`);
      })();
    }

    return this.schemaReady;
  }

  async saveMessage(data: SaveMessageData): Promise<ChatMessage> {
    await this.ensureSchema();

    const { sessionId, senderId, senderType, text, correction, material } = data;
    const id = generateMessageId();

    const result = await query(
      `INSERT INTO chat_messages (id, session_id, sender_id, sender_type, message_text, correction_text, material)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING *, COALESCE(edited_message_text, message_text) AS display_text`,
      [id, sessionId, senderId, senderType, text, correction || null, material || null]
    );

    return result.rows[0];
  }

  async getSessionMessages(sessionId: string, limit = 100): Promise<ChatMessage[]> {
    await this.ensureSchema();

    const result = await query(
      `SELECT *, COALESCE(edited_message_text, message_text) AS display_text
       FROM chat_messages
       WHERE session_id = $1
         AND COALESCE(is_deleted, false) = false
       ORDER BY created_at ASC
       LIMIT $2`,
      [sessionId, limit]
    );

    return result.rows;
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    await this.ensureSchema();

    const result = await query(
      `UPDATE chat_messages
       SET is_deleted = true,
           deleted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [messageId]
    );

    return (result.rowCount || 0) > 0;
  }

  async softDeleteMessage(messageId: string, sessionId: string, senderId: string, senderType: 'tutor' | 'student'): Promise<boolean> {
    await this.ensureSchema();

    const strictResult = await query(
      `UPDATE chat_messages
       SET is_deleted = true,
           deleted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
         AND session_id = $2
         AND sender_id = $3
         AND sender_type = $4
         AND COALESCE(is_deleted, false) = false
       RETURNING id`,
      [messageId, sessionId, senderId, senderType]
    );

    if ((strictResult.rowCount || 0) > 0) {
      return true;
    }

    // Classroom sessions are one tutor and one student. Some socket tokens can use
    // a different user id shape than older stored chat rows, so keep ownership tied
    // to the participant role inside the joined session as a fallback.
    const participantResult = await query(
      `UPDATE chat_messages
       SET is_deleted = true,
           deleted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
         AND session_id = $2
         AND sender_type = $3
         AND COALESCE(is_deleted, false) = false
       RETURNING id`,
      [messageId, sessionId, senderType]
    );

    return (participantResult.rowCount || 0) > 0;
  }

  async editMessage(messageId: string, sessionId: string, senderId: string, senderType: 'tutor' | 'student', text: string): Promise<ChatMessage | null> {
    await this.ensureSchema();

    const result = await query(
      `UPDATE chat_messages
       SET edited_message_text = $1,
           edited_at = NOW(),
           updated_at = NOW()
       WHERE id = $2
         AND session_id = $3
         AND sender_id = $4
         AND sender_type = $5
         AND COALESCE(is_deleted, false) = false
         AND material IS NULL
       RETURNING *, COALESCE(edited_message_text, message_text) AS display_text`,
      [text, messageId, sessionId, senderId, senderType]
    );

    return result.rows[0] || null;
  }

  async updateCorrection(messageId: string, correction: string): Promise<ChatMessage | null> {
    await this.ensureSchema();

    const result = await query(
      `UPDATE chat_messages
       SET correction_text = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *, COALESCE(edited_message_text, message_text) AS display_text`,
      [correction, messageId]
    );

    return result.rows[0] || null;
  }
}
