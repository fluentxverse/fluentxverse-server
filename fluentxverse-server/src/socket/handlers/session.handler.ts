import type { Server, Socket } from 'socket.io';
import { canEnterClassroom } from '../classroomTiming';
import { scheduleClassroomExpiry } from '../classroomExpiry';
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from '../types/socket.types';
import { recordMediaObservation } from '../../services/classroomMediaObservation.service';
import { SessionService } from '../../services/session.services/session.service';
import { ClassroomActivityService } from '../../services/classroomActivity.services/classroomActivity.service';
import { ScheduleService } from '../../services/schedule.services/schedule.service';
import { lessonSurveyService } from '../../services/lessonSurvey.service';
import { classroomMediaService } from '../../services/classroomMedia.service';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const sessionService = new SessionService();
const classroomActivityService = new ClassroomActivityService();
// In-memory fallback store for dev or DB-down scenarios
// Key: sessionId, Value: { tutor?: participant, student?: participant }
const memParticipants: Record<string, { 
  tutor?: { user_id: string; socket_id: string; user_type: 'tutor' };
  student?: { user_id: string; socket_id: string; user_type: 'student' };
}> = {};

export const sessionHandler = (io: TypedServer, socket: TypedSocket) => {
  if (socket.data.userType === 'admin') return;
  let cancelExpiry: (() => void) | undefined;
  const notifySurveyReady = async (sessionId: string, tutorId: string, reason: 'ended' | 'left') => {
    try {
      if (await lessonSurveyService.markReady(sessionId, tutorId, reason))
        socket.to(sessionId).emit('session:survey-ready', { sessionId, reason });
    } catch (error) {
      console.warn('Failed to enable lesson survey:', (error as Error)?.message);
    }
  };
  const logActivity = async (
    sessionId: string,
    userId: string,
    userType: 'tutor' | 'student',
    eventType: 'entered' | 'left' | 'lesson_ended',
    message?: string
  ) => {
    try {
      const activity = await classroomActivityService.log({
        sessionId,
        userId,
        userType,
        eventType,
        message
      });
      io.to(sessionId).emit('classroom:activity-log', activity);
      return activity;
    } catch (error) {
      console.warn('Failed to persist classroom activity:', (error as Error)?.message);
      return null;
    }
  };

  // Join a session
  socket.on('session:join', async (data) => {
    try {
      const { sessionId } = data;
      const userId = socket.data.userId;
      const userType = socket.data.userType as 'tutor' | 'student';

      if (typeof sessionId !== 'string' || !sessionId || !['tutor', 'student'].includes(userType)) {
        socket.emit('session:error', { message: 'Invalid lesson room' });
        return;
      }

      const schedule = await new ScheduleService().getClassroomSchedule(sessionId, userId, userType);
      if (!schedule) {
        socket.emit('session:error', { message: 'You do not have access to this lesson' });
        return;
      }
      if (!canEnterClassroom(schedule.startsAt, schedule.endsAt)) {
        socket.emit('session:error', { message: Date.now() < schedule.startsAt ? 'The classroom opens five minutes before the scheduled lesson.' : 'This lesson has ended.' });
        return;
      }

      if (userType === 'tutor') {
        const ownsBooking = await new ScheduleService().markTutorRoomEntry(sessionId, userId);
        if (!ownsBooking) {
          socket.emit('session:error', { message: 'You do not have access to this lesson' });
          return;
        }
      } else if (!await new ScheduleService().canStudentJoinRoom(sessionId, userId)) {
        socket.emit('session:error', { message: 'You do not have access to this lesson' });
        return;
      }

      if (socket.data.sessionId && socket.data.sessionId !== sessionId) {
        await socket.leave(socket.data.sessionId);
        await sessionService.removeParticipant(socket.data.sessionId, userId, userType, socket.id);
        delete socket.data.callState;
        delete socket.data.callUpdatedAt;
      }

      const mediaProvider = await classroomMediaService.provider(sessionId, userId, userType, schedule.endsAt);

      const existingSockets = await io.in(sessionId).fetchSockets();
      for (const existing of existingSockets) {
        if (existing.id !== socket.id && existing.data.userId === userId) {
          await existing.leave(sessionId);
          existing.data.sessionId = undefined;
        }
      }

      // Join the socket.io room
      await socket.join(sessionId);
      // Recheck after joining: cancellation can race the first authorization query.
      if (!socket.connected || !await new ScheduleService().getClassroomSchedule(sessionId, userId, userType)) {
        await socket.leave(sessionId);
        socket.emit('session:error', { message: 'This lesson is no longer available.' });
        return;
      }
      socket.data.sessionId = sessionId;
      socket.data.mediaProvider = mediaProvider;
      socket.data.lessonStartsAt = schedule.startsAt;
      socket.data.lessonEndsAt = schedule.endsAt;
      if (userType === 'tutor') await lessonSurveyService.clearDepartureReadiness(sessionId, userId);
      cancelExpiry?.();
      cancelExpiry = scheduleClassroomExpiry(socket, sessionId, schedule.endsAt);

      let participants: Array<{ user_id: string; socket_id: string; user_type: 'tutor' | 'student' }> = [];
      try {
        // Preferred: persist to database
        await sessionService.addParticipant({
          sessionId,
          userId,
          socketId: socket.id,
          userType
        });
        participants = await sessionService.getSessionParticipants(sessionId);
      } catch (err) {
        // Fallback: use in-memory participants to keep signaling working in dev
        // Initialize session if not exists
        if (!memParticipants[sessionId]) {
          memParticipants[sessionId] = {};
        }
        
        // Update the participant for this user type (replaces any previous)
        (memParticipants[sessionId] as any)[userType] = { 
          user_id: userId, 
          socket_id: socket.id, 
          user_type: userType 
        };
        
        // Convert to array format
        const session = memParticipants[sessionId];
        if (session.tutor) participants.push(session.tutor);
        if (session.student) participants.push(session.student);
        
        console.warn('⚠️ Using in-memory session participants due to DB error:', (err as Error)?.message);
      }
      
      // Prepare session state
      const sessionState = {
        sessionId,
        mediaProvider,
        startsAt: new Date(schedule.startsAt).toISOString(),
        endsAt: new Date(schedule.endsAt).toISOString(),
        serverNow: new Date().toISOString(),
        participants: {
          tutorId: participants.find(p => p.user_type === 'tutor')?.user_id,
          studentId: participants.find(p => p.user_type === 'student')?.user_id,
          tutorSocketId: participants.find(p => p.user_type === 'tutor')?.socket_id,
          studentSocketId: participants.find(p => p.user_type === 'student')?.socket_id
        },
        status: participants.length === 2 ? 'active' : 'waiting'
      } as const;

      // Notify all users in the session
      io.to(sessionId).emit('session:user-joined', {
        userId,
        userType
      });
      await logActivity(sessionId, userId, userType, 'entered');

      // Send session state to all participants
      io.to(sessionId).emit('session:state', sessionState);

    } catch (error) {
      console.error('Error handling session:join:', error);
      socket.emit('session:error', { message: 'Unable to join the lesson right now' });
    }
  });

  socket.on('classroom:call-state', (data) => {
    if (!socket.data.sessionId || !socket.rooms.has(socket.data.sessionId) || typeof data?.connected !== 'boolean') return;
    if (socket.data.userType === 'admin') return;
    const next = data.connected ? 'connected' : 'disconnected';
    if (next === socket.data.callState) return;
    socket.data.callState = data.connected ? 'connected' : 'disconnected';
    socket.data.callUpdatedAt = new Date().toISOString();
    void recordMediaObservation(socket.data.sessionId, socket.data.userId, socket.data.userType, data.connected).catch(e => console.error('Media observation could not be saved:', e));
  });
  socket.on('classroom:video-state', (data) => {
    try {
      const sessionId = socket.data.sessionId;
      if (!sessionId || !socket.rooms.has(sessionId)) return;

      const payload = {
        sessionId,
        userId: socket.data.userId,
        userType: socket.data.userType as 'tutor' | 'student',
        enabled: data.enabled
      };

      socket.to(sessionId).emit('classroom:video-state', payload);
      io.sockets.sockets.forEach((clientSocket) => {
        if (clientSocket.id !== socket.id && clientSocket.data.sessionId === sessionId) {
          clientSocket.emit('classroom:video-state', payload);
        }
      });
    } catch (error) {
      console.error('Error handling classroom:video-state:', error);
    }
  });

  // Leave a session
  socket.on('session:leave', async () => {
    try {
      const sessionId = socket.data.sessionId;
      const userId = socket.data.userId;
      const userType = socket.data.userType as 'tutor' | 'student';

      if (!sessionId) {
        return;
      }

      // Remove only the participant represented by this socket.
      let removed = false;
      try {
        removed = await sessionService.removeParticipant(sessionId, userId, userType, socket.id);
      } catch (err) {
        // Remove from in-memory store
        if (memParticipants[sessionId]?.[userType]?.socket_id === socket.id) {
          delete memParticipants[sessionId][userType];
          removed = true;
        }
      }

      // Leave the socket.io room
      await socket.leave(sessionId);
      socket.data.sessionId = undefined;
      cancelExpiry?.();
      socket.data.lessonStartsAt = undefined;
      socket.data.lessonEndsAt = undefined;

      // Notify others in the session
      if (!removed) return;
      if (userType === 'tutor') await notifySurveyReady(sessionId, userId, 'left');
      socket.to(sessionId).emit('webrtc:peer-left');
      socket.to(sessionId).emit('session:user-left', {
        userId,
        userType
      });
      await logActivity(sessionId, userId, userType, 'left');

      // Get remaining participants
      let participants: Array<{ user_id: string; socket_id: string; user_type: 'tutor' | 'student' }> = [];
      try {
        participants = await sessionService.getSessionParticipants(sessionId);
      } catch {
        // Convert in-memory format to array
        const session = memParticipants[sessionId];
        if (session) {
          if (session.tutor) participants.push(session.tutor);
          if (session.student) participants.push(session.student);
        }
      }
      
      // Send updated session state
      const sessionState = {
        sessionId,
        mediaProvider: socket.data.mediaProvider,
        participants: {
          tutorId: participants.find(p => p.user_type === 'tutor')?.user_id,
          studentId: participants.find(p => p.user_type === 'student')?.user_id,
          tutorSocketId: participants.find(p => p.user_type === 'tutor')?.socket_id,
          studentSocketId: participants.find(p => p.user_type === 'student')?.socket_id
        },
        status: participants.length === 2 ? 'active' : 'waiting'
      } as const;

      io.to(sessionId).emit('session:state', sessionState);

    } catch (error) {
      console.error('Error handling session:leave:', error);
    }
  });

  // Handle tutor ending the lesson (signals to student that lesson time is over)
  socket.on('session:end-lesson', async (data) => {
    try {
      const sessionId = socket.data.sessionId;
      const userId = socket.data.userId;
      const userType = socket.data.userType as 'tutor' | 'student';

      if (!sessionId) {
        console.error('No session ID found for end-lesson');
        return;
      }

      // Only tutors can end lessons
      if (userType !== 'tutor') {
        console.error('Only tutors can end lessons');
        return;
      }

      if (socket.data.mediaProvider === 'realtimekit') {
        try { await classroomMediaService.close(sessionId); }
        catch { console.warn('Lesson media closure will be retried by reconciliation'); }
      }

      // Notify the student that the lesson has ended
      await notifySurveyReady(sessionId, userId, 'ended');
      socket.to(sessionId).emit('session:lesson-ended', {
        tutorId: userId,
        message: data?.message || 'The tutor has ended the lesson. Thank you for learning with us!'
      });
      await logActivity(sessionId, userId, 'tutor', 'lesson_ended', 'Tutor ended the lesson.');

    } catch (error) {
      console.error('Error handling session:end-lesson:', error);
    }
  });

  socket.on('classroom:request-activity-history', async (data) => {
    try {
      const { sessionId } = data;
      if (!sessionId || socket.data.sessionId !== sessionId) return;
      const history = await classroomActivityService.getSessionActivity(sessionId);
      socket.emit('classroom:activity-history', history);
    } catch (error) {
      console.error('Error handling classroom:request-activity-history:', error);
      socket.emit('classroom:activity-history', []);
    }
  });

  // Handle disconnect (automatic leave)
  socket.on('disconnect', async () => {
    cancelExpiry?.();
    try {
      const sessionId = socket.data.sessionId;
      const userId = socket.data.userId;
      const userType = socket.data.userType as 'tutor' | 'student';

      if (sessionId) {
        if (socket.data.callState === 'connected') {
          await recordMediaObservation(sessionId, userId, userType, false).catch(e => console.error('Media disconnect observation could not be saved:', e));
        }
        let removed = false;
        try {
          removed = await sessionService.removeParticipant(sessionId, userId, userType, socket.id);
        } catch {
          // Remove from in-memory store
          if (memParticipants[sessionId]?.[userType]?.socket_id === socket.id) {
            delete memParticipants[sessionId][userType];
            removed = true;
          }
        }

        if (!removed) return;
        if (userType === 'tutor' && socket.data.lessonEndsAt && Date.now() >= socket.data.lessonEndsAt)
          await notifySurveyReady(sessionId, userId, 'left');
        socket.to(sessionId).emit('webrtc:peer-left');
        socket.to(sessionId).emit('session:user-left', {
          userId,
          userType
        });
        await logActivity(sessionId, userId, userType, 'left');

      }
    } catch (error) {
      console.error('Error handling disconnect cleanup:', error);
    }
  });
};
