import { db } from '../../db/postgres';
import { v4 as uuidv4 } from 'uuid';

// Types
export interface LessonHeader {
  levelBadge: string;
  chapterLabel: string;
  lessonLabel: string;
  goalText: string;
  goalSubtext: string;
  backgroundImage: string;
  overlayColor: string;
}

export interface VocabularyItem {
  id: string;
  word: string;
  reading: string;
  english: string;
}

export interface GrammarPoint {
  id: string;
  structure: string;
  meaning: string;
  example: string;
  translation: string;
}

export interface Exercise {
  id: string;
  type: 'fill-blank' | 'multiple-choice' | 'matching';
  question: string;
  correctAnswer: string;
  options?: string[];
}

export interface LessonMaterial {
  header: LessonHeader;
  vocabulary: VocabularyItem[];
  grammar: GrammarPoint[];
  exercises: Exercise[];

  // Newer builder format (dashboard) stores most content in sections
  version?: number;
  sections?: any[];

  // Allow forward-compatible fields without blocking saves
  [key: string]: any;
}

export interface Lesson {
  id: string;
  title: string;
  slug: string;
  status: 'draft' | 'finished' | 'published' | 'archived';
  parentId: string | null;
  forkOf: string | null;
  isFork: boolean;
  createdBy: string;
  createdByName: string | null;
  storagePath: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  // Virtual fields populated when fetching
  currentVersion?: number;
  forkCount?: number;
  hasPendingMergeRequest?: boolean;
}

export interface LessonVersion {
  id: string;
  lessonId: string;
  versionNumber: number;
  lessonData: LessonMaterial;
  changeSummary: string | null;
  changedBy: string;
  changedByName: string | null;
  createdAt: string;
}

export interface MergeRequest {
  id: string;
  sourceLessonId: string;
  sourceVersion: number;
  targetLessonId: string;
  title: string;
  description: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'merged';
  requestedBy: string;
  requestedByName: string | null;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewComment: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Virtual fields
  sourceLesson?: Lesson;
  targetLesson?: Lesson;
  comments?: MergeRequestComment[];
}

export interface MergeRequestComment {
  id: string;
  mergeRequestId: string;
  comment: string;
  authorId: string;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
}

const FILER_BASE = process.env.SEAWEED_FILER_URL || 'http://localhost:8888';

function generateSlug(title: string): string {
  return (title || 'lesson')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'lesson';
}

export class LessonService {
  
  // ============ LESSON CRUD ============
  
  /**
   * Create a new lesson (original, not a fork)
   */
  async createLesson(
    material: LessonMaterial,
    createdBy: string,
    createdByName?: string
  ): Promise<{ lesson: Lesson; version: LessonVersion }> {
    const title = material.header.lessonLabel || 'Untitled Lesson';
    const slug = generateSlug(title);
    const timestamp = Date.now();
    const lessonId = `${slug}-${timestamp}`;
    const storagePath = `/lessons/${lessonId}`;
    const now = new Date().toISOString();
    
    // Insert lesson record
    const lessonResult = await db`
      INSERT INTO lessons (id, title, slug, status, created_by, created_by_name, storage_path, created_at, updated_at)
      VALUES (${lessonId}, ${title}, ${slug}, 'draft', ${createdBy}, ${createdByName || null}, ${storagePath}, ${now}, ${now})
      RETURNING *
    `;
    
    // Create initial version (version 1)
    const versionResult = await db`
      INSERT INTO lesson_versions (lesson_id, version_number, lesson_data, change_summary, changed_by, changed_by_name, created_at)
      VALUES (${lessonId}, 1, ${JSON.stringify(material)}, 'Initial version', ${createdBy}, ${createdByName || null}, ${now})
      RETURNING *
    `;
    
    const lesson = this.mapLessonRow(lessonResult[0]);
    const version = this.mapVersionRow(versionResult[0]);
    
    return { lesson, version };
  }
  
  /**
   * Fork an existing lesson (creates a copy with fork relationship)
   */
  async forkLesson(
    originalLessonId: string,
    forkedBy: string,
    forkedByName?: string
  ): Promise<{ lesson: Lesson; version: LessonVersion }> {
    // Get the original lesson and its latest version
    const original = await this.getLessonById(originalLessonId);
    if (!original) {
      throw new Error('Original lesson not found');
    }
    
    const latestVersion = await this.getLatestVersion(originalLessonId);
    if (!latestVersion) {
      throw new Error('Original lesson has no versions');
    }
    
    // Generate new ID for the fork
    const timestamp = Date.now();
    const forkId = `${original.slug}-fork-${timestamp}`;
    const storagePath = `/lessons/${forkId}`;
    const now = new Date().toISOString();
    
    // Create the fork record
    const lessonResult = await db`
      INSERT INTO lessons (id, title, slug, status, parent_id, fork_of, is_fork, created_by, created_by_name, storage_path, created_at, updated_at)
      VALUES (
        ${forkId}, 
        ${original.title + ' (Fork)'}, 
        ${original.slug}, 
        'draft', 
        ${originalLessonId}, 
        ${originalLessonId}, 
        true, 
        ${forkedBy}, 
        ${forkedByName || null}, 
        ${storagePath}, 
        ${now}, 
        ${now}
      )
      RETURNING *
    `;
    
    // Create initial version with copied data
    const versionResult = await db`
      INSERT INTO lesson_versions (lesson_id, version_number, lesson_data, change_summary, changed_by, changed_by_name, created_at)
      VALUES (${forkId}, 1, ${JSON.stringify(latestVersion.lessonData)}, ${'Forked from ' + originalLessonId}, ${forkedBy}, ${forkedByName || null}, ${now})
      RETURNING *
    `;
    
    const lesson = this.mapLessonRow(lessonResult[0]);
    const version = this.mapVersionRow(versionResult[0]);
    
    return { lesson, version };
  }
  
  /**
   * Update a lesson (creates a new version)
   */
  async updateLesson(
    lessonId: string,
    material: LessonMaterial,
    updatedBy: string,
    updatedByName?: string,
    changeSummary?: string
  ): Promise<{ lesson: Lesson; version: LessonVersion }> {
    const lesson = await this.getLessonById(lessonId);
    if (!lesson) {
      throw new Error('Lesson not found');
    }
    
    // Check if user can edit
    // Only the creator can edit, OR if it's a fork, the fork creator can edit their fork
    if (lesson.createdBy !== updatedBy) {
      throw new Error('Only the lesson creator can edit this lesson');
    }
    
    const now = new Date().toISOString();
    const newTitle = material.header.lessonLabel || lesson.title;
    
    // Get the next version number
    const latestVersion = await this.getLatestVersion(lessonId);
    const nextVersionNumber = (latestVersion?.versionNumber || 0) + 1;
    
    // Update lesson metadata
    await db`
      UPDATE lessons 
      SET title = ${newTitle}, updated_at = ${now}
      WHERE id = ${lessonId}
    `;
    
    // Create new version
    const versionResult = await db`
      INSERT INTO lesson_versions (lesson_id, version_number, lesson_data, change_summary, changed_by, changed_by_name, created_at)
      VALUES (${lessonId}, ${nextVersionNumber}, ${JSON.stringify(material)}, ${changeSummary || null}, ${updatedBy}, ${updatedByName || null}, ${now})
      RETURNING *
    `;
    
    const updatedLesson = await this.getLessonById(lessonId);
    const version = this.mapVersionRow(versionResult[0]);
    
    return { lesson: updatedLesson!, version };
  }
  
  /**
   * Publish a lesson (any authenticated dashboard user can publish)
   */
  async publishLesson(lessonId: string, publishedBy: string): Promise<Lesson> {
    const lesson = await this.getLessonById(lessonId);
    if (!lesson) {
      throw new Error('Lesson not found');
    }
    
    // Allow any authenticated user to publish (dashboard users)
    // The route already requires authentication
    
    if (lesson.isFork) {
      throw new Error('Forks cannot be published directly. Submit a merge request instead.');
    }
    
    const now = new Date().toISOString();
    
    await db`
      UPDATE lessons 
      SET status = 'published', published_at = ${now}, updated_at = ${now}
      WHERE id = ${lessonId}
    `;
    
    return (await this.getLessonById(lessonId))!;
  }
  
  /**
   * Get lesson by ID with optional version info
   */
  async getLessonById(lessonId: string): Promise<Lesson | null> {
    const result = await db`
      SELECT l.*, 
        (SELECT MAX(version_number) FROM lesson_versions WHERE lesson_id = l.id) as current_version,
        (SELECT COUNT(*) FROM lessons WHERE fork_of = l.id) as fork_count,
        EXISTS(SELECT 1 FROM lesson_merge_requests WHERE target_lesson_id = l.id AND status = 'pending') as has_pending_merge_request
      FROM lessons l
      WHERE l.id = ${lessonId}
    `;
    
    if (result.length === 0) return null;
    return this.mapLessonRow(result[0]);
  }
  
  /**
   * Get all lessons (with filters)
   */
  async getLessons(options: {
    status?: 'draft' | 'finished' | 'published' | 'archived';
    createdBy?: string;
    includeForks?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ lessons: Lesson[]; total: number }> {
    const { status, createdBy, includeForks = true, limit = 50, offset = 0 } = options;
    
    let whereConditions: string[] = [];
    
    if (status) {
      whereConditions.push(`l.status = '${status}'`);
    }
    if (createdBy) {
      whereConditions.push(`l.created_by = '${createdBy}'`);
    }
    if (!includeForks) {
      whereConditions.push(`l.is_fork = false`);
    }
    
    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';
    
    const result = await db.unsafe(`
      SELECT l.*, 
        (SELECT MAX(version_number) FROM lesson_versions WHERE lesson_id = l.id) as current_version,
        (SELECT COUNT(*) FROM lessons WHERE fork_of = l.id) as fork_count,
        EXISTS(SELECT 1 FROM lesson_merge_requests WHERE target_lesson_id = l.id AND status = 'pending') as has_pending_merge_request
      FROM lessons l
      ${whereClause}
      ORDER BY l.updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    
    const countResult = await db.unsafe(`
      SELECT COUNT(*) as total FROM lessons l ${whereClause}
    `);
    
    return {
      lessons: result.map((row: any) => this.mapLessonRow(row)),
      total: parseInt(countResult[0]?.total || '0', 10)
    };
  }
  
  /**
   * Get forks of a lesson
   */
  async getLessonForks(originalLessonId: string): Promise<Lesson[]> {
    const result = await db`
      SELECT l.*, 
        (SELECT MAX(version_number) FROM lesson_versions WHERE lesson_id = l.id) as current_version
      FROM lessons l
      WHERE l.fork_of = ${originalLessonId}
      ORDER BY l.created_at DESC
    `;
    
    return result.map((row: any) => this.mapLessonRow(row));
  }
  
  // ============ VERSION MANAGEMENT ============
  
  /**
   * Get the latest version of a lesson
   */
  async getLatestVersion(lessonId: string): Promise<LessonVersion | null> {
    const result = await db`
      SELECT * FROM lesson_versions 
      WHERE lesson_id = ${lessonId}
      ORDER BY version_number DESC
      LIMIT 1
    `;
    
    if (result.length === 0) return null;
    return this.mapVersionRow(result[0]);
  }
  
  /**
   * Get a specific version
   */
  async getVersion(lessonId: string, versionNumber: number): Promise<LessonVersion | null> {
    const result = await db`
      SELECT * FROM lesson_versions 
      WHERE lesson_id = ${lessonId} AND version_number = ${versionNumber}
    `;
    
    if (result.length === 0) return null;
    return this.mapVersionRow(result[0]);
  }
  
  /**
   * Get version history for a lesson
   */
  async getVersionHistory(lessonId: string): Promise<LessonVersion[]> {
    const result = await db`
      SELECT * FROM lesson_versions 
      WHERE lesson_id = ${lessonId}
      ORDER BY version_number DESC
    `;
    
    return result.map((row: any) => this.mapVersionRow(row));
  }

  /**
   * Update version data (e.g., to add header image URL after upload)
   */
  async updateVersionData(lessonId: string, versionNumber: number, lessonData: LessonMaterial): Promise<void> {
    await db`
      UPDATE lesson_versions 
      SET lesson_data = ${JSON.stringify(lessonData)}
      WHERE lesson_id = ${lessonId} AND version_number = ${versionNumber}
    `;
  }
  
  // ============ MERGE REQUESTS ============
  
  /**
   * Create a merge request (from fork to original)
   */
  async createMergeRequest(
    sourceLessonId: string,
    title: string,
    description: string | null,
    requestedBy: string,
    requestedByName?: string
  ): Promise<MergeRequest> {
    const sourceLesson = await this.getLessonById(sourceLessonId);
    if (!sourceLesson) {
      throw new Error('Source lesson not found');
    }
    
    if (!sourceLesson.isFork || !sourceLesson.forkOf) {
      throw new Error('Only forked lessons can create merge requests');
    }
    
    if (sourceLesson.createdBy !== requestedBy) {
      throw new Error('Only the fork creator can submit merge requests');
    }
    
    // Check for existing pending merge request
    const existing = await db`
      SELECT id FROM lesson_merge_requests 
      WHERE source_lesson_id = ${sourceLessonId} AND status = 'pending'
    `;
    
    if (existing.length > 0) {
      throw new Error('A pending merge request already exists for this fork');
    }
    
    const latestVersion = await this.getLatestVersion(sourceLessonId);
    if (!latestVersion) {
      throw new Error('Fork has no versions');
    }
    
    const now = new Date().toISOString();
    
    const result = await db`
      INSERT INTO lesson_merge_requests (
        source_lesson_id, source_version, target_lesson_id, title, description,
        requested_by, requested_by_name, created_at, updated_at
      )
      VALUES (
        ${sourceLessonId}, ${latestVersion.versionNumber}, ${sourceLesson.forkOf},
        ${title}, ${description}, ${requestedBy}, ${requestedByName || null}, ${now}, ${now}
      )
      RETURNING *
    `;
    
    return this.mapMergeRequestRow(result[0]);
  }
  
  /**
   * Get merge requests for a lesson (as target)
   */
  async getMergeRequestsForLesson(targetLessonId: string, status?: string): Promise<MergeRequest[]> {
    let result;
    
    if (status) {
      result = await db`
        SELECT * FROM lesson_merge_requests 
        WHERE target_lesson_id = ${targetLessonId} AND status = ${status}
        ORDER BY created_at DESC
      `;
    } else {
      result = await db`
        SELECT * FROM lesson_merge_requests 
        WHERE target_lesson_id = ${targetLessonId}
        ORDER BY created_at DESC
      `;
    }
    
    return result.map((row: any) => this.mapMergeRequestRow(row));
  }
  
  /**
   * Get merge request by ID
   */
  async getMergeRequestById(mrId: string): Promise<MergeRequest | null> {
    const result = await db`
      SELECT * FROM lesson_merge_requests WHERE id = ${mrId}
    `;
    
    if (result.length === 0) return null;
    
    const mr = this.mapMergeRequestRow(result[0]);
    
    // Populate lesson info
    mr.sourceLesson = await this.getLessonById(mr.sourceLessonId) || undefined;
    mr.targetLesson = await this.getLessonById(mr.targetLessonId) || undefined;
    
    return mr;
  }
  
  /**
   * Review a merge request (approve, reject, or merge)
   */
  async reviewMergeRequest(
    mrId: string,
    action: 'approve' | 'reject' | 'merge',
    reviewedBy: string,
    reviewedByName?: string,
    comment?: string
  ): Promise<MergeRequest> {
    const mr = await this.getMergeRequestById(mrId);
    if (!mr) {
      throw new Error('Merge request not found');
    }
    
    if (mr.status !== 'pending' && mr.status !== 'approved') {
      throw new Error('Merge request is not pending or approved');
    }
    
    // Only the original lesson creator can review
    const targetLesson = await this.getLessonById(mr.targetLessonId);
    if (!targetLesson || targetLesson.createdBy !== reviewedBy) {
      throw new Error('Only the original lesson creator can review merge requests');
    }
    
    const now = new Date().toISOString();
    let newStatus: string;
    
    if (action === 'merge') {
      // Actually merge the changes
      await this.performMerge(mr);
      newStatus = 'merged';
    } else if (action === 'approve') {
      newStatus = 'approved';
    } else {
      newStatus = 'rejected';
    }
    
    await db`
      UPDATE lesson_merge_requests 
      SET status = ${newStatus}, reviewed_by = ${reviewedBy}, reviewed_by_name = ${reviewedByName || null},
          review_comment = ${comment || null}, reviewed_at = ${now}, updated_at = ${now}
      WHERE id = ${mrId}
    `;
    
    return (await this.getMergeRequestById(mrId))!;
  }
  
  // ============ ADDITIONAL OPERATIONS ============
  
  /**
   * Restore lesson to a specific version
   */
  async restoreVersion(
    lessonId: string,
    versionNumber: number,
    restoredBy: string,
    restoredByName?: string
  ): Promise<{ lesson: Lesson; version: LessonVersion }> {
    const lesson = await this.getLessonById(lessonId);
    if (!lesson) {
      throw new Error('Lesson not found');
    }
    
    if (lesson.createdBy !== restoredBy) {
      throw new Error('Only the lesson creator can restore versions');
    }
    
    const targetVersion = await this.getVersion(lessonId, versionNumber);
    if (!targetVersion) {
      throw new Error('Version not found');
    }
    
    const latestVersion = await this.getLatestVersion(lessonId);
    const nextVersionNumber = (latestVersion?.versionNumber || 0) + 1;
    const now = new Date().toISOString();
    
    // Create new version with restored content
    const versionResult = await db`
      INSERT INTO lesson_versions (lesson_id, version_number, lesson_data, change_summary, changed_by, changed_by_name, created_at)
      VALUES (${lessonId}, ${nextVersionNumber}, ${JSON.stringify(targetVersion.lessonData)}, ${'Restored to version ' + versionNumber}, ${restoredBy}, ${restoredByName || null}, ${now})
      RETURNING *
    `;
    
    // Update lesson metadata
    const newTitle = targetVersion.lessonData.header.lessonLabel;
    await db`
      UPDATE lessons 
      SET title = ${newTitle}, updated_at = ${now}
      WHERE id = ${lessonId}
    `;
    
    const updatedLesson = await this.getLessonById(lessonId);
    const version = this.mapVersionRow(versionResult[0]);
    
    return { lesson: updatedLesson!, version };
  }
  
  /**
   * Unpublish a lesson (back to draft)
   */
  async unpublishLesson(lessonId: string, userId: string): Promise<Lesson> {
    const lesson = await this.getLessonById(lessonId);
    if (!lesson) {
      throw new Error('Lesson not found');
    }
    
    if (lesson.createdBy !== userId) {
      throw new Error('Only the lesson creator can unpublish this lesson');
    }
    
    if (lesson.status !== 'published') {
      throw new Error('Lesson is not published');
    }
    
    const now = new Date().toISOString();
    
    await db`
      UPDATE lessons 
      SET status = 'draft', published_at = NULL, updated_at = ${now}
      WHERE id = ${lessonId}
    `;
    
    return (await this.getLessonById(lessonId))!;
  }

  /**
   * Mark a lesson as finished (ready for review but not published)
   */
  async markAsFinished(lessonId: string, userId: string): Promise<Lesson> {
    const lesson = await this.getLessonById(lessonId);
    if (!lesson) {
      throw new Error('Lesson not found');
    }
    
    if (lesson.createdBy !== userId) {
      throw new Error('Only the lesson creator can mark this lesson as finished');
    }
    
    if (lesson.status !== 'draft') {
      throw new Error('Only draft lessons can be marked as finished');
    }
    
    const now = new Date().toISOString();
    
    await db`
      UPDATE lessons 
      SET status = 'finished', updated_at = ${now}
      WHERE id = ${lessonId}
    `;
    
    return (await this.getLessonById(lessonId))!;
  }

  /**
   * Mark a lesson back to draft (for editing after being finished)
   */
  async markAsDraft(lessonId: string, userId: string): Promise<Lesson> {
    const lesson = await this.getLessonById(lessonId);
    if (!lesson) {
      throw new Error('Lesson not found');
    }
    
    if (lesson.createdBy !== userId) {
      throw new Error('Only the lesson creator can mark this lesson as draft');
    }
    
    // Can go back to draft from finished or published
    if (lesson.status !== 'finished' && lesson.status !== 'published') {
      throw new Error('Lesson must be finished or published to mark as draft');
    }
    
    const now = new Date().toISOString();
    
    await db`
      UPDATE lessons 
      SET status = 'draft', published_at = NULL, updated_at = ${now}
      WHERE id = ${lessonId}
    `;
    
    return (await this.getLessonById(lessonId))!;
  }
  
  /**
   * Archive a lesson
   */
  async archiveLesson(lessonId: string, userId: string): Promise<Lesson> {
    const lesson = await this.getLessonById(lessonId);
    if (!lesson) {
      throw new Error('Lesson not found');
    }
    
    if (lesson.createdBy !== userId) {
      throw new Error('Only the lesson creator can archive this lesson');
    }
    
    const now = new Date().toISOString();
    
    await db`
      UPDATE lessons 
      SET status = 'archived', updated_at = ${now}
      WHERE id = ${lessonId}
    `;
    
    return (await this.getLessonById(lessonId))!;
  }
  
  /**
   * Unarchive a lesson (back to draft)
   */
  async unarchiveLesson(lessonId: string, userId: string): Promise<Lesson> {
    const lesson = await this.getLessonById(lessonId);
    if (!lesson) {
      throw new Error('Lesson not found');
    }
    
    if (lesson.createdBy !== userId) {
      throw new Error('Only the lesson creator can unarchive this lesson');
    }
    
    if (lesson.status !== 'archived') {
      throw new Error('Lesson is not archived');
    }
    
    const now = new Date().toISOString();
    
    await db`
      UPDATE lessons 
      SET status = 'draft', updated_at = ${now}
      WHERE id = ${lessonId}
    `;
    
    return (await this.getLessonById(lessonId))!;
  }
  
  /**
   * Delete a lesson (and all its versions, forks, merge requests)
   */
  async deleteLesson(lessonId: string, userId: string): Promise<void> {
    const lesson = await this.getLessonById(lessonId);
    if (!lesson) {
      throw new Error('Lesson not found');
    }
    
    if (lesson.createdBy !== userId) {
      throw new Error('Only the lesson creator can delete this lesson');
    }
    
    // Delete all forks first (they reference this lesson)
    await db`DELETE FROM lessons WHERE fork_of = ${lessonId}`;
    
    // Delete the lesson (versions and merge requests cascade)
    await db`DELETE FROM lessons WHERE id = ${lessonId}`;
  }
  
  // ============ MERGE REQUEST COMMENTS ============
  
  /**
   * Add a comment to a merge request
   */
  async addMergeRequestComment(
    mrId: string,
    comment: string,
    authorId: string,
    authorName?: string
  ): Promise<MergeRequestComment> {
    const mr = await this.getMergeRequestById(mrId);
    if (!mr) {
      throw new Error('Merge request not found');
    }
    
    const now = new Date().toISOString();
    
    const result = await db`
      INSERT INTO lesson_merge_request_comments (merge_request_id, comment, author_id, author_name, created_at, updated_at)
      VALUES (${mrId}, ${comment}, ${authorId}, ${authorName || null}, ${now}, ${now})
      RETURNING *
    `;
    
    return this.mapCommentRow(result[0]);
  }
  
  /**
   * Get comments for a merge request
   */
  async getMergeRequestComments(mrId: string): Promise<MergeRequestComment[]> {
    const result = await db`
      SELECT * FROM lesson_merge_request_comments 
      WHERE merge_request_id = ${mrId}
      ORDER BY created_at ASC
    `;
    
    return result.map((row: any) => this.mapCommentRow(row));
  }
  
  /**
   * Delete a comment (author only)
   */
  async deleteMergeRequestComment(commentId: string, userId: string): Promise<void> {
    const result = await db`
      SELECT * FROM lesson_merge_request_comments WHERE id = ${commentId}
    `;
    
    if (result.length === 0) {
      throw new Error('Comment not found');
    }
    
    if (result[0].author_id !== userId) {
      throw new Error('Only the comment author can delete this comment');
    }
    
    await db`DELETE FROM lesson_merge_request_comments WHERE id = ${commentId}`;
  }
  
  // ============ SEARCH & FILTER ============
  
  /**
   * Search lessons with advanced filters
   */
  async searchLessons(options: {
    query?: string;
    status?: 'draft' | 'finished' | 'published' | 'archived';
    createdBy?: string;
    includeForks?: boolean;
    hasForks?: boolean;
    hasPendingMergeRequests?: boolean;
    sortBy?: 'created' | 'updated' | 'title';
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  }): Promise<{ lessons: Lesson[]; total: number }> {
    const { 
      query, 
      status, 
      createdBy, 
      includeForks = true, 
      hasForks,
      hasPendingMergeRequests,
      sortBy = 'updated', 
      sortOrder = 'desc',
      limit = 50, 
      offset = 0 
    } = options;
    
    // Use parameterized queries to prevent SQL injection
    let whereConditions: string[] = [];
    let params: any[] = [];
    let paramIndex = 1;
    
    if (query) {
      // Sanitize and escape the search query for LIKE patterns
      const sanitizedQuery = query.replace(/[%_\\]/g, '\\$&'); // Escape special LIKE chars
      whereConditions.push(`(l.title ILIKE $${paramIndex} OR l.slug ILIKE $${paramIndex})`);
      params.push(`%${sanitizedQuery}%`);
      paramIndex++;
    }
    if (status) {
      // Validate status is one of allowed values
      const allowedStatuses = ['draft', 'finished', 'published', 'archived'];
      if (!allowedStatuses.includes(status)) {
        throw new Error('Invalid status value');
      }
      whereConditions.push(`l.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }
    if (createdBy) {
      whereConditions.push(`l.created_by = $${paramIndex}`);
      params.push(createdBy);
      paramIndex++;
    }
    if (!includeForks) {
      whereConditions.push(`l.is_fork = false`);
    }
    if (hasForks !== undefined) {
      if (hasForks) {
        whereConditions.push(`(SELECT COUNT(*) FROM lessons WHERE fork_of = l.id) > 0`);
      } else {
        whereConditions.push(`(SELECT COUNT(*) FROM lessons WHERE fork_of = l.id) = 0`);
      }
    }
    if (hasPendingMergeRequests !== undefined) {
      if (hasPendingMergeRequests) {
        whereConditions.push(`EXISTS(SELECT 1 FROM lesson_merge_requests WHERE target_lesson_id = l.id AND status = 'pending')`);
      } else {
        whereConditions.push(`NOT EXISTS(SELECT 1 FROM lesson_merge_requests WHERE target_lesson_id = l.id AND status = 'pending')`);
      }
    }
    
    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';
    
    // Validate sortBy to prevent SQL injection
    const sortColumnMap: Record<string, string> = {
      'created': 'l.created_at',
      'title': 'l.title',
      'updated': 'l.updated_at'
    };
    const sortColumn = sortColumnMap[sortBy] || 'l.updated_at';
    const sortDir = sortOrder === 'asc' ? 'ASC' : 'DESC';
    
    // Validate limit and offset are positive integers
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const safeOffset = Math.max(0, Number(offset) || 0);
    
    const result = await db.unsafe(`
      SELECT l.*, 
        (SELECT MAX(version_number) FROM lesson_versions WHERE lesson_id = l.id) as current_version,
        (SELECT COUNT(*) FROM lessons WHERE fork_of = l.id) as fork_count,
        EXISTS(SELECT 1 FROM lesson_merge_requests WHERE target_lesson_id = l.id AND status = 'pending') as has_pending_merge_request
      FROM lessons l
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDir}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, safeLimit, safeOffset]);
    
    const countResult = await db.unsafe(`
      SELECT COUNT(*) as total FROM lessons l ${whereClause}
    `, params);
    
    return {
      lessons: result.map((row: any) => this.mapLessonRow(row)),
      total: parseInt(countResult[0]?.total || '0', 10)
    };
  }
  
  /**
   * Perform the actual merge (copy fork's latest version to original)
   */
  private async performMerge(mr: MergeRequest): Promise<void> {
    const sourceVersion = await this.getVersion(mr.sourceLessonId, mr.sourceVersion);
    if (!sourceVersion) {
      throw new Error('Source version not found');
    }
    
    const targetLesson = await this.getLessonById(mr.targetLessonId);
    if (!targetLesson) {
      throw new Error('Target lesson not found');
    }
    
    // Create new version on target with merged content
    const latestTargetVersion = await this.getLatestVersion(mr.targetLessonId);
    const nextVersionNumber = (latestTargetVersion?.versionNumber || 0) + 1;
    const now = new Date().toISOString();
    
    await db`
      INSERT INTO lesson_versions (lesson_id, version_number, lesson_data, change_summary, changed_by, changed_by_name, created_at)
      VALUES (
        ${mr.targetLessonId}, 
        ${nextVersionNumber}, 
        ${JSON.stringify(sourceVersion.lessonData)}, 
        ${'Merged from fork: ' + mr.sourceLessonId + ' (MR #' + mr.id.slice(0, 8) + ')'},
        ${mr.requestedBy},
        ${mr.requestedByName || null},
        ${now}
      )
    `;
    
    // Update target lesson title if changed
    const newTitle = sourceVersion.lessonData.header.lessonLabel;
    await db`
      UPDATE lessons 
      SET title = ${newTitle}, updated_at = ${now}
      WHERE id = ${mr.targetLessonId}
    `;
  }
  
  // ============ HELPERS ============
  
  private mapLessonRow(row: any): Lesson {
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      status: row.status,
      parentId: row.parent_id,
      forkOf: row.fork_of,
      isFork: row.is_fork,
      createdBy: row.created_by,
      createdByName: row.created_by_name,
      storagePath: row.storage_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedAt: row.published_at,
      currentVersion: row.current_version ? parseInt(row.current_version, 10) : undefined,
      forkCount: row.fork_count ? parseInt(row.fork_count, 10) : undefined,
      hasPendingMergeRequest: row.has_pending_merge_request
    };
  }
  
  private mapVersionRow(row: any): LessonVersion {
    return {
      id: row.id,
      lessonId: row.lesson_id,
      versionNumber: row.version_number,
      lessonData: typeof row.lesson_data === 'string' ? JSON.parse(row.lesson_data) : row.lesson_data,
      changeSummary: row.change_summary,
      changedBy: row.changed_by,
      changedByName: row.changed_by_name,
      createdAt: row.created_at
    };
  }
  
  private mapMergeRequestRow(row: any): MergeRequest {
    return {
      id: row.id,
      sourceLessonId: row.source_lesson_id,
      sourceVersion: row.source_version,
      targetLessonId: row.target_lesson_id,
      title: row.title,
      description: row.description,
      status: row.status,
      requestedBy: row.requested_by,
      requestedByName: row.requested_by_name,
      reviewedBy: row.reviewed_by,
      reviewedByName: row.reviewed_by_name,
      reviewComment: row.review_comment,
      reviewedAt: row.reviewed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
  
  private mapCommentRow(row: any): MergeRequestComment {
    return {
      id: row.id,
      mergeRequestId: row.merge_request_id,
      comment: row.comment,
      authorId: row.author_id,
      authorName: row.author_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Save a lesson as a reusable template
   */
  async saveAsTemplate(lessonId: string): Promise<{ success: boolean; error?: string }> {
    const lesson = await this.getLessonById(lessonId);
    if (!lesson) {
      return { success: false, error: 'Lesson not found' };
    }
    // TODO: Implement full template save logic (copy lesson data to templates table)
    return { success: true };
  }

  /**
   * Update merge request status directly
   */
  async updateMergeRequestStatus(
    mrId: string,
    status: 'pending' | 'approved' | 'rejected' | 'merged',
    userId?: string
  ): Promise<{ success: boolean; error?: string }> {
    const actionMap: Record<string, 'approve' | 'reject' | 'merge'> = {
      approved: 'approve',
      rejected: 'reject',
      merged: 'merge'
    };
    const action = actionMap[status];
    if (!action) {
      return { success: false, error: 'Invalid status transition' };
    }
    try {
      await this.reviewMergeRequest(mrId, action, userId || 'system');
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to update status' };
    }
  }
}

export const lessonService = new LessonService();
