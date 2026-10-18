import { Elysia } from 'elysia';
import { lessonAnalyticsService } from '../services/lesson.services/analytics.service';
import { getAuthFromCookie } from '../utils/refreshCookie';

export const analyticsRoute = new Elysia({ prefix: '/lesson' })
  
  // Record a view
  .post('/:lessonId/view', async ({ params, body, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      const { sessionId } = body as { sessionId?: string };

      const result = await lessonAnalyticsService.recordView({
        lessonId: params.lessonId,
        userId: auth?.sub,
        userType: auth ? 'student' : undefined,  // Could be determined from auth
        sessionId
      });

      return result;
    } catch (error) {
      console.error('Error recording view:', error);
      return { success: false, error: 'Failed to record view' };
    }
  })

  // Update view time
  .patch('/view/:viewId', async ({ params, body, cookie }) => {
    try {
      // SECURITY: Verify user owns this view record
      const auth = await getAuthFromCookie(cookie);
      if (!auth?.sub) {
        return { success: false, error: 'Unauthorized' };
      }
      
      const { timeSpent, completionPercentage } = body as {
        timeSpent: number;
        completionPercentage: number;
      };

      const result = await lessonAnalyticsService.updateViewTime(
        params.viewId,
        timeSpent,
        completionPercentage
      );

      return result;
    } catch (error) {
      console.error('Error updating view:', error);
      return { success: false, error: 'Failed to update view' };
    }
  })

  // Get or create progress
  .get('/:lessonId/progress', async ({ params, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }

      const progress = await lessonAnalyticsService.getOrCreateProgress(
        params.lessonId,
        auth.sub || ''
      );

      return { success: true, progress };
    } catch (error) {
      console.error('Error getting progress:', error);
      return { success: false, error: 'Failed to get progress' };
    }
  })

  // Complete a section
  .post('/progress/:progressId/section', async ({ params, body, cookie }) => {
    try {
      // SECURITY: Require authentication for progress updates
      const auth = await getAuthFromCookie(cookie);
      if (!auth?.sub) {
        return { success: false, error: 'Unauthorized' };
      }
      
      const { sectionId } = body as { sectionId: string };
      const result = await lessonAnalyticsService.completeSection(params.progressId, sectionId);
      return result;
    } catch (error) {
      console.error('Error completing section:', error);
      return { success: false, error: 'Failed to complete section' };
    }
  })

  // Master vocabulary
  .post('/progress/:progressId/vocabulary', async ({ params, body, cookie }) => {
    try {
      // SECURITY: Require authentication for progress updates
      const auth = await getAuthFromCookie(cookie);
      if (!auth?.sub) {
        return { success: false, error: 'Unauthorized' };
      }
      
      const { vocabularyId } = body as { vocabularyId: string };
      const result = await lessonAnalyticsService.masterVocabulary(params.progressId, vocabularyId);
      return result;
    } catch (error) {
      console.error('Error mastering vocabulary:', error);
      return { success: false, error: 'Failed to master vocabulary' };
    }
  })

  // Complete exercise
  .post('/progress/:progressId/exercise', async ({ params, body, cookie }) => {
    try {
      // SECURITY: Require authentication for progress updates
      const auth = await getAuthFromCookie(cookie);
      if (!auth?.sub) {
        return { success: false, error: 'Unauthorized' };
      }
      
      const exerciseResult = body as {
        exerciseId: string;
        correct: boolean;
        answer: string;
        completedAt: string;
      };

      const result = await lessonAnalyticsService.completeExercise(params.progressId, exerciseResult);
      return result;
    } catch (error) {
      console.error('Error completing exercise:', error);
      return { success: false, error: 'Failed to complete exercise' };
    }
  })

  // Update scores
  .patch('/progress/:progressId/scores', async ({ params, body, cookie }) => {
    try {
      // SECURITY: Require authentication for score updates
      const auth = await getAuthFromCookie(cookie);
      if (!auth?.sub) {
        return { success: false, error: 'Unauthorized' };
      }
      
      const scores = body as {
        vocabularyScore?: number;
        grammarScore?: number;
        exerciseScore?: number;
      };

      const result = await lessonAnalyticsService.updateScores(params.progressId, scores);
      return result;
    } catch (error) {
      console.error('Error updating scores:', error);
      return { success: false, error: 'Failed to update scores' };
    }
  })

  // Complete lesson
  .post('/progress/:progressId/complete', async ({ params, cookie }) => {
    try {
      // SECURITY: Require authentication for lesson completion
      const auth = await getAuthFromCookie(cookie);
      if (!auth?.sub) {
        return { success: false, error: 'Unauthorized' };
      }
      
      const result = await lessonAnalyticsService.completeLesson(params.progressId);
      return result;
    } catch (error) {
      console.error('Error completing lesson:', error);
      return { success: false, error: 'Failed to complete lesson' };
    }
  })

  // Get user's all progress
  .get('/my-progress', async ({ cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }

      const progress = await lessonAnalyticsService.getUserProgress(auth.sub || '');
      return { success: true, progress };
    } catch (error) {
      console.error('Error getting user progress:', error);
      return { success: false, error: 'Failed to get progress' };
    }
  })

  // Get lessons due for review
  .get('/due-for-review', async ({ cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }

      const lessons = await lessonAnalyticsService.getLessonsDueForReview(auth.sub || '');
      return { success: true, lessons };
    } catch (error) {
      console.error('Error getting due lessons:', error);
      return { success: false, error: 'Failed to get due lessons' };
    }
  })

  // Get lesson stats
  .get('/:lessonId/stats', async ({ params }) => {
    try {
      const stats = await lessonAnalyticsService.getLessonStats(params.lessonId);
      return { success: true, stats };
    } catch (error) {
      console.error('Error getting stats:', error);
      return { success: false, error: 'Failed to get stats' };
    }
  })

  // Bookmark lesson
  .post('/:lessonId/bookmark', async ({ params, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }

      const result = await lessonAnalyticsService.bookmarkLesson(auth.sub || '', params.lessonId);
      return result;
    } catch (error) {
      console.error('Error bookmarking lesson:', error);
      return { success: false, error: 'Failed to bookmark lesson' };
    }
  })

  // Remove bookmark
  .delete('/:lessonId/bookmark', async ({ params, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }

      const result = await lessonAnalyticsService.removeBookmark(auth.sub || '', params.lessonId);
      return result;
    } catch (error) {
      console.error('Error removing bookmark:', error);
      return { success: false, error: 'Failed to remove bookmark' };
    }
  })

  // Get user's bookmarks
  .get('/my-bookmarks', async ({ cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: false, error: 'Unauthorized' };
      }

      const bookmarks = await lessonAnalyticsService.getUserBookmarks(auth.sub || '');
      return { success: true, bookmarks };
    } catch (error) {
      console.error('Error getting bookmarks:', error);
      return { success: false, error: 'Failed to get bookmarks' };
    }
  })

  // Check if bookmarked
  .get('/:lessonId/is-bookmarked', async ({ params, cookie }) => {
    try {
      const auth = await getAuthFromCookie(cookie);
      if (!auth) {
        return { success: true, bookmarked: false };
      }

      const bookmarked = await lessonAnalyticsService.isBookmarked(auth.sub || '', params.lessonId);
      return { success: true, bookmarked };
    } catch (error) {
      console.error('Error checking bookmark:', error);
      return { success: false, error: 'Failed to check bookmark' };
    }
  });
