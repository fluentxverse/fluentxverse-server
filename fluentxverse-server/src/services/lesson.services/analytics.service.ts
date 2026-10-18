import { pool } from '../../db/postgres';

export interface LessonView {
  id: string;
  lessonId: string;
  userId: string | null;
  userType: string | null;
  sessionId: string | null;
  viewedAt: Date;
  timeSpent: number;
  completed: boolean;
  completionPercentage: number;
}

export interface LessonProgress {
  id: string;
  lessonId: string;
  userId: string;
  startedAt: Date;
  lastAccessedAt: Date;
  completedAt: Date | null;
  sectionsCompleted: string[];
  vocabularyMastered: string[];
  exercisesCompleted: ExerciseResult[];
  vocabularyScore: number | null;
  grammarScore: number | null;
  exerciseScore: number | null;
  overallScore: number | null;
  nextReviewDate: Date | null;
  reviewCount: number;
}

export interface ExerciseResult {
  exerciseId: string;
  correct: boolean;
  answer: string;
  completedAt: string;
}

export interface LessonStats {
  lessonId: string;
  totalViews: number;
  uniqueViewers: number;
  totalStarts: number;
  totalCompletions: number;
  completionRate: number;
  avgVocabularyScore: number | null;
  avgGrammarScore: number | null;
  avgExerciseScore: number | null;
  avgOverallScore: number | null;
  avgTimeSpent: number;
  bookmarkCount: number;
  updatedAt: Date;
}

class LessonAnalyticsService {
  /**
   * Record a lesson view
   */
  async recordView(data: {
    lessonId: string;
    userId?: string;
    userType?: string;
    sessionId?: string;
  }): Promise<{ success: boolean; viewId?: string; error?: string }> {
    try {
      const result = await pool.query(`
        INSERT INTO lesson_views (lesson_id, user_id, user_type, session_id)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [data.lessonId, data.userId || null, data.userType || null, data.sessionId || null]);

      // Update lesson stats
      await this.updateLessonStats(data.lessonId);

      return { success: true, viewId: result.rows[0].id };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Update time spent on a view
   */
  async updateViewTime(viewId: string, timeSpent: number, completionPercentage: number): Promise<{ success: boolean; error?: string }> {
    try {
      await pool.query(`
        UPDATE lesson_views
        SET time_spent = $2, completion_percentage = $3, completed = $3 >= 100
        WHERE id = $1
      `, [viewId, timeSpent, completionPercentage]);

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Get or create progress record for a user
   */
  async getOrCreateProgress(lessonId: string, userId: string): Promise<LessonProgress> {
    // Try to get existing progress
    const existing = await pool.query(`
      SELECT id, lesson_id, user_id, started_at, last_accessed_at, completed_at,
             sections_completed, vocabulary_mastered, exercises_completed,
             vocabulary_score, grammar_score, exercise_score, overall_score,
             next_review_date, review_count
      FROM lesson_progress
      WHERE lesson_id = $1 AND user_id = $2
    `, [lessonId, userId]);

    if (existing.rows.length > 0) {
      // Update last accessed
      await pool.query(`
        UPDATE lesson_progress SET last_accessed_at = NOW() WHERE id = $1
      `, [existing.rows[0].id]);
      return this.mapProgressRow(existing.rows[0]);
    }

    // Create new progress record
    const result = await pool.query(`
      INSERT INTO lesson_progress (lesson_id, user_id)
      VALUES ($1, $2)
      RETURNING id, lesson_id, user_id, started_at, last_accessed_at, completed_at,
                sections_completed, vocabulary_mastered, exercises_completed,
                vocabulary_score, grammar_score, exercise_score, overall_score,
                next_review_date, review_count
    `, [lessonId, userId]);

    // Update lesson stats
    await this.updateLessonStats(lessonId);

    return this.mapProgressRow(result.rows[0]);
  }

  /**
   * Update progress with section completion
   */
  async completeSection(progressId: string, sectionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await pool.query(`
        UPDATE lesson_progress
        SET sections_completed = sections_completed || $2::jsonb,
            last_accessed_at = NOW()
        WHERE id = $1 AND NOT (sections_completed @> $2::jsonb)
      `, [progressId, JSON.stringify([sectionId])]);

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Mark vocabulary item as mastered
   */
  async masterVocabulary(progressId: string, vocabularyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await pool.query(`
        UPDATE lesson_progress
        SET vocabulary_mastered = vocabulary_mastered || $2::jsonb,
            last_accessed_at = NOW()
        WHERE id = $1 AND NOT (vocabulary_mastered @> $2::jsonb)
      `, [progressId, JSON.stringify([vocabularyId])]);

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Record exercise completion
   */
  async completeExercise(progressId: string, result: ExerciseResult): Promise<{ success: boolean; error?: string }> {
    try {
      await pool.query(`
        UPDATE lesson_progress
        SET exercises_completed = exercises_completed || $2::jsonb,
            last_accessed_at = NOW()
        WHERE id = $1
      `, [progressId, JSON.stringify([result])]);

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Update scores for a progress record
   */
  async updateScores(progressId: string, scores: {
    vocabularyScore?: number;
    grammarScore?: number;
    exerciseScore?: number;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      // Calculate overall score
      const scoresToAvg = [scores.vocabularyScore, scores.grammarScore, scores.exerciseScore].filter(s => s !== undefined);
      const overallScore = scoresToAvg.length > 0 
        ? Math.round(scoresToAvg.reduce((a, b) => a + (b || 0), 0) / scoresToAvg.length)
        : null;

      await pool.query(`
        UPDATE lesson_progress
        SET vocabulary_score = COALESCE($2, vocabulary_score),
            grammar_score = COALESCE($3, grammar_score),
            exercise_score = COALESCE($4, exercise_score),
            overall_score = $5,
            last_accessed_at = NOW()
        WHERE id = $1
      `, [progressId, scores.vocabularyScore, scores.grammarScore, scores.exerciseScore, overallScore]);

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Mark lesson as completed
   */
  async completeLesson(progressId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Get the progress to find lesson ID
      const progress = await pool.query(`
        SELECT lesson_id FROM lesson_progress WHERE id = $1
      `, [progressId]);

      if (progress.rows.length === 0) {
        return { success: false, error: 'Progress not found' };
      }

      // Update progress
      await pool.query(`
        UPDATE lesson_progress
        SET completed_at = NOW(),
            last_accessed_at = NOW(),
            review_count = review_count + 1,
            next_review_date = CURRENT_DATE + INTERVAL '1 day' * POWER(2, review_count)
        WHERE id = $1
      `, [progressId]);

      // Update lesson stats
      await this.updateLessonStats(progress.rows[0].lesson_id);

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Get user's progress for all lessons
   */
  async getUserProgress(userId: string): Promise<LessonProgress[]> {
    const result = await pool.query(`
      SELECT id, lesson_id, user_id, started_at, last_accessed_at, completed_at,
             sections_completed, vocabulary_mastered, exercises_completed,
             vocabulary_score, grammar_score, exercise_score, overall_score,
             next_review_date, review_count
      FROM lesson_progress
      WHERE user_id = $1
      ORDER BY last_accessed_at DESC
    `, [userId]);
    return result.rows.map(this.mapProgressRow);
  }

  /**
   * Get lessons due for review
   */
  async getLessonsDueForReview(userId: string): Promise<LessonProgress[]> {
    const result = await pool.query(`
      SELECT id, lesson_id, user_id, started_at, last_accessed_at, completed_at,
             sections_completed, vocabulary_mastered, exercises_completed,
             vocabulary_score, grammar_score, exercise_score, overall_score,
             next_review_date, review_count
      FROM lesson_progress
      WHERE user_id = $1 AND next_review_date <= CURRENT_DATE
      ORDER BY next_review_date
    `, [userId]);
    return result.rows.map(this.mapProgressRow);
  }

  /**
   * Get stats for a lesson
   */
  async getLessonStats(lessonId: string): Promise<LessonStats | null> {
    const result = await pool.query(`
      SELECT lesson_id, total_views, unique_viewers, total_starts, total_completions,
             completion_rate, avg_vocabulary_score, avg_grammar_score, avg_exercise_score,
             avg_overall_score, avg_time_spent, bookmark_count, updated_at
      FROM lesson_stats
      WHERE lesson_id = $1
    `, [lessonId]);

    if (result.rows.length === 0) return null;
    return this.mapStatsRow(result.rows[0]);
  }

  /**
   * Update aggregated stats for a lesson
   */
  async updateLessonStats(lessonId: string): Promise<void> {
    await pool.query(`
      INSERT INTO lesson_stats (lesson_id, total_views, unique_viewers, total_starts, total_completions,
                                completion_rate, avg_vocabulary_score, avg_grammar_score, avg_exercise_score,
                                avg_overall_score, avg_time_spent, bookmark_count)
      SELECT 
        $1 as lesson_id,
        COALESCE((SELECT COUNT(*) FROM lesson_views WHERE lesson_id = $1), 0) as total_views,
        COALESCE((SELECT COUNT(DISTINCT user_id) FROM lesson_views WHERE lesson_id = $1 AND user_id IS NOT NULL), 0) as unique_viewers,
        COALESCE((SELECT COUNT(*) FROM lesson_progress WHERE lesson_id = $1), 0) as total_starts,
        COALESCE((SELECT COUNT(*) FROM lesson_progress WHERE lesson_id = $1 AND completed_at IS NOT NULL), 0) as total_completions,
        CASE 
          WHEN (SELECT COUNT(*) FROM lesson_progress WHERE lesson_id = $1) > 0 
          THEN (SELECT COUNT(*) FROM lesson_progress WHERE lesson_id = $1 AND completed_at IS NOT NULL)::decimal / 
               (SELECT COUNT(*) FROM lesson_progress WHERE lesson_id = $1) * 100
          ELSE 0
        END as completion_rate,
        (SELECT AVG(vocabulary_score) FROM lesson_progress WHERE lesson_id = $1 AND vocabulary_score IS NOT NULL),
        (SELECT AVG(grammar_score) FROM lesson_progress WHERE lesson_id = $1 AND grammar_score IS NOT NULL),
        (SELECT AVG(exercise_score) FROM lesson_progress WHERE lesson_id = $1 AND exercise_score IS NOT NULL),
        (SELECT AVG(overall_score) FROM lesson_progress WHERE lesson_id = $1 AND overall_score IS NOT NULL),
        COALESCE((SELECT AVG(time_spent) FROM lesson_views WHERE lesson_id = $1), 0),
        COALESCE((SELECT COUNT(*) FROM lesson_bookmarks WHERE lesson_id = $1), 0)
      ON CONFLICT (lesson_id) DO UPDATE SET
        total_views = EXCLUDED.total_views,
        unique_viewers = EXCLUDED.unique_viewers,
        total_starts = EXCLUDED.total_starts,
        total_completions = EXCLUDED.total_completions,
        completion_rate = EXCLUDED.completion_rate,
        avg_vocabulary_score = EXCLUDED.avg_vocabulary_score,
        avg_grammar_score = EXCLUDED.avg_grammar_score,
        avg_exercise_score = EXCLUDED.avg_exercise_score,
        avg_overall_score = EXCLUDED.avg_overall_score,
        avg_time_spent = EXCLUDED.avg_time_spent,
        bookmark_count = EXCLUDED.bookmark_count,
        updated_at = NOW()
    `, [lessonId]);
  }

  /**
   * Bookmark a lesson
   */
  async bookmarkLesson(userId: string, lessonId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await pool.query(`
        INSERT INTO lesson_bookmarks (user_id, lesson_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [userId, lessonId]);

      await this.updateLessonStats(lessonId);
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Remove bookmark
   */
  async removeBookmark(userId: string, lessonId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await pool.query(`
        DELETE FROM lesson_bookmarks WHERE user_id = $1 AND lesson_id = $2
      `, [userId, lessonId]);

      await this.updateLessonStats(lessonId);
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Get user's bookmarked lessons
   */
  async getUserBookmarks(userId: string): Promise<string[]> {
    const result = await pool.query(`
      SELECT lesson_id FROM lesson_bookmarks WHERE user_id = $1 ORDER BY created_at DESC
    `, [userId]);
    return result.rows.map((r: any) => r.lesson_id);
  }

  /**
   * Check if lesson is bookmarked
   */
  async isBookmarked(userId: string, lessonId: string): Promise<boolean> {
    const result = await pool.query(`
      SELECT 1 FROM lesson_bookmarks WHERE user_id = $1 AND lesson_id = $2
    `, [userId, lessonId]);
    return result.rows.length > 0;
  }

  private mapProgressRow(row: Record<string, unknown>): LessonProgress {
    return {
      id: row.id as string,
      lessonId: row.lesson_id as string,
      userId: row.user_id as string,
      startedAt: new Date(row.started_at as string),
      lastAccessedAt: new Date(row.last_accessed_at as string),
      completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
      sectionsCompleted: row.sections_completed as string[],
      vocabularyMastered: row.vocabulary_mastered as string[],
      exercisesCompleted: row.exercises_completed as ExerciseResult[],
      vocabularyScore: row.vocabulary_score as number | null,
      grammarScore: row.grammar_score as number | null,
      exerciseScore: row.exercise_score as number | null,
      overallScore: row.overall_score as number | null,
      nextReviewDate: row.next_review_date ? new Date(row.next_review_date as string) : null,
      reviewCount: row.review_count as number
    };
  }

  private mapStatsRow(row: Record<string, unknown>): LessonStats {
    return {
      lessonId: row.lesson_id as string,
      totalViews: row.total_views as number,
      uniqueViewers: row.unique_viewers as number,
      totalStarts: row.total_starts as number,
      totalCompletions: row.total_completions as number,
      completionRate: parseFloat(row.completion_rate as string) || 0,
      avgVocabularyScore: row.avg_vocabulary_score ? parseFloat(row.avg_vocabulary_score as string) : null,
      avgGrammarScore: row.avg_grammar_score ? parseFloat(row.avg_grammar_score as string) : null,
      avgExerciseScore: row.avg_exercise_score ? parseFloat(row.avg_exercise_score as string) : null,
      avgOverallScore: row.avg_overall_score ? parseFloat(row.avg_overall_score as string) : null,
      avgTimeSpent: row.avg_time_spent as number,
      bookmarkCount: row.bookmark_count as number,
      updatedAt: new Date(row.updated_at as string)
    };
  }
}

export const lessonAnalyticsService = new LessonAnalyticsService();
