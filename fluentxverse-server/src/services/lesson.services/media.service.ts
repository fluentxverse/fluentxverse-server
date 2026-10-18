import { pool } from '../../db/postgres';

export interface LessonMedia {
  id: string;
  lessonId: string;
  type: 'audio' | 'video' | 'image' | 'document';
  filename: string;
  storagePath: string;
  mimeType: string | null;
  fileSize: number | null;
  title: string | null;
  description: string | null;
  duration: number | null;
  vocabularyItemId: string | null;
  createdAt: Date;
  updatedAt: Date;
  url?: string; // Proxy URL through API server
}

// Internal URL for server-to-server communication inside Docker
const FILER_BASE = process.env.SEAWEED_FILER_URL || 'http://localhost:8888';
// API base URL for constructing proxy URLs (browser accesses files via API)
const API_BASE = process.env.API_PUBLIC_URL || 'http://localhost:8765';

class LessonMediaService {
  /**
   * Get all media for a lesson
   */
  async getMediaForLesson(lessonId: string): Promise<LessonMedia[]> {
    const result = await pool.query(`
      SELECT id, lesson_id, type, filename, storage_path, mime_type, file_size,
             title, description, duration, vocabulary_item_id, created_at, updated_at
      FROM lesson_media
      WHERE lesson_id = $1
      ORDER BY type, created_at
    `, [lessonId]);
    return result.rows.map(this.mapMediaRow);
  }

  /**
   * Get media by type for a lesson
   */
  async getMediaByType(lessonId: string, type: LessonMedia['type']): Promise<LessonMedia[]> {
    const result = await pool.query(`
      SELECT id, lesson_id, type, filename, storage_path, mime_type, file_size,
             title, description, duration, vocabulary_item_id, created_at, updated_at
      FROM lesson_media
      WHERE lesson_id = $1 AND type = $2
      ORDER BY created_at
    `, [lessonId, type]);
    return result.rows.map(this.mapMediaRow);
  }

  /**
   * Get audio files for vocabulary items
   */
  async getVocabularyAudio(lessonId: string): Promise<LessonMedia[]> {
    const result = await pool.query(`
      SELECT id, lesson_id, type, filename, storage_path, mime_type, file_size,
             title, description, duration, vocabulary_item_id, created_at, updated_at
      FROM lesson_media
      WHERE lesson_id = $1 AND type = 'audio' AND vocabulary_item_id IS NOT NULL
      ORDER BY created_at
    `, [lessonId]);
    return result.rows.map(this.mapMediaRow);
  }

  // Allowed MIME types for security
  private readonly ALLOWED_MIME_TYPES: Record<string, string[]> = {
    audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac'],
    video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
    document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  };

  // Max file sizes in bytes
  private readonly MAX_FILE_SIZES: Record<string, number> = {
    audio: 50 * 1024 * 1024,    // 50MB
    video: 500 * 1024 * 1024,   // 500MB
    image: 10 * 1024 * 1024,    // 10MB
    document: 20 * 1024 * 1024  // 20MB
  };

  /**
   * Upload media file to SeaweedFS and create database record
   */
  async uploadMedia(
    lessonId: string,
    file: {
      buffer: Buffer;
      filename: string;
      mimeType: string;
      size: number;
    },
    metadata: {
      type: LessonMedia['type'];
      title?: string;
      description?: string;
      duration?: number;
      vocabularyItemId?: string;
    }
  ): Promise<{ success: boolean; media?: LessonMedia; error?: string }> {
    try {
      // SECURITY: Validate file type matches declared MIME type
      const allowedMimes = this.ALLOWED_MIME_TYPES[metadata.type];
      if (!allowedMimes || !allowedMimes.includes(file.mimeType)) {
        return { 
          success: false, 
          error: `Invalid file type. Allowed types for ${metadata.type}: ${allowedMimes?.join(', ') || 'none'}` 
        };
      }

      // SECURITY: Validate file size
      const maxSize = this.MAX_FILE_SIZES[metadata.type] ?? 5 * 1024 * 1024; // default 5MB
      if (file.size > maxSize) {
        return { 
          success: false, 
          error: `File too large. Maximum size for ${metadata.type}: ${Math.floor(maxSize / 1024 / 1024)}MB` 
        };
      }

      // SECURITY: Validate filename doesn't contain path traversal
      if (file.filename.includes('..') || file.filename.includes('/') || file.filename.includes('\\')) {
        return { success: false, error: 'Invalid filename' };
      }

      // Generate storage path
      const timestamp = Date.now();
      const sanitizedFilename = file.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      const storagePath = `/lessons/${lessonId}/media/${metadata.type}/${timestamp}-${sanitizedFilename}`;

      // Upload to SeaweedFS
      const uploadUrl = `${FILER_BASE}${storagePath}`;
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        body: file.buffer,
        headers: {
          'Content-Type': file.mimeType
        }
      });

      if (!uploadRes.ok) {
        return { success: false, error: 'Failed to upload file to storage' };
      }

      // Create database record
      const result = await pool.query(`
        INSERT INTO lesson_media (
          lesson_id, type, filename, storage_path, mime_type, file_size,
          title, description, duration, vocabulary_item_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, lesson_id, type, filename, storage_path, mime_type, file_size,
                  title, description, duration, vocabulary_item_id, created_at, updated_at
      `, [
        lessonId,
        metadata.type,
        file.filename,
        storagePath,
        file.mimeType,
        file.size,
        metadata.title || null,
        metadata.description || null,
        metadata.duration || null,
        metadata.vocabularyItemId || null
      ]);

      return { success: true, media: this.mapMediaRow(result.rows[0]) };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Update media metadata
   */
  async updateMedia(
    mediaId: string,
    data: Partial<{
      title: string;
      description: string;
      duration: number;
      vocabularyItemId: string;
    }>
  ): Promise<{ success: boolean; media?: LessonMedia; error?: string }> {
    try {
      const setClauses: string[] = [];
      const values: (string | number | null)[] = [];
      let paramIndex = 1;

      if (data.title !== undefined) {
        setClauses.push(`title = $${paramIndex++}`);
        values.push(data.title);
      }
      if (data.description !== undefined) {
        setClauses.push(`description = $${paramIndex++}`);
        values.push(data.description);
      }
      if (data.duration !== undefined) {
        setClauses.push(`duration = $${paramIndex++}`);
        values.push(data.duration);
      }
      if (data.vocabularyItemId !== undefined) {
        setClauses.push(`vocabulary_item_id = $${paramIndex++}`);
        values.push(data.vocabularyItemId);
      }

      if (setClauses.length === 0) {
        return { success: false, error: 'No fields to update' };
      }

      setClauses.push(`updated_at = NOW()`);
      values.push(mediaId);

      const result = await pool.query(`
        UPDATE lesson_media
        SET ${setClauses.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING id, lesson_id, type, filename, storage_path, mime_type, file_size,
                  title, description, duration, vocabulary_item_id, created_at, updated_at
      `, values);

      if (result.rows.length === 0) {
        return { success: false, error: 'Media not found' };
      }

      return { success: true, media: this.mapMediaRow(result.rows[0]) };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Delete media file
   */
  async deleteMedia(mediaId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Get the media record first
      const mediaResult = await pool.query(`
        SELECT storage_path FROM lesson_media WHERE id = $1
      `, [mediaId]);

      if (mediaResult.rows.length === 0) {
        return { success: false, error: 'Media not found' };
      }

      const storagePath = mediaResult.rows[0].storage_path;

      // Delete from SeaweedFS
      const deleteUrl = `${FILER_BASE}${storagePath}`;
      await fetch(deleteUrl, { method: 'DELETE' });

      // Delete database record
      await pool.query(`DELETE FROM lesson_media WHERE id = $1`, [mediaId]);

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Get media URL for streaming/download
   */
  getMediaUrl(storagePath: string): string {
    return `${FILER_BASE}${storagePath}`;
  }

  private mapMediaRow(row: Record<string, unknown>): LessonMedia {
    const storagePath = row.storage_path as string;
    return {
      id: row.id as string,
      lessonId: row.lesson_id as string,
      type: row.type as LessonMedia['type'],
      filename: row.filename as string,
      storagePath: storagePath,
      mimeType: row.mime_type as string | null,
      fileSize: row.file_size as number | null,
      title: row.title as string | null,
      description: row.description as string | null,
      duration: row.duration as number | null,
      vocabularyItemId: row.vocabulary_item_id as string | null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
      // Proxy URL through API server (keeps SeaweedFS internal)
      url: `${API_BASE}/lesson/files${storagePath}`
    };
  }
}

export const lessonMediaService = new LessonMediaService();