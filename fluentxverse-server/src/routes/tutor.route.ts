import Elysia, { t } from 'elysia';
import { TutorService } from '../services/tutor.services/tutor.service';
import StudentService from '../services/auth.services/student.service';
import { ScheduleService } from '../services/schedule.services/schedule.service';
import { ClassroomNotesService, InvalidMaterialProgress } from '../services/classroomNotes.services/classroomNotes.service';
import { LessonNotesReadOnly } from '../utils/lessonNotesEditWindow';
import { LessonFeedbackInvalid } from '../utils/lessonFeedbackValidation';
import { ClassroomExerciseMarksService } from '../services/classroomExerciseMarks.services/classroomExerciseMarks.service';
import type { AuthData } from '@/services/auth.services/auth.interface';
import { MAX_PROFILE_PIC_BYTES } from '../config/constant';
import { verifyAuthToken, refreshJwtCookie, type JwtAuthPayload } from '../utils/jwt';
import { cacheGetOrSet, invalidateCache } from '../db/redis';
import { tutorPerformanceService } from '../services/tutorPerformance.service';
import { tutorLessonIssuesService } from '../services/tutorLessonIssues.service';

const tutorService = new TutorService();
const scheduleService = new ScheduleService();
const classroomNotesService = new ClassroomNotesService();
const classroomExerciseMarksService = new ClassroomExerciseMarksService();

const Tutor = new Elysia({ prefix: '/tutor' })
  .get('/lesson-issues', async ({ cookie, query, set }) => {
    set.headers['Cache-Control'] = 'no-store';
    const raw = cookie.tutorAuth?.value;
    const auth = raw ? await verifyAuthToken(String(raw)) : null;
    if (!auth || auth.role !== 'tutor') { set.status = 401; return { success: false, error: 'Not authenticated' }; }
    try {
      const data = await tutorLessonIssuesService.list(auth.userId, query.period, query.month, query.direction, query.status, query.page ? Number(query.page) : 1);
      await refreshJwtCookie(cookie, auth, 'tutorAuth');
      return { success: true, data };
    } catch (error) {
      if (error instanceof Error && /^(Invalid (metrics|issue)|Choose a valid)/.test(error.message)) {
        set.status = 400; return { success: false, error: error.message };
      }
      console.error('Failed to load tutor lesson issues:', error);
      set.status = 500; return { success: false, error: 'Could not load lesson issues' };
    }
  }, { query: t.Object({ period: t.Optional(t.String()), month: t.Optional(t.String()), direction: t.Optional(t.String()), status: t.Optional(t.String()), page: t.Optional(t.String()) }) })
  .get('/performance', async ({ cookie, query, set }) => {
    const raw = cookie.tutorAuth?.value;
    const auth = raw ? await verifyAuthToken(String(raw)) : null;
    if (!auth || auth.role !== 'tutor') { set.status = 401; return { success: false, error: 'Not authenticated' }; }
    set.headers['Cache-Control'] = 'no-store';
    await refreshJwtCookie(cookie, auth, 'tutorAuth');
    try {
      return { success: true, data: await tutorPerformanceService.get(auth.userId, query.period, query.month, query.page ? Number(query.page) : 1) };
    } catch (error) {
      if (error instanceof Error && /^(Invalid metrics|Choose a valid)/.test(error.message)) {
        set.status = 400; return { success: false, error: error.message };
      }
      console.error('Failed to load tutor performance:', error);
      set.status = 500; return { success: false, error: 'Could not load performance metrics' };
    }
  }, { query: t.Object({ period: t.Optional(t.String()), month: t.Optional(t.String()), page: t.Optional(t.String()) }) })
  /**
   * Search and filter tutors
   * GET /tutor/search
   * Cached for 2 minutes to reduce database load for common searches
   */
  .get('/search', async ({ query }) => {
    try {
      const params = {
        query: query.q || undefined, // Search by name
        page: query.page ? Number(query.page) : 1,
        limit: query.limit ? Number(query.limit) : 12,
        dateFilter: query.dateFilter || undefined,
        startTime: query.startTime || undefined,
        endTime: query.endTime || undefined
      };

      // Create cache key from search params
      const cacheKey = `tutor:search:${JSON.stringify(params)}`;
      
      // Cache search results for 2 minutes (120 seconds)
      const result = await cacheGetOrSet(cacheKey, 120, () => 
        tutorService.searchTutors(params)
      );

      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('Error in /tutor/search:', error);
      return {
        success: false,
        error: 'Failed to search tutors'
      };
    }
  })

  /**
   * Upload tutor intro video (multipart/form-data)
   * Field name: file
   */
  .post('/intro-video', async ({ request, cookie }) => {
    try {
      const raw = cookie.tutorAuth?.value;
      if (!raw) return { success: false, error: 'Not authenticated' };
      const payload = await verifyAuthToken(String(raw));
      if (!payload) return { success: false, error: 'Invalid or expired token' };
      const userId = payload.userId;

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return { success: false, error: 'Missing file' };
      }

      // Max 100MB for video
      const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
      if (file.size > MAX_VIDEO_BYTES) {
        return { success: false, error: `File too large. Max 100MB` };
      }

      // Validate video type
      if (!file.type.startsWith('video/')) {
        return { success: false, error: 'File must be a video' };
      }

      // Build Seaweed Filer path: /user/{userId}/video/{timestamp}_{originalName}
      const timestamp = Date.now();
      const safeName = file.name?.replace(/[^a-zA-Z0-9._-]/g, '_') || 'intro.mp4';
      const filerPath = `/user/${userId}/video/${timestamp}_${safeName}`;
      const filerBase = process.env.SEAWEED_FILER_URL || 'http://localhost:8888';
      const uploadUrl = `${filerBase}${filerPath}`;

      // Check if profile is approved - if so, we keep the old video (new one goes to pending)
      const profileStatus = await tutorService.getProfileStatus(userId);
      const isApproved = profileStatus === 'approved';

      // Only delete previous video if profile is NOT approved (direct update)
      if (!isApproved) {
        const previousVideo = await tutorService.getVideoIntroUrl(userId);
        if (previousVideo) {
          try {
            await fetch(previousVideo, { method: 'DELETE' });
          } catch (e) {
            console.warn('Failed to delete previous intro video:', e);
          }
        }
      }

      // Upload new file to Seaweed Filer
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: file.stream(),
        headers: {
          'Content-Type': file.type || 'video/mp4'
        }
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { success: false, error: `Upload failed: ${res.status} ${text}` };
      }

      // Save video URL to database
      const result = await tutorService.updateProfile(userId, { videoIntroUrl: uploadUrl });

      return { 
        success: true, 
        url: uploadUrl,
        hasPendingChanges: result.hasPendingChanges,
        message: result.hasPendingChanges 
          ? 'Video uploaded and submitted for review. Your current video will remain visible until approved.'
          : undefined
      };
    } catch (error) {
      console.error('Error in /tutor/intro-video:', error);
      return { success: false, error: 'Failed to upload intro video' };
    }
  }, { parse: 'none' })

  /**
   * Delete tutor intro video
   */
  .delete('/intro-video', async ({ cookie }) => {
    try {
      const raw = cookie.tutorAuth?.value;
      if (!raw) return { success: false, error: 'Not authenticated' };
      const payload = await verifyAuthToken(String(raw));
      if (!payload) return { success: false, error: 'Invalid or expired token' };
      const userId = payload.userId;

      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      // Delete from storage
      const previousVideo = await tutorService.getVideoIntroUrl(userId);
      if (previousVideo) {
        try {
          await fetch(previousVideo, { method: 'DELETE' });
        } catch (e) {
          console.warn('Failed to delete intro video:', e);
        }
      }

      // Clear from database
      await tutorService.updateProfile(userId, { videoIntroUrl: null });

      return { success: true };
    } catch (error) {
      console.error('Error in DELETE /tutor/intro-video:', error);
      return { success: false, error: 'Failed to delete intro video' };
    }
  })

  /**
   * Upload tutor profile picture (multipart/form-data)
   * Field name: file
   */
  .post('/profile-picture', async ({ request, cookie }) => {
    try {
      const raw = cookie.tutorAuth?.value;
      if (!raw) return { success: false, error: 'Not authenticated' };
      const payload = await verifyAuthToken(String(raw));
      if (!payload) return { success: false, error: 'Invalid or expired token' };
      const userId = payload.userId;

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return { success: false, error: 'Missing file' };
      }

      if (file.size > MAX_PROFILE_PIC_BYTES) {
        return { success: false, error: `File too large. Max ${(MAX_PROFILE_PIC_BYTES / (1024*1024)).toFixed(1)}MB` };
      }

      // Build Seaweed Filer path: /user/{userId}/profile/{timestamp}_{originalName}
      const timestamp = Date.now();
      const safeName = file.name?.replace(/[^a-zA-Z0-9._-]/g, '_') || 'profile.jpg';
      const filerPath = `/user/${userId}/profile/${timestamp}_${safeName}`;
      const filerBase = process.env.SEAWEED_FILER_URL || 'http://localhost:8888';
      const uploadUrl = `${filerBase}${filerPath}`;

      // Check if profile is approved - if so, we keep the old picture (new one goes to pending)
      const profileStatus = await tutorService.getProfileStatus(userId);
      const isApproved = profileStatus === 'approved';
      
      // Only delete previous file if profile is NOT approved (direct update)
      if (!isApproved) {
        const previous = await tutorService.getCurrentProfilePicture(userId);
        if (previous) {
          try {
            await fetch(previous, { method: 'DELETE' });
          } catch (e) {
            console.warn('Failed to delete previous profile picture:', e);
          }
        }
      }

      // Upload new file to Seaweed Filer
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: file.stream(),
        headers: {
          'Content-Type': file.type || 'application/octet-stream'
        }
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { success: false, error: `Upload failed: ${res.status} ${text}` };
      }

      const result = await tutorService.setProfilePicture(userId, uploadUrl);

      return { 
        success: true, 
        url: uploadUrl,
        hasPendingChanges: result.hasPendingChanges,
        message: result.hasPendingChanges 
          ? 'Photo uploaded and submitted for review. Your current photo will remain visible until approved.'
          : undefined
      };
    } catch (error) {
      console.error('Error in /tutor/profile-picture:', error);
      return { success: false, error: 'Failed to upload profile picture' };
    }
  }, { parse: 'none' })

  /**
   * Get current tutor's own profile data (bio, introduction, etc.)
   * GET /tutor/profile
   */
  .get('/profile', async ({ cookie, set }) => {
    set.headers['Cache-Control'] = 'private, no-store';
    try {
      const raw = cookie.tutorAuth?.value;
      if (!raw) return { success: false, error: 'Not authenticated' };
      const payload = await verifyAuthToken(String(raw));
      if (!payload) return { success: false, error: 'Invalid or expired token' };
      const userId = payload.userId;

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      const started = performance.now();
      const tutor = await tutorService.getTutorProfile(userId);
      set.headers['Server-Timing'] = `profile;dur=${(performance.now() - started).toFixed(1)}`;
      
      if (!tutor) {
        return { success: false, error: 'Tutor profile not found' };
      }

      return { success: true, data: tutor };
    } catch (error) {
      console.error('Error in GET /tutor/profile:', error);
      return { success: false, error: 'Failed to get profile' };
    }
  })

  /**
   * Update tutor profile fields (bio, introduction, etc.)
   * PATCH /tutor/profile
   */
  .patch('/profile', async ({ body, cookie }) => {
    try {
      const raw = cookie.tutorAuth?.value;
      if (!raw) return { success: false, error: 'Not authenticated' };
      const payload = await verifyAuthToken(String(raw));
      if (!payload) return { success: false, error: 'Invalid or expired token' };
      const userId = payload.userId;

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      const updateData = body as Record<string, any>;
      
      // Only allow updating specific fields
      const allowedFields = ['bio', 'introduction', 'teachingStyle', 'hourlyRate', 'videoIntroUrl', 'interests'];
      const filteredData: Record<string, any> = {};
      
      for (const key of allowedFields) {
        if (updateData[key] !== undefined) {
          // Handle interests array - ensure it's an array with max 5 items, stored as JSON string
          if (key === 'interests') {
            let interests = updateData[key];
            if (typeof interests === 'string') {
              interests = interests.split(',').map((i: string) => i.trim()).filter((i: string) => i.length > 0);
            }
            if (Array.isArray(interests)) {
              filteredData[key] = JSON.stringify(interests.slice(0, 5)); // Store as JSON string like other arrays
            }
          } else {
            filteredData[key] = updateData[key];
          }
        }
      }

      if (Object.keys(filteredData).length === 0) {
        return { success: false, error: 'No valid fields to update' };
      }

      const result = await tutorService.updateProfile(userId, filteredData);

      // Invalidate tutor profile cache after update
      await invalidateCache(`tutor:profile:${userId}`);

      return { 
        success: true, 
        data: filteredData,
        hasPendingChanges: result.hasPendingChanges,
        message: result.hasPendingChanges 
          ? 'Changes submitted for review. Your current profile will remain visible until approved.'
          : 'Profile updated successfully.'
      };
    } catch (error) {
      console.error('Error in PATCH /tutor/profile:', error);
      return { success: false, error: 'Failed to update profile' };
    }
  })

  /**
   * Submit profile for admin review
   * POST /tutor/profile/submit
   * Called when tutor completes their profile and wants admin to review
   */
  .post('/profile/submit', async ({ cookie }) => {
    try {
      const raw = cookie.tutorAuth?.value;
      if (!raw) return { success: false, error: 'Not authenticated' };
      const payload = await verifyAuthToken(String(raw));
      if (!payload) return { success: false, error: 'Invalid or expired token' };
      const userId = payload.userId;

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      // Check profile completeness
      const profile = await tutorService.getTutorProfile(userId);
      if (!profile) {
        return { success: false, error: 'Profile not found' };
      }

      // Validate required fields
      const missingFields: string[] = [];
      if (!profile.bio || profile.bio.length < 10) missingFields.push('Bio');
      if (!profile.profilePicture) missingFields.push('Profile Picture');
      if (!profile.videoIntroUrl) missingFields.push('Introduction Video');
      if (!profile.schoolAttended && (!profile.education || profile.education.length === 0)) missingFields.push('Education');
      if (!profile.interests || profile.interests.length === 0) missingFields.push('Interests');

      if (missingFields.length > 0) {
        return { 
          success: false, 
          error: `Please complete the following before submitting: ${missingFields.join(', ')}` 
        };
      }

      // Mark profile as submitted for review
      await tutorService.submitProfileForReview(userId);

      return { success: true, message: 'Profile submitted for review' };
    } catch (error) {
      console.error('Error in POST /tutor/profile/submit:', error);
      return { success: false, error: 'Failed to submit profile for review' };
    }
  })

  /**
   * Get tutor profile by ID
   * GET /tutor/:tutorId
   * Cached for 5 minutes to reduce DB calls for popular tutors
   * IMPORTANT: This must be last because it's a catch-all route
   */
  .get('/:tutorId', async ({ params }) => {
    try {
      const { tutorId } = params;
      
      if (!tutorId) {
        return {
          success: false,
          error: 'Tutor ID is required'
        };
      }

      // Cache tutor profile for 5 minutes (300 seconds)
      const cacheKey = `tutor:profile:${tutorId}`;
      const tutor = await cacheGetOrSet(cacheKey, 300, () => 
        tutorService.getTutorProfile(tutorId)
      );

      if (!tutor) {
        return {
          success: false,
          error: 'Tutor not found'
        };
      }

      return {
        success: true,
        data: tutor
      };
    } catch (error) {
      console.error('Error in /tutor/:tutorId:', error);
      return {
        success: false,
        error: 'Failed to get tutor profile'
      };
    }
  })

  /**
   * Get tutor weekly availability
   * GET /tutor/:tutorId/availability
   */
  .get('/:tutorId/availability', async ({ params }) => {
    try {
      const { tutorId } = params;
      if (!tutorId) {
        return { success: false, error: 'Tutor ID is required' };
      }

      const availability = await tutorService.getAvailability(tutorId);
      return { success: true, data: availability };
    } catch (error) {
      console.error('Error in /tutor/:tutorId/availability:', error);
      return { success: false, error: 'Failed to get availability' };
    }
  })

  /**
   * Get student profile (for tutor view)
   * GET /tutor/student/:studentId
   */
  .get('/student/:studentId', async ({ params, cookie, set }) => {
    
    try {
      const raw = cookie.tutorAuth?.value;
      
      if (!raw) {
        console.error('[TutorRoute] No tutorAuth cookie found');
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        console.error('[TutorRoute] Invalid or expired JWT token');
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const tutorId = payload.userId;

      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      const { studentId } = params;
      if (!studentId) {
        console.error('[TutorRoute] No studentId in params');
        set.status = 400;
        return { success: false, error: 'Student ID is required' };
      }

      const studentProfile = await tutorService.getStudentProfile(studentId, tutorId);
      
      return { success: true, data: studentProfile };
    } catch (error: any) {
      console.error('[TutorRoute] Error in /tutor/student/:studentId:', error);
      set.status = error.message === 'Student not found' ? 404 : 500;
      return { success: false, error: error.message || 'Failed to get student profile' };
    }
  })

  /**
   * Get student's lesson request (last viewed lesson + preferences)
   * GET /tutor/student/:studentId/lesson-request
   */
  .get('/student/:studentId/lesson-request', async ({ params, query, cookie, set }) => {
    
    try {
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid token' };
      }

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      const { studentId } = params;
      if (!studentId) {
        set.status = 400;
        return { success: false, error: 'Student ID is required' };
      }

      // Get student's last viewed lesson and profile
      const studentService = new StudentService();
      const sessionId = typeof query.sessionId === 'string' ? query.sessionId : undefined;
      if (sessionId) {
        const booking = await scheduleService.getTutorLessonDetails(sessionId, payload.userId);
        if (booking.studentId !== studentId) { set.status = 403; return { success: false, error: 'This student does not belong to this lesson' }; }
      }
      const [lessonResult, profileResult] = await Promise.all([
        studentService.getLastViewedLesson(studentId, sessionId),
        tutorService.getStudentProfile(studentId, payload.userId)
      ]);

      if (!lessonResult.success || !lessonResult.data) {
        return { success: true, data: null };
      }

      // Combine lesson data with student preferences
      const lessonRequest = {
        lessonId: lessonResult.data.lessonId,
        courseId: lessonResult.data.courseId,
        title: lessonResult.data.title,
        lessonNumber: lessonResult.data.lessonNumber,
        level: lessonResult.data.level ?? null,
        chapter: lessonResult.data.chapter ?? null,
        goal: lessonResult.data.goal,
        studentPreferences: profileResult ? {
          cameraOn: profileResult.lessonPreferences?.preferCameraOn !== false,
          proficiency: profileResult.currentProficiency || 'Not set',
          errorCorrection: profileResult.lessonPreferences?.errorCorrection || 'tutor_choice',
          otherRequests: profileResult.lessonPreferences?.otherRequests || ''
        } : null
      };

      return { success: true, data: lessonRequest };
    } catch (error: any) {
      console.error('[TutorRoute] Error in /tutor/student/:studentId/lesson-request:', error);
      set.status = 500;
      return { success: false, error: error.message || 'Failed to get student lesson request' };
    }
  })

  .get('/lesson-notes/:sessionId', async ({ params, query, cookie, set }) => {
    try {
      const raw = cookie.tutorAuth?.value;
      const payload = raw ? await verifyAuthToken(String(raw)) : null;
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }
      await refreshJwtCookie(cookie, payload, 'tutorAuth');
      await scheduleService.getTutorLessonDetails(params.sessionId, payload.userId);
      const data = await classroomNotesService.listLessonNotes(params.sessionId, payload.userId, query.tab);
      return { success: true, data };
    } catch (error: any) {
      console.error('[TutorRoute] Failed to load lesson notes:', error);
      set.status = error.message?.includes('do not have access') ? 403 : 500;
      return { success: false, error: 'Unable to load lesson notes' };
    }
  }, {
    query: t.Object({ tab: t.Union([t.Literal('current'), t.Literal('recent'), t.Literal('mine'), t.Literal('first')]) })
  })

  .get('/lesson-notes-edit-window/:sessionId', async ({ params, cookie, set }) => {
    try {
      const payload = cookie.tutorAuth?.value ? await verifyAuthToken(String(cookie.tutorAuth.value)) : null;
      if (!payload) { set.status = 401; return { success: false, error: 'Not authenticated' }; }
      await refreshJwtCookie(cookie, payload, 'tutorAuth');
      return { success: true, data: await classroomNotesService.getEditWindow(params.sessionId, payload.userId) };
    } catch (error: any) {
      set.status = error.message?.includes('do not have access') ? 403 : 500;
      return { success: false, error: 'Unable to check the editing window' };
    }
  })
  .get('/classroom-lesson-notes/:sessionId', async ({ params, cookie, set }) => {
    try {
      const payload = cookie.tutorAuth?.value ? await verifyAuthToken(String(cookie.tutorAuth.value)) : null;
      if (!payload) { set.status = 401; return { success: false, error: 'Not authenticated' }; }
      await refreshJwtCookie(cookie, payload, 'tutorAuth');
      await scheduleService.getTutorLessonDetails(params.sessionId, payload.userId);
      return { success: true, data: await classroomNotesService.getLessonNotes(params.sessionId, payload.userId) };
    } catch (error: any) {
      set.status = error.message?.includes('do not have access') ? 403 : 500;
      return { success: false, error: 'Unable to load lesson notes' };
    }
  })
  .put('/classroom-lesson-notes/:sessionId', async ({ params, body, cookie, set }) => {
    try {
      const payload = cookie.tutorAuth?.value ? await verifyAuthToken(String(cookie.tutorAuth.value)) : null;
      if (!payload) { set.status = 401; return { success: false, error: 'Not authenticated' }; }
      await refreshJwtCookie(cookie, payload, 'tutorAuth');
      await scheduleService.getTutorLessonDetails(params.sessionId, payload.userId);
      await classroomNotesService.assertCanEdit(params.sessionId, payload.userId);
      await classroomNotesService.saveLessonNotes(params.sessionId, payload.userId, body.studentComment, body.tutorMemo, body.clientUpdatedAt, body.englishLevelAssessment);
      return { success: true };
    } catch (error: any) {
      set.status = error instanceof LessonFeedbackInvalid ? 400 : error instanceof LessonNotesReadOnly || error.message?.includes('do not have access') ? 403 : 500;
      return { success: false, error: error instanceof LessonNotesReadOnly || error instanceof LessonFeedbackInvalid ? error.message : 'Unable to save lesson notes' };
    }
  }, { body: t.Object({ studentComment: t.String({ maxLength: 20000 }), tutorMemo: t.String({ maxLength: 20000 }), englishLevelAssessment: t.Optional(t.Nullable(t.Integer({ minimum: 1, maximum: 10 }))), clientUpdatedAt: t.Optional(t.Number({ minimum: 0 })) }) })

  .put('/lesson-student-attendance/:sessionId', async ({ params, body, cookie, set }) => {
    try {
      const payload = cookie.tutorAuth?.value ? await verifyAuthToken(String(cookie.tutorAuth.value)) : null;
      if (!payload) { set.status = 401; return { success: false, error: 'Not authenticated' }; }
      await refreshJwtCookie(cookie, payload, 'tutorAuth');
      await classroomNotesService.setStudentAttendance(params.sessionId, payload.userId, body.status, body.reason);
      return { success: true };
    } catch (error: any) {
      set.status = error instanceof LessonNotesReadOnly || error.message?.includes('do not have access') ? 403 : 500;
      return { success: false, error: set.status === 403 ? error.message : 'Unable to update student attendance. No changes were saved.' };
    }
  }, { body: t.Object({ status: t.Union([t.Literal('present'), t.Literal('absent')]), reason: t.Optional(t.String({ maxLength: 1000 })) }) })

  .get('/classroom-material-progress/:sessionId', async ({ params, query, cookie, set }) => {
    try {
      const payload = cookie.tutorAuth?.value ? await verifyAuthToken(String(cookie.tutorAuth.value)) : null;
      if (!payload) { set.status = 401; return { success: false, error: 'Not authenticated' }; }
      await refreshJwtCookie(cookie, payload, 'tutorAuth');
      return { success: true, data: await classroomNotesService.getMaterialProgress(params.sessionId, payload.userId, query.materialType, query.materialId) };
    } catch (error: any) {
      set.status = error.message?.includes('do not have access') ? 403 : 500;
      return { success: false, error: 'Unable to load material progress' };
    }
  }, { query: t.Object({ materialType: t.Union([t.Literal('daily-dispatch'), t.Literal('conversational-skills'), t.Literal('business-english')]), materialId: t.String({ minLength: 1 }) }) })

  /**
   * Get persisted classroom notes for a session + active material
   * GET /tutor/classroom-notes/:sessionId?materialType=...&materialId=...
   */
  .get('/classroom-notes/:sessionId', async ({ params, query, cookie, set }) => {
    try {
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid token' };
      }

      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      const { sessionId } = params;
      const { materialType, materialId } = query as { materialType?: string; materialId?: string };

      if (!sessionId || !materialType || !materialId) {
        set.status = 400;
        return { success: false, error: 'sessionId, materialType, and materialId are required' };
      }

      await scheduleService.getTutorLessonDetails(sessionId, payload.userId);

      const notes = await classroomNotesService.getNotes(sessionId, materialType, materialId);
      return { success: true, data: notes };
    } catch (error: any) {
      console.error('[TutorRoute] Error in /tutor/classroom-notes/:sessionId:', error);
      set.status = error.message?.includes('do not have access') ? 403 : 500;
      return { success: false, error: error.message || 'Failed to get classroom notes' };
    }
  }, {
    query: t.Object({
      materialType: t.String(),
      materialId: t.String(),
    })
  })

  /**
   * Save persisted classroom notes for a session + active material
   * PUT /tutor/classroom-notes/:sessionId
   */
  .put('/classroom-notes/:sessionId', async ({ params, body, cookie, set }) => {
    try {
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid token' };
      }

      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      const { sessionId } = params;
      if (!sessionId) {
        set.status = 400;
        return { success: false, error: 'sessionId is required' };
      }

      const lessonDetails = await scheduleService.getTutorLessonDetails(sessionId, payload.userId);
      const notesBody = body as {
        materialType: string;
        materialId: string;
        materialTitle?: string | null;
        isUsed?: boolean;
        clientUpdatedAt?: number;
        completionStatus?: 'in_progress' | 'completed' | null;
        stoppedAt?: string | null;
        progressDetails?: string;
        courseId?: string | null;
        lessonId?: string | null;
        articleId?: string | null;
        vocabularyItems?: any[];
        grammarItems?: any[];
        pronunciationItems?: any[];
        studentComment?: string;
        tutorMemo?: string;
      };

      await classroomNotesService.assertCanEdit(sessionId, payload.userId);
      const notes = await classroomNotesService.saveNotes({
        sessionId,
        tutorId: payload.userId,
        studentId: lessonDetails.studentId || null,
        materialType: notesBody.materialType,
        materialId: notesBody.materialId,
        materialTitle: notesBody.materialTitle || null,
        isUsed: notesBody.isUsed,
        clientUpdatedAt: notesBody.clientUpdatedAt,
        completionStatus: notesBody.completionStatus,
        stoppedAt: notesBody.stoppedAt,
        progressDetails: notesBody.progressDetails,
        courseId: notesBody.courseId || null,
        lessonId: notesBody.lessonId || null,
        articleId: notesBody.articleId || null,
        vocabularyItems: notesBody.vocabularyItems || [],
        grammarItems: notesBody.grammarItems || [],
        pronunciationItems: notesBody.pronunciationItems || [],
        studentComment: notesBody.studentComment,
        tutorMemo: notesBody.tutorMemo,
      });

      return { success: true, data: notes };
    } catch (error: any) {
      console.error('[TutorRoute] Classroom note save failed; private content omitted.');
      set.status = error instanceof InvalidMaterialProgress || error instanceof LessonFeedbackInvalid ? 400 : error instanceof LessonNotesReadOnly || error.message?.includes('do not have access') ? 403 : 500;
      return { success: false, error: error instanceof InvalidMaterialProgress || error instanceof LessonFeedbackInvalid || error instanceof LessonNotesReadOnly ? error.message : 'Failed to save classroom notes' };
    }
  }, {
    body: t.Object({
      materialType: t.String(),
      materialId: t.String(),
      materialTitle: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
      isUsed: t.Optional(t.Boolean()),
      clientUpdatedAt: t.Optional(t.Number({ minimum: 0 })),
      completionStatus: t.Optional(t.Nullable(t.Union([t.Literal('in_progress'), t.Literal('completed')]))),
      stoppedAt: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
      progressDetails: t.Optional(t.String({ maxLength: 2000 })),
      courseId: t.Optional(t.Nullable(t.String())),
      lessonId: t.Optional(t.Nullable(t.String())),
      articleId: t.Optional(t.Nullable(t.String())),
      vocabularyItems: t.Array(t.Any()),
      grammarItems: t.Array(t.Any()),
      pronunciationItems: t.Array(t.Any()),
      studentComment: t.Optional(t.String()),
      tutorMemo: t.Optional(t.String()),
    })
  })

  .get('/classroom-exercise-marks/:sessionId', async ({ params, query, cookie, set }) => {
    try {
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }
      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid token' };
      }
      await refreshJwtCookie(cookie, payload, 'tutorAuth');
      await scheduleService.getTutorLessonDetails(params.sessionId, payload.userId);
      if (!query.lessonId.startsWith('conversational-skills-')) {
        set.status = 400;
        return { success: false, error: 'A Conversational Skills lesson is required' };
      }
      const marks = await classroomExerciseMarksService.getMarks(params.sessionId, query.lessonId);
      return { success: true, data: marks };
    } catch (error: any) {
      console.error('[TutorRoute] Error loading classroom exercise marks:', error);
      set.status = error.message?.includes('do not have access') ? 403 : 500;
      return { success: false, error: error.message || 'Failed to load exercise marks' };
    }
  }, {
    query: t.Object({ lessonId: t.String() }),
  })

  .put('/classroom-exercise-marks/:sessionId', async ({ params, body, cookie, set }) => {
    try {
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }
      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid token' };
      }
      await refreshJwtCookie(cookie, payload, 'tutorAuth');
      const lessonDetails = await scheduleService.getTutorLessonDetails(params.sessionId, payload.userId);
      if (!body.lessonId.startsWith('conversational-skills-') || !Number.isInteger(body.itemIndex) || body.itemIndex < 0 || body.itemIndex > 99) {
        set.status = 400;
        return { success: false, error: 'Invalid lesson or exercise item' };
      }

      if (body.isCorrect === null) {
        await classroomExerciseMarksService.deleteMark(params.sessionId, body.lessonId, body.step, body.itemIndex);
        return { success: true, data: null };
      }
      if (!lessonDetails.studentId || !body.prompt.trim() || body.prompt.length > 2000 || body.answerKey.length > 1000 || (body.studentResponse || '').length > 2000) {
        set.status = 400;
        return { success: false, error: 'Invalid exercise mark' };
      }
      const mark = await classroomExerciseMarksService.saveMark({
        sessionId: params.sessionId,
        tutorId: payload.userId,
        studentId: lessonDetails.studentId,
        lessonId: body.lessonId,
        step: body.step,
        itemIndex: body.itemIndex,
        itemType: body.itemType,
        prompt: body.prompt.trim(),
        answerKey: body.answerKey.trim(),
        isCorrect: body.isCorrect,
        studentResponse: body.isCorrect ? '' : (body.studentResponse || '').trim(),
      });
      return { success: true, data: mark };
    } catch (error: any) {
      console.error('[TutorRoute] Error saving classroom exercise mark:', error);
      set.status = error.message?.includes('do not have access') ? 403 : 500;
      return { success: false, error: error.message || 'Failed to save exercise mark' };
    }
  }, {
    body: t.Object({
      lessonId: t.String(),
      step: t.Union([t.Literal('A'), t.Literal('B')]),
      itemIndex: t.Number(),
      itemType: t.String(),
      prompt: t.String(),
      answerKey: t.String(),
      isCorrect: t.Nullable(t.Boolean()),
      studentResponse: t.Optional(t.String()),
    }),
  })


export default Tutor;
