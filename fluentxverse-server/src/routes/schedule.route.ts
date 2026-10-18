import Elysia, { t } from 'elysia';
import { ScheduleService } from '../services/schedule.services/schedule.service';
import { ticketService } from '../services/ticket.services/ticket.service';
import { ClassroomNotesService } from '../services/classroomNotes.services/classroomNotes.service';
import { StudentLessonService, StudentLessonAccessError, StudentMaterialRequestError } from '../services/studentLesson.service';
import { StudentLessonIssueReportService } from '../services/studentLessonIssueReport.service';
import { lessonSurveyService } from '../services/lessonSurvey.service';
import { LessonSurveyError } from '../utils/lessonSurvey';
import { StudentIssueReportValidationError } from '../utils/studentTutorIssues';
import { TutorIssueReportValidationError } from '../utils/tutorStudentIssues';
import { ChatService } from '../services/chat.services/chat.service';
import { LessonTroubleReportService, getLessonTroubleWindow, isLessonTroubleWindowOpen } from '../services/lessonTroubleReport.service';
import { verifyAuthToken, refreshJwtCookie, type JwtAuthPayload } from '../utils/jwt';
import { resolveStudentSession } from '../utils/studentSession';
import { rateLimitMiddleware } from '../utils/rateLimiter';
import { cacheGetOrSet, invalidateCache, getRedis } from '../db/redis';
import { DateString, TimeString, ID, SafeString } from '../utils/validation';

const scheduleService = new ScheduleService();
const classroomNotesService = new ClassroomNotesService();
const studentLessonService = new StudentLessonService();
const studentLessonIssueReportService = new StudentLessonIssueReportService();
const chatService = new ChatService();
const lessonTroubleReportService = new LessonTroubleReportService();

// Cache TTLs in seconds
const STUDENT_STATS_CACHE_TTL = 60; // 1 minute - stats change on booking/completion
const STUDENT_BOOKINGS_CACHE_TTL = 120; // 2 minutes - bookings list
const STUDENT_ACTIVITY_CACHE_TTL = 300; // 5 minutes - activity changes less frequently

const Schedule = new Elysia({ prefix: '/schedule' })
  /**
   * Open time slots for tutoring
   * POST /schedule/open
   */
  .post('/open', async ({ body, cookie, set }) => {
    try {
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const tutorId = payload.userId;

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      const openedSlots = await scheduleService.openSlots({
        tutorId,
        slots: body.slots
      });

      // Invalidate tutor search cache since availability changed
      await invalidateCache('tutor:search:*');

      return {
        success: true,
        message: 'Slots opened successfully',
        data: openedSlots
      };
    } catch (error: any) {
      console.error('Error in /schedule/open:', error);
      set.status = 400;
      return {
        success: false,
        error: error.message || 'Failed to open slots'
      };
    }
  }, {
    body: t.Object({
      slots: t.Array(t.Object({
        date: DateString(),
        time: TimeString()
      }), { minItems: 1, maxItems: 100 })
    })
  })

  /**
   * Close time slots
   * POST /schedule/close
   */
  .post('/close', async ({ body, cookie, set }) => {
    try {
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const tutorId = payload.userId;

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      await scheduleService.closeSlots({
        tutorId,
        slotIds: body.slotIds,
        reason: body.reason,
        additionalInfo: body.additionalInfo
      });

      // Invalidate tutor search cache since availability changed
      await invalidateCache('tutor:search:*');

      return {
        success: true,
        message: 'Slots closed successfully'
      };
    } catch (error: any) {
      console.error('Error in /schedule/close:', error);
      set.status = 400;
      return {
        success: false,
        error: error.message || 'Failed to close slots'
      };
    }
  }, {
    body: t.Object({
      slotIds: t.Array(ID(), { minItems: 1, maxItems: 100 }),
      reason: t.Union([
        t.Literal('Internet Outage'), t.Literal('Electric Outage'),
        t.Literal('Emergency'), t.Literal('Disaster'),
        t.Literal('Health'), t.Literal('Others')
      ]),
      additionalInfo: t.Optional(t.String({ maxLength: 1000 }))
    })
  })

  /**
   * Get tutor's schedule for a week
   * GET /schedule/week
   */
  .get('/week', async ({ query, cookie, set }) => {
    try {
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const tutorId = payload.userId;

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      const weekOffset = query.weekOffset ? parseInt(query.weekOffset, 10) : 0;

      const schedule = await scheduleService.getTutorSchedule({
        tutorId,
        weekOffset
      });



      return {
        success: true,
        data: schedule
      };
    } catch (error: any) {
      console.error('Error in /schedule/week:', error);
      set.status = 500;
      return {
        success: false,
        error: error.message || 'Failed to get schedule'
      };
    }
  })

  /**
   * Mark attendance for a booking
   * POST /schedule/attendance
   */
  .post('/attendance', async ({ body, cookie, set }) => {
    try {
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const tutorId = payload.userId;

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      await scheduleService.markTutorAttendance({
        bookingIds: body.bookingIds || (body.bookingId ? [body.bookingId] : []),
        slotIds: body.slotIds || [],
        tutorId,
        status: body.status,
        reason: body.reason,
        additionalInfo: body.additionalInfo
      });

      if (body.status === 'absent' && body.slotIds?.length) {
        await invalidateCache('tutor:search:*');
      }

      return {
        success: true,
        message: 'Attendance marked successfully'
      };
    } catch (error: any) {
      console.error('Error in /schedule/attendance:', error);
      set.status = 400;
      return {
        success: false,
        error: error.message || 'Failed to mark attendance'
      };
    }
  }, {
    body: t.Object({
      bookingId: t.Optional(t.String()),
      bookingIds: t.Optional(t.Array(t.String(), { maxItems: 12 })),
      slotIds: t.Optional(t.Array(t.String(), { maxItems: 12 })),
      status: t.Union([t.Literal('present'), t.Literal('absent')]),
      reason: t.Optional(t.Union([
        t.Literal('Internet Outage'), t.Literal('Electric Outage'),
        t.Literal('Emergency'), t.Literal('Disaster'),
        t.Literal('Health'), t.Literal('Others')
      ])),
      additionalInfo: t.Optional(t.String({ maxLength: 1000 }))
    })
  })

  /**
   * Get student's bookings
   * GET /schedule/student-bookings
   */
  .get('/student-bookings', async ({ cookie, set }) => {
    try {
      const raw = cookie.studentAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const studentId = payload.userId;

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'studentAuth');

      const cacheKey = `student:bookings:${studentId}`;
      const bookings = await cacheGetOrSet(
        cacheKey, 
        STUDENT_BOOKINGS_CACHE_TTL, 
        async () => scheduleService.getStudentBookings(studentId)
      );

      return {
        success: true,
        data: bookings
      };
    } catch (error: any) {
      console.error('Error in /schedule/student-bookings:', error);
      set.status = 500;
      return {
        success: false,
        error: error.message || 'Failed to get bookings'
      };
    }
  })

  /**
   * Get student statistics for dashboard
   * GET /schedule/student-stats
   */
  .get('/student-stats', async ({ cookie, set }) => {
    try {
      const raw = cookie.studentAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const studentId = payload.userId;

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'studentAuth');

      const cacheKey = `student:stats:${studentId}`;
      const stats = await cacheGetOrSet(
        cacheKey, 
        STUDENT_STATS_CACHE_TTL, 
        async () => scheduleService.getStudentStats(studentId)
      );

      return {
        success: true,
        data: stats
      };
    } catch (error: any) {
      console.error('Error in /schedule/student-stats:', error);
      set.status = 500;
      return {
        success: false,
        error: error.message || 'Failed to get student stats'
      };
    }
  })

  /**
   * Get recent activity for student dashboard
   * GET /schedule/student-activity
   */
  .get('/student-activity', async ({ cookie, query, set }) => {
    try {
      const raw = cookie.studentAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const studentId = payload.userId;

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'studentAuth');

      const limit = query.limit ? parseInt(query.limit as string) : 10;

      const cacheKey = `student:activity:${studentId}:${limit}`;
      const activity = await cacheGetOrSet(
        cacheKey,
        STUDENT_ACTIVITY_CACHE_TTL,
        async () => scheduleService.getStudentRecentActivity(studentId, limit)
      );

      return {
        success: true,
        data: activity
      };
    } catch (error: any) {
      console.error('Error in /schedule/student-activity:', error);
      set.status = 500;
      return {
        success: false,
        error: error.message || 'Failed to get student activity'
      };
    }
  })

  /**
   * Get lesson details by booking ID
   * GET /schedule/lesson/:bookingId
   */
  .get('/lesson/:bookingId', async ({ cookie, params, set }) => {
    try {
      const raw = cookie.studentAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const studentId = payload.userId;

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'studentAuth');

      const { bookingId } = params;

      const lessonDetails = await scheduleService.getLessonDetails(bookingId, studentId);
      return {
        success: true,
        data: lessonDetails
      };
    } catch (error: any) {

      console.error('Error message:', error.message);

      return {
        success: false,
        error: error.message || 'Failed to get lesson details'
      };
    }
  })

  /**
   * Get the student-visible classroom comment for a saved material note
   * GET /schedule/classroom-notes/:bookingId?materialType=...&materialId=...
   */
  .get('/lesson-recap/:bookingId', async ({ request, params, set }) => {
    try {
      const payload = await resolveStudentSession(request);
      if (!payload) { set.status = 401; return { success: false, error: 'Not authenticated' }; }
      set.headers['Cache-Control'] = 'no-store';
      return { success: true, data: await studentLessonService.getRecap(params.bookingId, payload.userId) };
    } catch (error) {
      set.status = error instanceof StudentLessonAccessError ? 403 : 500;
      return { success: false, error: error instanceof StudentLessonAccessError ? error.message : 'Unable to load lesson recap' };
    }
  })
  .get('/lesson-material-request/:bookingId', async ({ request, params, set }) => {
    try {
      const payload = await resolveStudentSession(request);
      if (!payload) { set.status = 401; return { success: false, error: 'Not authenticated' }; }
      set.headers['Cache-Control'] = 'no-store';
      return { success: true, data: await studentLessonService.getMaterialRequest(params.bookingId, payload.userId) };
    } catch (error) {
      set.status = error instanceof StudentLessonAccessError ? 403 : 500;
      return { success: false, error: error instanceof StudentLessonAccessError ? error.message : 'Unable to load material request' };
    }
  })
  .get('/lesson/:bookingId/survey', async ({ request, params, set }) => {
    try {
      const payload = await resolveStudentSession(request);
      if (!payload) { set.status = 401; return { success: false, error: 'Not authenticated' }; }
      set.headers['Cache-Control'] = 'no-store';
      return { success: true, data: await lessonSurveyService.get(params.bookingId, payload.userId) };
    } catch (error) {
      set.status = error instanceof StudentLessonAccessError ? 403 : 500;
      return { success: false, error: error instanceof StudentLessonAccessError ? error.message : 'Unable to load lesson survey' };
    }
  })
  .post('/lesson/:bookingId/survey', async ({ request, params, body, set }) => {
    try {
      const payload = await resolveStudentSession(request);
      if (!payload) { set.status = 401; return { success: false, error: 'Not authenticated' }; }
      return { success: true, data: await lessonSurveyService.submit(params.bookingId, payload.userId, body) };
    } catch (error) {
      set.status = error instanceof StudentLessonAccessError ? 403 : error instanceof LessonSurveyError ? error.status : 500;
      return { success: false, error: error instanceof StudentLessonAccessError || error instanceof LessonSurveyError ? error.message : 'Unable to submit your survey. Please try again.' };
    }
  }, { body: t.Object({ rating: t.Integer({ minimum: 1, maximum: 5 }),
    positive: t.Array(t.String({ maxLength: 40 }), { maxItems: 11 }), improvement: t.Array(t.String({ maxLength: 40 }), { maxItems: 11 }),
    comment: t.Optional(t.String({ maxLength: 500 })) }) })
  .get('/lesson/:bookingId/issue-report', async ({ request, params, set }) => {
    try {
      const payload = await resolveStudentSession(request);
      if (!payload) { set.status = 401; return { success: false, error: 'Not authenticated' }; }
      const lesson = await studentLessonService.getOwnedLesson(params.bookingId, payload.userId);
      const window = await studentLessonIssueReportService.getReportingWindow(params.bookingId, lesson);
      const report = await studentLessonIssueReportService.get(params.bookingId, payload.userId);
      set.headers['Cache-Control'] = 'no-store';
      return { success: true, data: { ...window, eligible: window.eligible && !report, report } };
    } catch (error) {
      set.status = error instanceof StudentLessonAccessError ? 403 : 500;
      return { success: false, error: error instanceof StudentLessonAccessError ? error.message : 'Unable to load issue reporting availability' };
    }
  })
  .post('/lesson/:bookingId/issue-report', async ({ request, params, body, set }) => {
    try {
      const payload = await resolveStudentSession(request);
      if (!payload) { set.status = 401; return { success: false, error: 'Not authenticated' }; }
      const lesson = await studentLessonService.getOwnedLesson(params.bookingId, payload.userId);
      const window = await studentLessonIssueReportService.getReportingWindow(params.bookingId, lesson);
      if (!window.eligible) {
        set.status = 403;
        return { success: false, error: window.reason === 'waiting_for_tutor'
          ? 'Please wait until three minutes after the scheduled start if the tutor has not joined.'
          : window.reason === 'tutor_disconnected_wait'
            ? 'Please wait until the tutor has been disconnected for 60 seconds. Reporting closes if the tutor returns.'
          : window.reason === 'tutor_joined'
            ? 'The tutor has joined this lesson. You can report any lesson issue after its scheduled end, for up to 48 hours.'
            : 'Reporting is available if the tutor has not joined after three minutes or has been disconnected for 60 seconds, and for 48 hours after the lesson ends. Cancelled lessons cannot be reported.' };
      }
      const report = await studentLessonIssueReportService.create(params.bookingId, payload.userId, body.duration, body.reason, body.details || '', body.tutorIssue,
        Date.parse(window.serverNow) < Date.parse(window.lessonEndsAt), window.duringLessonTutorIssue || 'no_show');
      if (!report) { set.status = 409; return { success: false, error: 'An issue has already been reported for this lesson' }; }
      return { success: true, data: report };
    } catch (error) {
      set.status = error instanceof StudentLessonAccessError ? 403 : error instanceof StudentIssueReportValidationError ? 400 : 500;
      return { success: false, error: error instanceof StudentLessonAccessError || error instanceof StudentIssueReportValidationError ? error.message : 'Unable to submit issue report. Please try again.' };
    }
  }, { body: t.Object({ duration: t.Union([t.Literal('up_to_ten'), t.Literal('over_ten')]),
    reason: t.Union([t.Literal('connection'), t.Literal('audio'), t.Literal('hardware'), t.Literal('emergency'), t.Literal('power'), t.Literal('tutor'), t.Literal('material'), t.Literal('other')]),
    details: t.Optional(t.String({ maxLength: 2000 })), tutorIssue: t.Optional(t.String({ maxLength: 80 })) }) })
  .put('/lesson-material-request/:bookingId', async ({ request, params, body, set }) => {
    try {
      const payload = await resolveStudentSession(request);
      if (!payload) { set.status = 401; return { success: false, error: 'Not authenticated' }; }
      return { success: true, data: await studentLessonService.setMaterialRequest(params.bookingId, payload.userId, body.courseId, body.materialId) };
    } catch (error) {
      set.status = error instanceof StudentLessonAccessError ? 403 : error instanceof StudentMaterialRequestError ? 400 : 500;
      return { success: false, error: error instanceof StudentLessonAccessError || error instanceof StudentMaterialRequestError ? error.message : 'Unable to save material request' };
    }
  }, { body: t.Object({ courseId: t.Union([t.Literal('daily-dispatch'), t.Literal('conversational-skills'), t.Literal('business-english'), t.Null()]), materialId: t.Optional(t.String({ minLength: 1, maxLength: 200 })) }) })
  .get('/classroom-notes/:bookingId', async ({ cookie, params, query, set }) => {
    try {
      const raw = cookie.studentAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const studentId = payload.userId;

      await refreshJwtCookie(cookie, payload, 'studentAuth');

      const { bookingId } = params;
      const materialType = typeof query.materialType === 'string' ? query.materialType : '';
      const materialId = typeof query.materialId === 'string' ? query.materialId : '';

      if (!bookingId || !materialType || !materialId) {
        set.status = 400;
        return { success: false, error: 'bookingId, materialType, and materialId are required' };
      }

      await scheduleService.getLessonDetails(bookingId, studentId);

      const notes = await classroomNotesService.getNotes(bookingId, materialType, materialId);

      return {
        success: true,
        data: notes
          ? {
              sessionId: notes.sessionId,
              materialType: notes.materialType,
              materialId: notes.materialId,
              courseId: notes.courseId,
              lessonId: notes.lessonId,
              articleId: notes.articleId,
              studentComment: notes.studentComment,
              updatedAt: notes.updatedAt,
            }
          : null,
      };
    } catch (error: any) {
      console.error('Error in /schedule/classroom-notes/:bookingId:', error);
      set.status = error.message?.includes('Not authenticated') ? 401 : 500;
      return {
        success: false,
        error: error.message || 'Failed to get classroom notes'
      };
    }
  }, {
    query: t.Object({
      materialType: t.String(),
      materialId: t.String(),
    })
  })

  /**
   * Get available slots for a tutor
   * GET /schedule/available/:tutorId
   */
  .get('/available/:tutorId', async ({ params, query, set }) => {
    try {
      const { tutorId } = params;
      
      if (!tutorId) {
        return { success: false, error: 'Tutor ID is required' };
      }
      
      // Default to next 7 days if not specified
      const now = new Date();
      const startDate = (query.startDate as string) || now.toISOString().split('T')[0] || "";
      const endDate = (query.endDate as string) || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] || "";

 
      const slots = await scheduleService.getAvailableSlots(tutorId, startDate, endDate);

      return {
        success: true,
        data: slots
      };
    } catch (error: any) {
      console.error('Error in /schedule/available:', error);
      set.status = 500;
      return {
        success: false,
        error: error.message || 'Failed to get available slots'
      };
    }
  })

  .post('/reserve', async ({ body, cookie, request, set }) => {
    try {
      const payload = await resolveStudentSession(request);
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }
      const data = await scheduleService.reserveSlotForCheckout(payload.userId, body.slotId);
      await invalidateCache('tutor:search:*');
      await refreshJwtCookie(cookie, payload, 'studentAuth');
      return { success: true, data };
    } catch (error: any) {
      set.status = 400;
      return { success: false, error: error.message || 'Could not reserve slot' };
    }
  }, { body: t.Object({ slotId: ID() }) })

  .post('/release-reservation', async ({ body, request, set }) => {
    try {
      const payload = await resolveStudentSession(request);
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }
      await scheduleService.releaseSlotReservation(payload.userId, body.slotId, body.reservationId);
      await invalidateCache('tutor:search:*');
      return { success: true };
    } catch (error: any) {
      set.status = 400;
      return { success: false, error: error.message || 'Could not release reservation' };
    }
  }, { body: t.Object({ slotId: ID(), reservationId: ID() }) })

  .post('/recover-transfer', async ({ body, request, set }) => {
    try {
      const payload = await resolveStudentSession(request);
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }
      const data = await ticketService.recoverUnbookedTransfer(
        payload.userId, body.ticketTransferTxHash, body.slotId, body.reservationId
      );
      return { success: true, data };
    } catch (error: any) {
      set.status = 400;
      return { success: false, error: error.message || 'Could not recover transfer' };
    }
  }, { body: t.Object({
    ticketTransferTxHash: t.String({ minLength: 8, maxLength: 100 }),
    slotId: ID(), reservationId: ID()
  }) })

  /**
   * Book a time slot
   * POST /schedule/book
   * Rate limited: 5 bookings per minute per user
   */
  .get('/reservation/:reservationId', async ({ params, request, set }) => {
    const student = await resolveStudentSession(request);
    if (!student) { set.status = 401; return { success: false, error: 'Student authentication required' }; }
    try { return { success: true, data: await scheduleService.reservationStatus(student.userId, params.reservationId) }; }
    catch { set.status = 503; return { success: false, error: 'Reservation status unavailable' }; }
  }, { params: t.Object({ reservationId: ID() }) })
  .post('/book', async ({ body, cookie, request, set }) => {
    try {
      
      const payload = await resolveStudentSession(request);
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      
      const studentId = payload.userId;
      
      // Rate limiting check
      const rateLimitError = await rateLimitMiddleware(studentId, 'booking', set as any);
      if (rateLimitError) {
        return rateLimitError;
      }
      

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'studentAuth');

      
      const booking = await scheduleService.bookSlot({
        studentId,
        slotId: body.slotId,
        reservationId: body.reservationId,
        ticketTransferTxHash: body.ticketTransferTxHash,
        privatePassReservationId: body.privatePassReservationId
      });
      

      // Invalidate tutor search cache since slot is no longer available
      await invalidateCache('tutor:search:*');

      return {
        success: true,
        data: booking,
        message: 'Booking confirmed successfully'
      };
    } catch (error: any) {
      console.error('Booking request failed');
      
      set.status = 400;
      return {
        success: false,
        error: error.message || 'Failed to book slot'
      };
    }
  }, {
    body: t.Object({
      slotId: ID(),
      reservationId: ID(),
      ticketTransferTxHash: t.Optional(t.String({ minLength: 8, maxLength: 100 })),
      privatePassReservationId: t.Optional(t.String({ pattern: '^0x[a-f0-9]{64}$' }))
    })
  })

  /**
   * Cancel a booking (student action)
   * POST /schedule/cancel
   * Refunds ticket if cancellation is more than 1 hour before scheduled time
   */
  .post('/cancel', async ({ body, cookie, set }) => {
    try {
      
      const raw = cookie.studentAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const studentId = payload.userId;

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'studentAuth');


      const result = await scheduleService.cancelBooking({
        bookingId: body.bookingId,
        cancelledBy: studentId,
        reason: body.reason
      });


      // Invalidate tutor search cache since slot may be available again
      await invalidateCache('tutor:search:*');

      return {
        success: result.success,
        refunded: result.refunded,
        message: result.message
      };
    } catch (error: any) {
      console.error('Error in /schedule/cancel:', error);
      set.status = 400;
      return {
        success: false,
        error: error.message || 'Failed to cancel booking'
      };
    }
  }, {
    body: t.Object({
      bookingId: ID(),
      reason: t.Optional(SafeString({ maxLength: 500 }))
    })
  })

  /**
   * Get lesson details by booking ID (Tutor view)
   * GET /schedule/tutor-lesson/:bookingId
   */
  .get('/tutor-lesson/:bookingId', async ({ cookie, params, set }) => {
    try {
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const tutorId = payload.userId;

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      const { bookingId } = params;

      const lessonDetails = await scheduleService.getTutorLessonDetails(bookingId, tutorId);
      return {
        success: true,
        data: lessonDetails
      };
    } catch (error: any) {
      console.error('Error in /schedule/tutor-lesson:', error.message);
      return {
        success: false,
        error: error.message || 'Failed to get lesson details'
      };
    }
  })

  .get('/tutor-lesson/:bookingId/chat-log', async ({ cookie, params, set }) => {
    const raw = cookie.tutorAuth?.value;
    const payload = raw ? await verifyAuthToken(String(raw)) : null;
    if (!payload) {
      set.status = 401;
      return { success: false, error: 'Not authenticated' };
    }

    try {
      await scheduleService.getTutorLessonDetails(params.bookingId, payload.userId);
      await refreshJwtCookie(cookie, payload, 'tutorAuth');
      const messages = await chatService.getSessionMessages(params.bookingId, 2000);
      return {
        success: true,
        data: messages.map(message => ({
          id: message.id,
          senderType: message.sender_type,
          text: message.display_text,
          correction: message.correction_text,
          timestamp: message.created_at,
          isEdited: Boolean(message.edited_at)
        }))
      };
    } catch (error: any) {
      if (error.message?.includes('Booking not found or you do not have access')) {
        set.status = 404;
        return { success: false, error: 'Lesson not found' };
      }
      console.error('Error in /schedule/tutor-lesson/:bookingId/chat-log:', error);
      set.status = 500;
      return { success: false, error: 'Failed to load chat log' };
    }
  })

  .get('/tutor-lesson/:bookingId/trouble-report', async ({ cookie, params, set }) => {
    const raw = cookie.tutorAuth?.value;
    const payload = raw ? await verifyAuthToken(String(raw)) : null;
    if (!payload) {
      set.status = 401;
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const lesson = await scheduleService.getTutorLessonDetails(params.bookingId, payload.userId);
      const window = getLessonTroubleWindow(lesson.slotDate, lesson.slotTime, Number(lesson.durationMinutes));
      const report = await lessonTroubleReportService.getByBooking(params.bookingId);
      const studentReport = await studentLessonIssueReportService.getForTutor(params.bookingId, payload.userId);
      await refreshJwtCookie(cookie, payload, 'tutorAuth');
      return {
        success: true,
        data: {
          ...window,
          serverNow: new Date().toISOString(),
          eligible: lesson.status !== 'cancelled' && !report && isLessonTroubleWindowOpen(window),
          report, studentReport
        }
      };
    } catch (error: any) {
      if (error.message?.includes('Booking not found or you do not have access')) {
        set.status = 404;
        return { success: false, error: 'Lesson not found' };
      }
      console.error('Error loading lesson trouble report:', error);
      set.status = 500;
      return { success: false, error: 'Failed to load report status' };
    }
  })

  .post('/tutor-lesson/:bookingId/trouble-report', async ({ cookie, params, body, set }) => {
    const raw = cookie.tutorAuth?.value;
    const payload = raw ? await verifyAuthToken(String(raw)) : null;
    if (!payload) {
      set.status = 401;
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const lesson = await scheduleService.getTutorLessonDetails(params.bookingId, payload.userId);
      const window = getLessonTroubleWindow(lesson.slotDate, lesson.slotTime, Number(lesson.durationMinutes));
      if (lesson.status === 'cancelled' || !isLessonTroubleWindowOpen(window)) {
        set.status = 403;
        return { success: false, error: 'Issue reports can only be submitted during the scheduled lesson' };
      }

      const report = await lessonTroubleReportService.create(params.bookingId, payload.userId, body.duration, body.reason, body.studentIssue);
      if (!report) {
        set.status = 409;
        return { success: false, error: 'An issue has already been reported for this lesson' };
      }

      await refreshJwtCookie(cookie, payload, 'tutorAuth');
      return { success: true, data: report };
    } catch (error: any) {
      if (error.message?.includes('Booking not found or you do not have access')) {
        set.status = 404;
        return { success: false, error: 'Lesson not found' };
      }
      if (error instanceof TutorIssueReportValidationError) {
        set.status = 400;
        return { success: false, error: error.message };
      }
      console.error('Error submitting lesson trouble report:', error);
      set.status = 500;
      return { success: false, error: 'Failed to submit issue report' };
    }
  }, {
    body: t.Object({
      duration: t.Union([t.Literal('up_to_ten'), t.Literal('over_ten')]),
      reason: t.Union([
        t.Literal('connection'), t.Literal('audio'), t.Literal('hardware'),
        t.Literal('emergency'), t.Literal('power'), t.Literal('student')
      ]),
      studentIssue: t.Optional(t.Union([t.Literal('asked_to_cancel'), t.Literal('late')]))
    })
  })

  /**
   * Preload/warm cache for student's upcoming lesson data
   * POST /schedule/preload
   * This endpoint fetches and caches all relevant data for a student's dashboard
   */
  .post('/preload', async ({ cookie, set }) => {
    try {
      const raw = cookie.studentAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const studentId = payload.userId;

      // Refresh JWT cookie on every request
      await refreshJwtCookie(cookie, payload, 'studentAuth');

      // Warm all student-related caches in parallel
      const [stats, bookings, activity] = await Promise.all([
        cacheGetOrSet(
          `student:stats:${studentId}`,
          STUDENT_STATS_CACHE_TTL,
          async () => scheduleService.getStudentStats(studentId)
        ),
        cacheGetOrSet(
          `student:bookings:${studentId}`,
          STUDENT_BOOKINGS_CACHE_TTL,
          async () => scheduleService.getStudentBookings(studentId)
        ),
        cacheGetOrSet(
          `student:activity:${studentId}:50`, // Default activity limit
          STUDENT_ACTIVITY_CACHE_TTL,
          async () => scheduleService.getStudentRecentActivity(studentId, 50)
        )
      ]);

      return {
        success: true,
        message: 'Data preloaded successfully',
        data: {
          stats,
          bookingsCount: bookings.length,
          activityCount: activity.length
        }
      };
    } catch (error: any) {
      console.error('Error in /schedule/preload:', error);
      set.status = 500;
      return {
        success: false,
        error: error.message || 'Failed to preload data'
      };
    }
  })

  /**
   * Invalidate student's cache (called after booking/cancellation)
   * POST /schedule/invalidate-cache
   */
  .post('/invalidate-cache', async ({ cookie, set }) => {
    try {
      const raw = cookie.studentAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const studentId = payload.userId;

      // Invalidate all student-related caches
      await Promise.all([
        invalidateCache(`student:stats:${studentId}`),
        invalidateCache(`student:bookings:${studentId}`),
        invalidateCache(`student:activity:${studentId}:10`),
        invalidateCache(`student:activity:${studentId}:50`)
      ]);

      return {
        success: true,
        message: 'Cache invalidated successfully'
      };
    } catch (error: any) {
      console.error('Error in /schedule/invalidate-cache:', error);
      set.status = 500;
      return {
        success: false,
        error: error.message || 'Failed to invalidate cache'
      };
    }
  });

export default Schedule;
