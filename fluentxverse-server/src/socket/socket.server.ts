import { Server as SocketIOServer } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import { chatHandler } from './handlers/chat.handler';
import { webrtcHandler } from './handlers/webrtc.handler';
import { sessionHandler } from './handlers/session.handler';
import { classroomMediaHandler } from './handlers/classroomMedia.handler';
import { highlightHandler } from './handlers/highlight.handler';
import { notificationHandler } from './handlers/notification.handler';
import { interviewHandler } from './handlers/interview.handler';
import { registerScheduleHandlers } from './handlers/schedule.handler';
import { ticketHandler } from './handlers/ticket.handler';
import { lessonHandler } from './handlers/lesson.handler';
import { authMiddleware } from './middleware/auth.middleware';
import { getAllowedOrigins, isAllowedOrigin } from '../config/cors';
import { SessionService } from '../services/session.services/session.service';

// Store the IO instance for access from other modules
let ioInstance: SocketIOServer | null = null;

/**
 * Get the Socket.IO server instance
 */
export const getIO = (): SocketIOServer | null => {
  return ioInstance;
};

export const initSocketServer = (httpServer: HTTPServer) => {
  const allowedOrigins = getAllowedOrigins(process.env.FRONTEND_URLS || process.env.FRONTEND_URL || '');

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin, allowedOrigins)) {
          callback(null, true);
          return;
        }

        console.warn(`⚠️ Socket.IO CORS blocked origin: ${origin}`);
        callback(new Error('Origin not allowed by Socket.IO CORS'));
      },
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma'],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Store the IO instance for global access
  ioInstance = io;

  const sessions = new SessionService();
  // This Socket.IO server owns classroom connections; old process socket IDs are invalid.
  let presenceRunning = false;
  const refreshPresence = async () => {
    if (presenceRunning) return;
    presenceRunning = true;
    try {
      const checkedAt = new Date();
      const liveIds = [...io.sockets.sockets.values()]
        .filter(socket => socket.data.sessionId && socket.rooms.has(socket.data.sessionId))
        .map(socket => socket.id);
      const departures = await sessions.reconcilePresence(liveIds, undefined, checkedAt);
      for (const departure of departures) {
        io.to(departure.session_id).emit('session:user-left', { userId: departure.user_id, userType: departure.user_type });
      }
    } finally { presenceRunning = false; }
  };
  const presenceReady = refreshPresence();
  void presenceReady.catch(error => console.error('Classroom presence initialization failed:', error));
  io.use(async (_socket, next) => {
    try {
      try { await presenceReady; } catch { await refreshPresence(); }
      next();
    }
    catch { next(new Error('Classroom presence is unavailable. Please reconnect shortly.')); }
  });
  const presenceTimer = setInterval(() => void refreshPresence().catch(error =>
    console.error('Classroom presence reconciliation failed:', error)), 5_000);
  presenceTimer.unref();
  io.httpServer?.once('close', () => clearInterval(presenceTimer));

  // Authentication middleware
  io.use(authMiddleware);

  io.on('connection', (socket) => {

    // Extract user info from socket (set by auth middleware)
    const userId = socket.data.userId;
    const userType = socket.data.userType;


    // Register event handlers
    chatHandler(io, socket);
    webrtcHandler(io, socket);
    sessionHandler(io, socket);
    classroomMediaHandler(io, socket);
    highlightHandler(io, socket);
    notificationHandler(io, socket);
    interviewHandler(io, socket);
    registerScheduleHandlers(io, socket);
    ticketHandler(io, socket);
    lessonHandler(io, socket);

    socket.on('disconnect', (reason) => {
    });

    socket.on('error', (error) => {
      console.error(`Socket error for ${socket.id}:`, error);
    });
  });

  return io;
};
