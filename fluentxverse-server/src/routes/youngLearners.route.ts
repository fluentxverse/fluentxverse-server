/**
 * Young Learners API Routes
 * CRUD operations for Young Learners lesson materials
 */
import { Elysia, t } from 'elysia';
import { youngLearnersService, type CreateYoungLearnersInput, type UpdateYoungLearnersInput } from '../services/youngLearners.service';
import { createAdminGuard } from '../middleware/auth.middleware';

// Helper to get dashboard public URL
const getDashboardPublicUrl = (): string => {
  const explicit = process.env.ADMIN_DASHBOARD_PUBLIC_URL || process.env.DASHBOARD_PUBLIC_URL;
  if (explicit) return explicit;
  
  const port = process.env.DASHBOARD_PORT || '5175';
  return `http://localhost:${port}`;
};

export const youngLearnersRoute = new Elysia({ prefix: '/young-learners' })
  // ============================================================================
  // LIST ALL LESSONS (Admin)
  // ============================================================================
  .get(
    '/',
    async ({ cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized', lessons: [] };
      }
      
      try {
        const lessons = await youngLearnersService.listAll();
        return { success: true, lessons };
      } catch (error) {
        console.error('Error listing Young Learners lessons:', error);
        return { success: false, error: 'Failed to list lessons', lessons: [] };
      }
    },
    {
      detail: {
        tags: ['Young Learners'],
        summary: 'List all Young Learners lessons (admin)',
      },
    }
  )

  // ============================================================================
  // LIST PUBLISHED LESSONS (Public - for student/tutor apps)
  // ============================================================================
  .get(
    '/published',
    async () => {
      try {
        const lessons = await youngLearnersService.listPublished();
        return { success: true, lessons };
      } catch (error) {
        console.error('Error listing published Young Learners lessons:', error);
        return { success: false, error: 'Failed to list lessons', lessons: [] };
      }
    },
    {
      detail: {
        tags: ['Young Learners'],
        summary: 'List published Young Learners lessons (public)',
      },
    }
  )

  // ============================================================================
  // GET PUBLIC LESSON (for preview/student view)
  // IMPORTANT: Must be before /:id to avoid matching
  // ============================================================================
  .get(
    '/public/:id',
    async ({ params, set }) => {
      try {
        const lesson = await youngLearnersService.getById(params.id);
        if (!lesson) {
          set.status = 404;
          return { success: false, error: 'Lesson not found' };
        }
        
        // Only allow viewing published lessons publicly
        if (lesson.status !== 'published') {
          set.status = 403;
          return { success: false, error: 'Lesson is not published' };
        }
        
        return { success: true, lesson };
      } catch (error) {
        console.error('Error fetching public Young Learners lesson:', error);
        return { success: false, error: 'Failed to fetch lesson' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Young Learners'],
        summary: 'Get a published lesson by ID (public)',
      },
    }
  )

  // ============================================================================
  // GET VIEW URL (for student/tutor apps iframe)
  // IMPORTANT: Must be before /:id to avoid matching
  // ============================================================================
  .get(
    '/view/:id',
    async ({ params, set }) => {
      try {
        const lesson = await youngLearnersService.getById(params.id);
        if (!lesson) {
          set.status = 404;
          return { success: false, error: 'Lesson not found' };
        }
        
        // Only allow viewing published lessons publicly
        if (lesson.status !== 'published') {
          set.status = 403;
          return { success: false, error: 'Lesson is not published' };
        }
        
        const dashboardBase = getDashboardPublicUrl();
        const viewUrl = `${dashboardBase}/young-learners-preview/${lesson.id}`;
        
        return {
          success: true,
          lesson: {
            id: lesson.id,
            title: lesson.lessonTitle,
            status: lesson.status,
          },
          viewUrl,
        };
      } catch (error) {
        console.error('Error getting Young Learners view URL:', error);
        return { success: false, error: 'Failed to get view URL' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Young Learners'],
        summary: 'Get view URL for a lesson',
      },
    }
  )

  // ============================================================================
  // CHECK DUPLICATE (Admin)
  // ============================================================================
  .get(
    '/check-duplicate/:level/:unit/:lessonNumber',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const exists = await youngLearnersService.checkDuplicate(
          parseInt(params.level, 10),
          parseInt(params.unit, 10),
          parseInt(params.lessonNumber, 10)
        );
        return { success: true, exists };
      } catch (error) {
        console.error('Error checking duplicate:', error);
        return { success: false, error: 'Failed to check duplicate' };
      }
    },
    {
      params: t.Object({
        level: t.String(),
        unit: t.String(),
        lessonNumber: t.String(),
      }),
      detail: {
        tags: ['Young Learners'],
        summary: 'Check if lesson already exists at position',
      },
    }
  )

  // ============================================================================
  // GET EXISTING UNIT NAME (Admin)
  // ============================================================================
  .get(
    '/unit-name/:level/:unit',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const unitName = await youngLearnersService.getExistingUnitName(
          parseInt(params.level, 10),
          parseInt(params.unit, 10)
        );
        return { success: true, unitName };
      } catch (error) {
        console.error('Error getting unit name:', error);
        return { success: false, error: 'Failed to get unit name' };
      }
    },
    {
      params: t.Object({
        level: t.String(),
        unit: t.String(),
      }),
      detail: {
        tags: ['Young Learners'],
        summary: 'Get existing unit name for level/unit',
      },
    }
  )

  // ============================================================================
  // GET SINGLE LESSON (Admin)
  // ============================================================================
  .get(
    '/:id',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const lesson = await youngLearnersService.getById(params.id);
        if (!lesson) {
          set.status = 404;
          return { success: false, error: 'Lesson not found' };
        }
        return { success: true, lesson };
      } catch (error) {
        console.error('Error fetching Young Learners lesson:', error);
        return { success: false, error: 'Failed to fetch lesson' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Young Learners'],
        summary: 'Get a lesson by ID (admin)',
      },
    }
  )

  // ============================================================================
  // CREATE LESSON (Admin)
  // ============================================================================
  .post(
    '/',
    async ({ body, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const adminName = adminPayload.firstName || adminPayload.givenName || adminPayload.email || 'Admin';
        const input = {
          ...body,
          createdBy: adminPayload.userId,
          createdByName: adminName,
        } as CreateYoungLearnersInput;
        
        const lesson = await youngLearnersService.create(input);
        return { success: true, lesson };
      } catch (error) {
        console.error('Error creating Young Learners lesson:', error);
        return { success: false, error: 'Failed to create lesson' };
      }
    },
    {
      body: t.Object({
        level: t.Number(),
        unit: t.Number(),
        lessonNumber: t.Number(),
        theme: t.String(),
        ageGroup: t.String(),
        unitName: t.String(),
        lessonName: t.String(),
        mascot: t.String(),
      }),
      detail: {
        tags: ['Young Learners'],
        summary: 'Create a new lesson',
      },
    }
  )

  // ============================================================================
  // UPDATE LESSON (Admin)
  // ============================================================================
  .patch(
    '/:id',
    async ({ params, body, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const lesson = await youngLearnersService.update(params.id, body as UpdateYoungLearnersInput);
        if (!lesson) {
          set.status = 404;
          return { success: false, error: 'Lesson not found' };
        }
        return { success: true, lesson };
      } catch (error) {
        console.error('Error updating Young Learners lesson:', error);
        return { success: false, error: 'Failed to update lesson' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Young Learners'],
        summary: 'Update a lesson',
      },
    }
  )

  // ============================================================================
  // PUBLISH LESSON (Admin)
  // ============================================================================
  .post(
    '/:id/publish',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const lesson = await youngLearnersService.publish(params.id);
        if (!lesson) {
          set.status = 404;
          return { success: false, error: 'Lesson not found' };
        }
        return { success: true, lesson };
      } catch (error) {
        console.error('Error publishing Young Learners lesson:', error);
        return { success: false, error: 'Failed to publish lesson' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Young Learners'],
        summary: 'Publish a lesson',
      },
    }
  )

  // ============================================================================
  // UNPUBLISH LESSON (Admin)
  // ============================================================================
  .post(
    '/:id/unpublish',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const lesson = await youngLearnersService.unpublish(params.id);
        if (!lesson) {
          set.status = 404;
          return { success: false, error: 'Lesson not found' };
        }
        return { success: true, lesson };
      } catch (error) {
        console.error('Error unpublishing Young Learners lesson:', error);
        return { success: false, error: 'Failed to unpublish lesson' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Young Learners'],
        summary: 'Unpublish a lesson',
      },
    }
  )

  // ============================================================================
  // DUPLICATE LESSON (Admin)
  // ============================================================================
  .post(
    '/:id/duplicate',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const adminName = adminPayload.firstName || adminPayload.givenName || adminPayload.email || 'Admin';
        const lesson = await youngLearnersService.duplicate(
          params.id,
          adminPayload.userId,
          adminName
        );
        if (!lesson) {
          set.status = 404;
          return { success: false, error: 'Original lesson not found' };
        }
        return { success: true, lesson };
      } catch (error) {
        console.error('Error duplicating Young Learners lesson:', error);
        return { success: false, error: 'Failed to duplicate lesson' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Young Learners'],
        summary: 'Duplicate a lesson',
      },
    }
  )

  // ============================================================================
  // DELETE LESSON (Admin)
  // ============================================================================
  .delete(
    '/:id',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const deleted = await youngLearnersService.delete(params.id);
        if (!deleted) {
          set.status = 404;
          return { success: false, error: 'Lesson not found' };
        }
        return { success: true };
      } catch (error) {
        console.error('Error deleting Young Learners lesson:', error);
        return { success: false, error: 'Failed to delete lesson' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Young Learners'],
        summary: 'Delete a lesson',
      },
    }
  );
