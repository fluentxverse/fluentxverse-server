/**
 * Lesson Material Routes
 * API endpoints for managing lesson materials (Memgraph)
 */
import { Elysia, t } from 'elysia';
import { lessonMaterialService, type Skill } from '../services/lessonMaterial.service';
import { createAdminGuard, createStudentGuard, createTutorGuard } from '../middleware/auth.middleware';
import { addAvailableCheckpoints, checkpointIdPattern, checkpointLessonService, studentCheckpointLesson } from '../services/checkpointLesson.service';
import { ScheduleService } from '../services/schedule.services/schedule.service';

const scheduleService = new ScheduleService();

// Helper to get dashboard public URL
const getDashboardPublicUrl = (): string => {
  const explicit = process.env.ADMIN_DASHBOARD_PUBLIC_URL || process.env.DASHBOARD_PUBLIC_URL;
  if (explicit) return explicit;

  const raw = process.env.FRONTEND_URLS || process.env.FRONTEND_URL || '';
  const origins = raw
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  const preferred = origins.find(o => /dashboard|admin/i.test(o)) || origins[0];
  return preferred || 'http://localhost:5175';
};

export const lessonMaterialRoutes = new Elysia({ prefix: '/lesson-materials' })
  
  // ============================================================================
  // CREATE LESSON
  // ============================================================================
  .post(
    '/',
    async ({ body, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const lesson = await lessonMaterialService.create({
          course: body.course,
          level: body.level,
          chapter: body.chapter,
          lessonNumber: body.lessonNumber,
          skill: body.skill as Skill,
          chapterName: body.chapterName,
          lessonName: body.lessonName,
          goalTextEn: body.goalTextEn,
          goalTextJp: body.goalTextJp,
          createdBy: adminPayload.userId,
          createdByName: adminPayload.firstName || adminPayload.email,
        });
        
        return { success: true, lesson };
      } catch (error: any) {
        console.error('Error creating lesson:', error);
        set.status = 400;
        return { success: false, error: error?.message || 'Failed to create lesson' };
      }
    },
    {
      body: t.Object({
        course: t.String(),
        level: t.Number({ minimum: 1, maximum: 10 }),
        chapter: t.Number({ minimum: 1, maximum: 5 }),
        lessonNumber: t.Number({ minimum: 1, maximum: 10 }),
        skill: t.Union([t.Literal('speaking'), t.Literal('listening'), t.Literal('reading'), t.Literal('review')]),
        chapterName: t.Optional(t.String()),
        lessonName: t.String({ minLength: 1 }),
        goalTextEn: t.String(),
        goalTextJp: t.String(),
      }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Create a new lesson material',
      },
    }
  )

  // ============================================================================
  // GET PUBLISHED LESSONS (for student/tutor apps)
  // IMPORTANT: This route MUST be before /:id to avoid being matched by /:id
  // ============================================================================
  .get(
    '/published/:course',
    async ({ params }) => {
      try {
        const stored = await lessonMaterialService.listPublishedByCourse(params.course);
        const lessons = params.course === 'conversational-skills' ? addAvailableCheckpoints(stored) : stored;
        return { success: true, lessons };
      } catch (error) {
        console.error('Error fetching published lessons:', error);
        return { success: false, error: 'Failed to fetch published lessons', lessons: [] };
      }
    },
    {
      params: t.Object({
        course: t.String(),
      }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Get all published lessons for a course',
      },
    }
  )

  .get(
    '/checkpoint/:id',
    async ({ params, query, cookie, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      if (!checkpointIdPattern.test(params.id)) {
        set.status = 400;
        return { success: false, error: 'Invalid checkpoint lesson' };
      }
      try {
        let studentId: string;
        const isTutor = Boolean(cookie.tutorAuth?.value);
        if (isTutor) {
          const tutor = await createTutorGuard(cookie, set);
          if (!tutor) return { success: false, error: 'Unauthorized' };
          if (!query.sessionId) {
            set.status = 400;
            return { success: false, error: 'Open this checkpoint from an active class session' };
          }
          const details = await scheduleService.getTutorLessonDetails(query.sessionId, tutor.userId);
          if (!details.studentId) {
            set.status = 404;
            return { success: false, error: 'No student is assigned to this session' };
          }
          studentId = details.studentId;
        } else {
          const student = await createStudentGuard(cookie, set);
          if (!student) return { success: false, error: 'Unauthorized' };
          studentId = student.userId;
        }
        const lesson = await checkpointLessonService.getOrCreate(studentId, params.id);
        return { success: true, lesson: isTutor ? lesson : studentCheckpointLesson(lesson) };
      } catch (error: any) {
        console.error('Error loading checkpoint lesson:', error);
        set.status = error?.message?.includes('do not have access') ? 403 : 500;
        return { success: false, error: error?.message || 'Failed to load checkpoint lesson' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({ sessionId: t.Optional(t.String()) }),
      detail: { tags: ['Lesson Materials'], summary: 'Get a persisted student checkpoint lesson' },
    },
  )
  
  // ============================================================================
  // GET LESSON VIEW URL (public - for student/tutor apps)
  // Returns the dashboard preview URL for viewing a lesson material
  // IMPORTANT: This route MUST be before /:id to avoid being matched by /:id
  // ============================================================================
  .get(
    '/view/:id',
    async ({ params, set }) => {
      try {
        const lesson = await lessonMaterialService.getById(params.id);
        if (!lesson) {
          set.status = 404;
          return { success: false, error: 'Lesson not found' };
        }
        
        // Only allow viewing published lessons publicly
        if (lesson.status !== 'published') {
          set.status = 403;
          return { success: false, error: 'Lesson is not published' };
        }
        
        // Get dashboard URL
        const dashboardBase = getDashboardPublicUrl();
        const previewPath = lesson.course === 'business-english'
          ? 'business-english-preview'
          : 'conversational-skills-preview';
        const viewUrl = `${dashboardBase}/${previewPath}/${lesson.id}`;
        
        return { 
          success: true, 
          lesson: {
            id: lesson.id,
            title: lesson.lessonTitle || `Lesson ${lesson.lessonNumber}: ${lesson.lessonName}`,
            status: lesson.status
          },
          viewUrl 
        };
      } catch (error) {
        console.error('Error getting lesson view URL:', error);
        return { success: false, error: 'Failed to get lesson view URL' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Get the view URL for a published lesson',
      },
    }
  )
  
  // ============================================================================
  // GET PUBLISHED LESSON DATA (public - for preview page)
  // Returns full lesson data for published lessons only
  // IMPORTANT: This route MUST be before /:id to avoid being matched by /:id
  // ============================================================================
  .get(
    '/public/:id',
    async ({ params, set }) => {
      try {
        const lesson = await lessonMaterialService.getById(params.id);
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
        console.error('Error fetching public lesson:', error);
        return { success: false, error: 'Failed to fetch lesson' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Get a published lesson by ID (public)',
      },
    }
  )
  
  // ============================================================================
  // GET SINGLE LESSON
  // ============================================================================
  .get(
    '/:id',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const lesson = await lessonMaterialService.getById(params.id);
        if (!lesson) {
          set.status = 404;
          return { success: false, error: 'Lesson not found' };
        }
        
        return { success: true, lesson };
      } catch (error) {
        console.error('Error fetching lesson:', error);
        return { success: false, error: 'Failed to fetch lesson' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Get a lesson by ID',
      },
    }
  )
  
  // ============================================================================
  // LIST LESSONS BY COURSE
  // ============================================================================
  .get(
    '/course/:course',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const lessons = await lessonMaterialService.listByCourse(params.course);
        return { success: true, lessons };
      } catch (error) {
        console.error('Error listing lessons:', error);
        return { success: false, error: 'Failed to list lessons' };
      }
    },
    {
      params: t.Object({
        course: t.String(),
      }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'List all lessons for a course',
      },
    }
  )
  
  // ============================================================================
  // GET EXISTING CHAPTERS (for auto-fill)
  // ============================================================================
  .get(
    '/chapters/:course/:level',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const chapters = await lessonMaterialService.getChapters(params.course, parseInt(params.level));
        return { success: true, chapters };
      } catch (error) {
        console.error('Error fetching chapters:', error);
        return { success: false, error: 'Failed to fetch chapters' };
      }
    },
    {
      params: t.Object({
        course: t.String(),
        level: t.String(),
      }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Get existing chapters for a course/level (for dropdown auto-fill)',
      },
    }
  )
  
  // ============================================================================
  // CHECK IF CHAPTER NAME EXISTS
  // ============================================================================
  .get(
    '/chapter-name/:course/:level/:chapter',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const chapterName = await lessonMaterialService.getExistingChapterName(
          params.course,
          parseInt(params.level),
          parseInt(params.chapter)
        );
        
        return { success: true, chapterName };
      } catch (error) {
        console.error('Error fetching chapter name:', error);
        return { success: false, error: 'Failed to fetch chapter name' };
      }
    },
    {
      params: t.Object({
        course: t.String(),
        level: t.String(),
        chapter: t.String(),
      }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Get existing chapter name if any',
      },
    }
  )
  
  // ============================================================================
  // CHECK FOR DUPLICATE
  // ============================================================================
  .get(
    '/check-duplicate',
    async ({ query, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const exists = await lessonMaterialService.checkDuplicate(
          query.course as string,
          parseInt(query.level as string),
          parseInt(query.chapter as string),
          parseInt(query.lessonNumber as string),
          query.skill as Skill
        );
        
        return { success: true, exists };
      } catch (error) {
        console.error('Error checking duplicate:', error);
        return { success: false, error: 'Failed to check duplicate' };
      }
    },
    {
      query: t.Object({
        course: t.String(),
        level: t.String(),
        chapter: t.String(),
        lessonNumber: t.String(),
        skill: t.String(),
      }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Check if a lesson combination already exists',
      },
    }
  )
  
  // ============================================================================
  // UPDATE HEADER STYLING
  // ============================================================================
  .patch(
    '/:id/header',
    async ({ params, body, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const lesson = await lessonMaterialService.updateHeader(params.id, {
          backgroundImage: body.backgroundImage,
          overlayColor: body.overlayColor,
          chapterName: body.chapterName,
          lessonName: body.lessonName,
          goalTextEn: body.goalTextEn,
          goalTextJp: body.goalTextJp,
          introductionData: body.introductionData,
          learnData: body.learnData,
          stepBData: body.stepBData,
          applyData: body.applyData,
          exerciseData: body.exerciseData,
          storyData: body.storyData,
          missionData: body.missionData,
          missionData2: body.missionData2,
          feedbackData: body.feedbackData,
          beData: body.beData,
        });
        
        if (!lesson) {
          set.status = 404;
          return { success: false, error: 'Lesson not found' };
        }
        
        return { success: true, lesson };
      } catch (error) {
        console.error('Error updating header:', error);
        return { success: false, error: 'Failed to update header' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        backgroundImage: t.Optional(t.String()),
        overlayColor: t.Optional(t.String()),
        chapterName: t.Optional(t.String()),
        lessonName: t.Optional(t.String()),
        goalTextEn: t.Optional(t.String()),
        goalTextJp: t.Optional(t.String()),
        introductionData: t.Optional(t.Any()),
        learnData: t.Optional(t.Any()),
        stepBData: t.Optional(t.Any()),
        applyData: t.Optional(t.Any()),
        exerciseData: t.Optional(t.Any()),
        storyData: t.Optional(t.Any()),
        missionData: t.Optional(t.Any()),
        missionData2: t.Optional(t.Any()),
        feedbackData: t.Optional(t.Any()),
        discussionQuestionsData: t.Optional(t.Any()),
        beData: t.Optional(t.Any()),
      }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Update lesson header styling and content',
      },
    }
  )
  
  // ============================================================================
  // DELETE LESSON
  // ============================================================================
  .delete(
    '/:id',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const success = await lessonMaterialService.delete(params.id);
        if (!success) {
          set.status = 404;
          return { success: false, error: 'Lesson not found or already deleted' };
        }
        
        return { success: true };
      } catch (error) {
        console.error('Error deleting lesson:', error);
        return { success: false, error: 'Failed to delete lesson' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Delete a lesson',
      },
    }
  )
  
  // ============================================================================
  // DUPLICATE LESSON
  // ============================================================================
  .post(
    '/:id/duplicate',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const lesson = await lessonMaterialService.duplicate(
          params.id,
          adminPayload.userId,
          adminPayload.firstName || adminPayload.email
        );
        
        if (!lesson) {
          set.status = 404;
          return { success: false, error: 'Original lesson not found' };
        }
        
        return { success: true, lesson };
      } catch (error: any) {
        console.error('Error duplicating lesson:', error);
        return { success: false, error: error.message || 'Failed to duplicate lesson' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Duplicate an existing lesson',
      },
    }
  )

  // ============================================================================
  // PUBLISH LESSON
  // ============================================================================
  .post(
    '/:id/publish',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const lesson = await lessonMaterialService.publish(params.id);
        
        if (!lesson) {
          set.status = 404;
          return { success: false, error: 'Lesson not found' };
        }
        
        return { success: true, lesson, message: 'Lesson published successfully' };
      } catch (error: any) {
        console.error('Error publishing lesson:', error);
        return { success: false, error: error.message || 'Failed to publish lesson' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Publish a lesson',
      },
    }
  )

  // ============================================================================
  // UNPUBLISH LESSON
  // ============================================================================
  .post(
    '/:id/unpublish',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const lesson = await lessonMaterialService.unpublish(params.id);
        
        if (!lesson) {
          set.status = 404;
          return { success: false, error: 'Lesson not found' };
        }
        
        return { success: true, lesson, message: 'Lesson unpublished successfully' };
      } catch (error: any) {
        console.error('Error unpublishing lesson:', error);
        return { success: false, error: error.message || 'Failed to unpublish lesson' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Unpublish a lesson (set back to draft)',
      },
    }
  )

  // ============================================================================
  // COURSE METADATA  (Level topics + Chapter themes/names)
  // ============================================================================

  // GET all metadata for a course
  .get(
    '/metadata/:course',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }

      try {
        const metadata = await lessonMaterialService.getCourseMetadata(params.course);
        return { success: true, ...metadata };
      } catch (error) {
        console.error('Error fetching course metadata:', error);
        return { success: false, error: 'Failed to fetch course metadata' };
      }
    },
    {
      params: t.Object({ course: t.String() }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Get all metadata (level topics + chapter themes/names) for a course',
      },
    }
  )

  // SAVE level main-topic
  .put(
    '/metadata/:course/level/:level',
    async ({ params, body, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }

      try {
        await lessonMaterialService.saveLevelTopic(params.course, parseInt(params.level), body.mainTopic);
        return { success: true };
      } catch (error) {
        console.error('Error saving level topic:', error);
        return { success: false, error: 'Failed to save level topic' };
      }
    },
    {
      params: t.Object({ course: t.String(), level: t.String() }),
      body: t.Object({ mainTopic: t.String() }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Save the main topic for a level',
      },
    }
  )

  // SAVE chapter theme + name
  .put(
    '/metadata/:course/chapter/:level/:chapter',
    async ({ params, body, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }

      try {
        await lessonMaterialService.saveChapterMeta(
          params.course,
          parseInt(params.level),
          parseInt(params.chapter),
          { theme: body.theme, name: body.name }
        );
        return { success: true };
      } catch (error) {
        console.error('Error saving chapter metadata:', error);
        return { success: false, error: 'Failed to save chapter metadata' };
      }
    },
    {
      params: t.Object({ course: t.String(), level: t.String(), chapter: t.String() }),
      body: t.Object({
        theme: t.Optional(t.String()),
        name: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Save theme and/or name for a chapter',
      },
    }
  )

  // ============================================================================
  // LEVEL ADMIN ASSIGNMENT
  // ============================================================================

  // ASSIGN admin to a level
  .put(
    '/metadata/:course/level/:level/assign',
    async ({ params, body, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }

      // Only superadmins can assign levels
      if (adminPayload.role !== 'superadmin') {
        set.status = 403;
        return { success: false, error: 'Only superadmins can assign levels' };
      }

      try {
        await lessonMaterialService.assignLevelAdmin(
          params.course,
          parseInt(params.level),
          body.adminId,
          body.adminName
        );
        return { success: true };
      } catch (error) {
        console.error('Error assigning level admin:', error);
        return { success: false, error: 'Failed to assign level admin' };
      }
    },
    {
      params: t.Object({ course: t.String(), level: t.String() }),
      body: t.Object({
        adminId: t.String(),
        adminName: t.String(),
      }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Assign an admin to a level (superadmin only)',
      },
    }
  )

  // UNASSIGN admin from a level
  .delete(
    '/metadata/:course/level/:level/assign',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }

      if (adminPayload.role !== 'superadmin') {
        set.status = 403;
        return { success: false, error: 'Only superadmins can unassign levels' };
      }

      try {
        await lessonMaterialService.unassignLevelAdmin(params.course, parseInt(params.level));
        return { success: true };
      } catch (error) {
        console.error('Error unassigning level admin:', error);
        return { success: false, error: 'Failed to unassign level admin' };
      }
    },
    {
      params: t.Object({ course: t.String(), level: t.String() }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Unassign admin from a level (superadmin only)',
      },
    }
  )

  // GET level assignments for a course
  .get(
    '/metadata/:course/assignments',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }

      try {
        const assignments = await lessonMaterialService.getLevelAssignments(params.course);
        return { success: true, assignments };
      } catch (error) {
        console.error('Error fetching level assignments:', error);
        return { success: false, error: 'Failed to fetch level assignments' };
      }
    },
    {
      params: t.Object({ course: t.String() }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Get all level admin assignments for a course',
      },
    }
  )

  // BATCH SAVE course structure (level topic + all chapter themes/names)
  .put(
    '/metadata/:course/level/:level/structure',
    async ({ params, body, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }

      try {
        await lessonMaterialService.saveCourseStructure(
          params.course,
          parseInt(params.level),
          {
            mainTopic: body.mainTopic,
            chapters: body.chapters,
          }
        );
        return { success: true };
      } catch (error) {
        console.error('Error saving course structure:', error);
        return { success: false, error: 'Failed to save course structure' };
      }
    },
    {
      params: t.Object({ course: t.String(), level: t.String() }),
      body: t.Object({
        mainTopic: t.String(),
        chapters: t.Array(t.Object({
          chapter: t.Number(),
          theme: t.String(),
          name: t.String(),
        })),
      }),
      detail: {
        tags: ['Lesson Materials'],
        summary: 'Batch-save AI-generated course structure for a level',
      },
    }
  );
