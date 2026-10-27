import Elysia, { t } from 'elysia';
import { InterviewService } from '../services/interview.services/interview.service';
import { NotificationService } from '../services/notification.services/notification.service';
import { getIO } from '../socket/socket.server';
import { verifyAuthToken, refreshJwtCookie, type JwtAuthPayload } from '../utils/jwt';
import { createAdminGuard } from '../middleware/auth.middleware';
import { isAllowedAdminMutationOrigin, isAllowedTutorMutationOrigin } from '../config/cors';
import { applicationFailure } from '../services/exam.services/applicationPolicy';
import { logger } from '../utils/logger';

const interviewService = new InterviewService();
const notificationService = new NotificationService();

const Interview = new Elysia({ prefix: '/interview' })
  .onBeforeHandle(async ({ request, cookie, set }) => {
    const path = new URL(request.url).pathname;
    if (request.method === 'POST' && ['/interview/book', '/interview/cancel'].includes(path)) {
      if (!isAllowedTutorMutationOrigin(request.headers.get('origin'))) { set.status = 403; return { success: false, error: 'Tutor application origin required' }; }
      const token = cookie.tutorAuth?.value ? await verifyAuthToken(String(cookie.tutorAuth.value)) : null;
      if (token?.role !== 'tutor') { set.status = 401; return { success: false, error: 'Tutor authentication required' }; }
    }
    if (['POST', 'DELETE'].includes(request.method) && path === '/interview/slots' && !isAllowedAdminMutationOrigin(request.headers.get('origin'))) {
      set.status = 403; return { success: false, error: 'Dashboard origin required' };
    }
  })
  // Helper: verify admin authentication via adminAuth cookie (JWT)
  .derive(({ cookie, set }) => ({ requireAdmin: () => createAdminGuard(cookie, set, 'operations') }))
  .get('/room/:id', async ({ params, cookie, set, request }) => {
    set.headers['Cache-Control'] = 'private, no-store';
    const room = await interviewService.getRoom(params.id);
    const tutor = cookie.tutorAuth?.value ? await verifyAuthToken(String(cookie.tutorAuth.value)) : null;
    if (tutor?.role === 'tutor' && room?.tutorId === tutor.userId) {
      await refreshJwtCookie(cookie, tutor, 'tutorAuth');
    } else {
      if (!isAllowedAdminMutationOrigin(request.headers.get('origin')) || !await createAdminGuard(cookie, set, 'operations')) {
        set.status = 403; return { success: false, error: 'Interview access denied' };
      }
    }
    if (!room?.tutorId || !['booked', 'completed'].includes(room.status)) {
      set.status = 404; return { success: false, error: 'Booked interview not found' };
    }
    const { recordingUrl, ...publicRoom } = room;
    return { success: true, data: { ...publicRoom, hasRecording: Boolean(recordingUrl) } };
  })
  /**
   * Create interview slots (Admin only)
   * POST /interview/slots
   */
  .post('/slots', async ({ body, set, requireAdmin }) => {
    try {
      const admin = await requireAdmin();
      if (!admin) {
        return { success: false, error: 'Not authenticated' };
      }
      const slots = await interviewService.createSlots(body.slots);

      return {
        success: true,
        data: slots,
        message: `Created ${slots.length} interview slots`
      };
    } catch (error: any) {
      console.error('Error in POST /interview/slots:', error);
      set.status = 400;
      return {
        success: false,
        error: error.message || 'Failed to create interview slots'
      };
    }
  }, {
    body: t.Object({
      slots: t.Array(t.Object({
        date: t.String(),
        time: t.String()
      }))
    })
  })

  /**
   * Delete interview slots (Admin only)
   * DELETE /interview/slots
   */
  .delete('/slots', async ({ body, set, requireAdmin }) => {
    try {
      const admin = await requireAdmin();
      if (!admin) {
        return { success: false, error: 'Not authenticated' };
      }
      await interviewService.deleteSlots(body.slotIds);

      return {
        success: true,
        message: 'Interview slots deleted'
      };
    } catch (error: any) {
      console.error('Error in DELETE /interview/slots:', error);
      set.status = 400;
      return {
        success: false,
        error: error.message || 'Failed to delete interview slots'
      };
    }
  }, {
    body: t.Object({
      slotIds: t.Array(t.String())
    })
  })

  /**
   * Get interview schedule for a week (Admin view - all slots)
   * GET /interview/week
   */
  .get('/week', async ({ query, set, requireAdmin }) => {
    try {
      const admin = await requireAdmin();
      if (!admin) {
        return { success: false, error: 'Not authenticated' };
      }
      const weekOffset = query.weekOffset ? parseInt(query.weekOffset, 10) : 0;
      const schedule = await interviewService.getWeekSchedule(weekOffset);

      return {
        success: true,
        data: schedule
      };
    } catch (error: any) {
      console.error('Error in GET /interview/week:', error);
      set.status = 500;
      return {
        success: false,
        error: error.message || 'Failed to get interview schedule'
      };
    }
  })

  /**
   * Get available interview slots (Tutor view - only open slots)
   * GET /interview/available
   */
  .get('/available', async ({ query, cookie, set }) => {
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

      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      const weekOffset = query.weekOffset ? parseInt(query.weekOffset, 10) : 0;
      const slots = await interviewService.getAvailableSlots(weekOffset);

      return {
        success: true,
        data: slots
      };
    } catch (error: any) {
      console.error('Error in GET /interview/available:', error);
      set.status = 500;
      return {
        success: false,
        error: error.message || 'Failed to get available interview slots'
      };
    }
  })

  /**
   * Get tutor's current interview booking
   * GET /interview/my-booking
   */
  .get('/my-booking', async ({ cookie, set }) => {
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

      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      const booking = await interviewService.getTutorInterview(tutorId);

      return {
        success: true,
        data: booking
      };
    } catch (error: any) {
      console.error('Error in GET /interview/my-booking:', error);
      set.status = 500;
      return {
        success: false,
        error: error.message || 'Failed to get interview booking'
      };
    }
  })

  /**
   * Book an interview slot (Tutor)
   * POST /interview/book
   */
  .post('/book', async ({ body, cookie, set }) => {
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

      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      const booking = await interviewService.bookSlot(body.slotId, tutorId);

      // Send notification for interview scheduled
      try {
        
        const notification = await notificationService.notifyInterviewScheduled(
          tutorId,
          booking.date,
          booking.time
        );
        
        
        // Emit real-time notification via Socket.IO
        const io = getIO();
        
        if (io) {
          // Use the same room format as notification.handler.ts
          const room = `notifications:${tutorId}`;
          io.to(room).emit('notification:new', notification);
        }
      } catch (notifError) {
        console.error('Failed to send interview notification:', notifError);
        // Don't fail the booking if notification fails
      }

      return {
        success: true,
        data: booking,
        message: 'Interview booked successfully'
      };
    } catch (error: any) {
      const failure = applicationFailure(error);
      set.status = failure.status;
      return {
        success: false,
        error: failure.message
      };
    }
  }, {
    body: t.Object({
      slotId: t.String()
    })
  })

  /**
   * Cancel interview booking (Tutor)
   * POST /interview/cancel
   */
  .post('/cancel', async ({ body, cookie, set }) => {
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

      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      // Get booking details before cancelling (for notification)
      const existingBooking = await interviewService.getTutorInterview(tutorId);

      await interviewService.cancelBooking(body.slotId, tutorId);

      // Send cancellation notification
      if (existingBooking) {
        try {
          const notification = await notificationService.notifyInterviewCancelled(
            tutorId,
            existingBooking.date,
            existingBooking.time
          );
          
          const io = getIO();
          if (io) {
            io.to(`notifications:${tutorId}`).emit('notification:new', notification);
          }
        } catch (notifError) {
          console.error('Failed to send cancellation notification:', notifError);
        }
      }

      return {
        success: true,
        message: 'Interview cancelled successfully'
      };
    } catch (error: any) {
      console.error('Error in POST /interview/cancel:', error);
      set.status = 400;
      return {
        success: false,
        error: error.message || 'Failed to cancel interview'
      };
    }
  }, {
    body: t.Object({
      slotId: t.String()
    })
  })

  /**
   * Admin: Cancel any interview booking
   * POST /interview/admin/cancel
   */
  .post('/admin/cancel', async ({ body, set, requireAdmin }) => {
    try {
      const admin = await requireAdmin();
      if (!admin) {
        return { success: false, error: 'Not authenticated' };
      }
      await interviewService.cancelBooking(body.slotId);

      return {
        success: true,
        message: 'Interview cancelled by admin'
      };
    } catch (error: any) {
      console.error('Error in POST /interview/admin/cancel:', error);
      set.status = 400;
      return {
        success: false,
        error: error.message || 'Failed to cancel interview'
      };
    }
  }, {
    body: t.Object({
      slotId: t.String()
    })
  })

  /**
   * Admin: Mark interview as completed
   * POST /interview/complete
   */
  .post('/complete', async ({ body, set, requireAdmin }) => {
    try {
      const admin = await requireAdmin();
      if (!admin) {
        return { success: false, error: 'Not authenticated' };
      }
      await interviewService.completeInterview(body.slotId, body.notes);

      return {
        success: true,
        message: 'Interview marked as completed'
      };
    } catch (error: any) {
      console.error('Error in POST /interview/complete:', error);
      set.status = 400;
      return {
        success: false,
        error: error.message || 'Failed to complete interview'
      };
    }
  }, {
    body: t.Object({
      slotId: t.String(),
      notes: t.Optional(t.String())
    })
  })

  /**
   * Admin: Save interview result with rubric scores
   * POST /interview/result
   */
  .post('/result', async ({ body, set, cookie, request }) => {
    try {
      if (!isAllowedAdminMutationOrigin(request.headers.get('origin'))) {
        set.status = 403; return { success: false, error: 'Invalid administration origin' };
      }
      const admin = await createAdminGuard(cookie, set, 'operations');
      if (!admin) {
        return { success: false, error: 'Not authenticated' };
      }
      
      await interviewService.saveInterviewResult({
        slotId: body.slotId,
        tutorId: body.tutorId,
        result: body.result,
        rubricScores: body.rubricScores,
        notes: body.notes,
        timestamps: body.timestamps,
        adminId: (admin as any).userId
      });
      getIO()?.to(`interview-${body.slotId}`).emit('interview:ended');

      return {
        success: true,
        message: `Interview marked as ${body.result}`
      };
    } catch (error: any) {
      console.error('Error in POST /interview/result:', error);
      set.status = 400;
      return {
        success: false,
        error: error.message || 'Failed to save interview result'
      };
    }
  }, {
    body: t.Object({
      slotId: t.String(),
      tutorId: t.String(),
      result: t.Union([t.Literal('pass'), t.Literal('fail')]),
      rubricScores: t.Object({
        grammar: t.Integer({ minimum: 1, maximum: 5 }),
        fluency: t.Integer({ minimum: 1, maximum: 5 }),
        pronunciation: t.Integer({ minimum: 1, maximum: 5 }),
        vocabulary: t.Integer({ minimum: 1, maximum: 5 }),
        professionalism: t.Integer({ minimum: 1, maximum: 5 })
      }),
      notes: t.String(),
      timestamps: t.Array(t.Object({
        time: t.String(),
        note: t.String()
      }))
    })
  })

  /**
   * Admin: Get interview result for a tutor
   * GET /interview/result/:tutorId
   */
  .get('/result/:tutorId', async ({ params, set, requireAdmin }) => {
    try {
      const admin = await requireAdmin();
      if (!admin) {
        return { success: false, error: 'Not authenticated' };
      }
      
      const result = await interviewService.getInterviewResult(params.tutorId);

      return {
        success: true,
        data: result
      };
    } catch (error: any) {
      console.error('Error in GET /interview/result:', error);
      set.status = 500;
      return {
        success: false,
        error: error.message || 'Failed to get interview result'
      };
    }
  })

  /**
   * Admin: Get pending interviews
   * GET /interview/pending
   */
  .get('/pending', async ({ query, set, requireAdmin }) => {
    try {
      const admin = await requireAdmin();
      if (!admin) {
        return { success: false, error: 'Not authenticated' };
      }
      const limit = query.limit ? parseInt(query.limit, 10) : 10;
      const interviews = await interviewService.getPendingInterviews(limit);

      return {
        success: true,
        data: interviews
      };
    } catch (error: any) {
      console.error('Error in GET /interview/pending:', error);
      set.status = 500;
      return {
        success: false,
        error: error.message || 'Failed to get pending interviews'
      };
    }
  })

  /**
   * Admin: Upload interview recording
   * POST /interview/recording
   */
  .post('/recording', async ({ request, set, cookie }) => {
    try {
      if (!isAllowedAdminMutationOrigin(request.headers.get('origin'))) {
        set.status = 403; return { success: false, error: 'Invalid administration origin' };
      }
      const admin = await createAdminGuard(cookie, set, 'operations');
      if (!admin) {
        return { success: false, error: 'Not authenticated' };
      }

      const form = await request.formData();
      const file = form.get('recording');
      const slotId = form.get('slotId') as string;
      const tutorId = form.get('tutorId') as string;
      const recordingId = String(form.get('recordingId') || crypto.randomUUID());

      if (!(file instanceof File)) {
        set.status = 400;
        return { success: false, error: 'Missing recording file' };
      }

      if (!slotId || !tutorId) {
        set.status = 400;
        return { success: false, error: 'Missing slotId or tutorId' };
      }
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slotId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(tutorId)
        || !/^[0-9a-f-]{36}$/i.test(recordingId)) {
        set.status = 400; return { success: false, error: 'Invalid recording identifiers' };
      }
      if (!['video/webm', 'video/mp4'].includes(file.type) || file.size < 1 || file.size > 90 * 1024 * 1024) {
        set.status = 400; return { success: false, error: 'Recording must be WebM or MP4 and under 90 MiB' };
      }
      const room = await interviewService.getRoom(slotId);
      if (room?.tutorId !== tutorId || !['booked', 'completed'].includes(room.status)) {
        set.status = 403; return { success: false, error: 'Recording does not belong to this interview' };
      }

      // Build SeaweedFS Filer path: /interview/{tutorId}/{slotId}_{timestamp}.webm
      const filerPath = `/interview/${tutorId}/${slotId}_${recordingId}.${file.type === 'video/mp4' ? 'mp4' : 'webm'}`;
      const filerBase = process.env.SEAWEED_FILER_URL || 'http://localhost:8888';
      const uploadUrl = `${filerBase}${filerPath}`;

      // Upload to SeaweedFS Filer
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: file.stream(),
        headers: {
          'Content-Type': file.type || 'video/webm'
        },
        signal: AbortSignal.timeout(60000)
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('SeaweedFS upload failed:', res.status, text);
        set.status = 500;
        return { success: false, error: `Upload failed: ${res.status}` };
      }

      // Save recording URL to the interview result
      await interviewService.saveRecordingUrl(slotId, tutorId, uploadUrl, recordingId, admin.userId, file.size);

      return {
        success: true,
        url: `/interview/recording/${encodeURIComponent(slotId)}`,
        message: 'Recording uploaded successfully'
      };
    } catch (error: any) {
      console.error('Error in POST /interview/recording:', error);
      set.status = 500;
      return {
        success: false,
        error: error.message || 'Failed to upload recording'
      };
    }
  }, { parse: 'none' })
  .get('/recording/:id', async ({ params, cookie, set, request }) => {
    set.headers['Cache-Control'] = 'private, no-store';
    const admin = isAllowedAdminMutationOrigin(request.headers.get('origin')) ? await createAdminGuard(cookie, set, 'operations') : null;
    if (!admin) {
      set.status = 403; return { success: false, error: 'Interview recording access denied' };
    }
    const room = await interviewService.getRoom(params.id);
    const filer = new URL(process.env.SEAWEED_FILER_URL || 'http://localhost:8888');
    const url = room?.recordingUrl ? new URL(room.recordingUrl) : null;
    if (!url || url.origin !== filer.origin || !url.pathname.startsWith(`/interview/${room?.tutorId}/`)) {
      set.status = 404; return { success: false, error: 'Recording not found' };
    }
    const range = request.headers.get('range');
    const response = await fetch(url, { headers: range ? { Range: range } : {}, signal: AbortSignal.timeout(15000) });
    logger.info('Interview recording playback', { userId: admin.userId, userType: 'admin', interviewId: params.id, statusCode: response.status });
    return new Response(response.body, { status: response.status, headers: {
      'Content-Type': response.headers.get('content-type') || 'video/webm', 'Cache-Control': 'private, no-store',
      'Accept-Ranges': 'bytes', ...(response.headers.get('content-range') ? { 'Content-Range': response.headers.get('content-range')! } : {}),
    } });
  })

  /**
   * Admin: Get interview statistics for analytics
   * GET /interview/stats
   */
  .get('/stats', async ({ set, requireAdmin }) => {
    try {
      const admin = await requireAdmin();
      if (!admin) {
        return { success: false, error: 'Not authenticated' };
      }

      const stats = await interviewService.getInterviewStats();

      return {
        success: true,
        data: stats
      };
    } catch (error: any) {
      console.error('Error in GET /interview/stats:', error);
      set.status = 500;
      return {
        success: false,
        error: error.message || 'Failed to get interview stats'
      };
    }
  })

  /**
   * Admin: Get today's interview queue
   * GET /interview/today
   */
  .get('/today', async ({ set, requireAdmin }) => {
    try {
      const admin = await requireAdmin();
      if (!admin) {
        return { success: false, error: 'Not authenticated' };
      }

      const queue = await interviewService.getTodayQueue();

      return {
        success: true,
        data: queue
      };
    } catch (error: any) {
      console.error('Error in GET /interview/today:', error);
      set.status = 500;
      return {
        success: false,
        error: error.message || 'Failed to get today\'s queue'
      };
    }
  });

export default Interview;
