import Elysia from "elysia";
import { createServer } from "http";
import { swagger } from "@elysiajs/swagger";

import Auth from './routes/auth.route';
import Tutor from './routes/tutor.route';
import Schedule from './routes/schedule.route';
import LessonWorkflow from './routes/lessonWorkflow.route';
import { adminOperationsRoute } from './routes/adminOperations.route';
import { tutorEarningsRoute } from './routes/tutorEarnings.route';
import { testingChecklistRoute } from './routes/testingChecklist.route';
import { tutorCompensationFailure } from './services/admin.services/tutorCompensation.service';
import Examination from "./routes/exam.route";
import Admin from './routes/admin.route';
import Interview from './routes/interview.route';
import Notification from './routes/notification.route';
import Inbox from './routes/inbox.route';
import Ticket from './routes/ticket.route';
import Lesson from './routes/lesson.route';
import Proof from './routes/proof.route';
import Screening from './routes/screening.route';
import AnonymousReviews from './routes/anonymousReviews.route';
import LessonPasses from './routes/lessonPasses.route';
import { categoryRoute } from './routes/category.route';
import { mediaRoute } from './routes/media.route';
import { analyticsRoute } from './routes/analytics.route';
import { initDriver, getDriver } from './db/memgraph';
import { db } from './db/postgres';
import { initSocketServer } from './socket/socket.server';
import { startCancellationRefundJob } from './services/ticket.services/cancellationRefund.job';
import { startReminderService } from './services/notification.services/reminder.service';
import { NotificationService } from './services/notification.services/notification.service';
import { startSuspensionJob } from './services/admin.services/suspension.job';
import { startAttendanceJob } from './services/schedule.services/attendance.job';
import { startClassroomMediaReconciliation } from './services/classroomMedia.service';
import { startQaRecordingJobs } from './services/qaRecording.service';
import { qaRecordingRoute } from './routes/qaRecording.route';
import { initRedis, logRetentionCleanup, isRedisConnected } from './db/redis';
import cors from '@elysiajs/cors';
import cookie from '@elysiajs/cookie';
import Student from "./routes/student.route";
import { createMobileStudentRoutes, mobileStudentFailure } from './routes/mobileStudent.route';
import { mobileStudentDependencies } from './routes/mobileStudent.dependencies';
import Debug from './routes/debug.route';
import { lessonMaterialRoutes } from './routes/lessonMaterial.route';
import { dispatchRoutes } from './routes/dispatch.route';
import { youngLearnersRoute } from './routes/youngLearners.route';
import { aiRoute } from './routes/ai.route';
import { logger, generateRequestId } from './utils/logger';
import { getAllowedOrigins, isAllowedOrigin, isAllowedStudentOrigin, isAllowedStudentRequest } from './config/cors';

// Initialize databases (async)
const isProduction = process.env.NODE_ENV === 'production';

const initDatabases = async () => {
  // SECURITY: Require database credentials in production
  if (isProduction) {
    if (!process.env.MEMGRAPH_URI || !process.env.MEMGRAPH_PASSWORD) {
      console.error('❌ SECURITY: MEMGRAPH_URI and MEMGRAPH_PASSWORD required in production');
      process.exit(1);
    }
  }
  
  try {
    await initDriver(
      process.env.MEMGRAPH_URI || 'bolt://localhost:7687',
      process.env.MEMGRAPH_USER || 'fluentxverse',
      process.env.MEMGRAPH_PASSWORD || 'devpassword123!ChangeMe'
    );
  } catch (err) {
    console.error('❌ Failed to connect to Memgraph:', err);
    // Don't exit - some features can work without Memgraph
  }
};

// Start database initialization (will complete before suspension job runs)
const dbInitPromise = initDatabases();

// Initialize Redis cache
initRedis().catch(err => console.warn('Redis initialization skipped:', err));

// Bun SQL is auto-initialized on import (no need to call getPool)

const allowedOrigins = getAllowedOrigins(process.env.FRONTEND_URLS || '');


// Security: Maximum body size limit (10MB)
const MAX_BODY_SIZE = 10 * 1024 * 1024;

// Initialize Elysia app
const app = new Elysia({ 
  serve: { idleTimeout: 255 }
})
  // Security: Request body size limit middleware
  .onRequest(({ request, set }) => {
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_BODY_SIZE) {
      set.status = 413;
      return { 
        success: false, 
        error: 'Request body too large. Maximum size is 10MB.' 
      };
    }
  })
  .use(swagger({
    documentation: {
      info: {
        title: 'FluentXVerse API',
        version: '1.0.0',
        description: 'API documentation for FluentXVerse - Language learning platform connecting tutors and students',
        contact: {
          name: 'FluentXVerse Team',
          url: 'https://fluentxverse.com'
        }
      },
      tags: [
        { name: 'Auth', description: 'Tutor authentication endpoints' },
        { name: 'Student', description: 'Student authentication and profile endpoints' },
        { name: 'Tutor', description: 'Tutor profile and management endpoints' },
        { name: 'Schedule', description: 'Booking and scheduling endpoints' },
        { name: 'Lesson', description: 'Lesson content and materials endpoints' },
        { name: 'Exam', description: 'Speaking examination endpoints' },
        { name: 'Interview', description: 'Tutor interview scheduling endpoints' },
        { name: 'Notification', description: 'User notification endpoints' },
        { name: 'Inbox', description: 'System messages and announcements' },
        { name: 'Ticket', description: 'NFT ticket management endpoints' },
        { name: 'Admin', description: 'Admin dashboard endpoints' },
        { name: 'Category', description: 'Lesson category management' },
        { name: 'Media', description: 'Media file management' },
        { name: 'Analytics', description: 'Platform analytics endpoints' }
      ],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'tutorAuth',
            description: 'JWT token stored in httpOnly cookie'
          }
        }
      }
    },
    path: '/docs',
    exclude: ['/docs', '/docs/json', '/health'],
  }))
  .use(cors({
    origin: (request) => {
      const origin = request.headers.get('origin');
      const isStudentRoute = new URL(request.url).pathname.startsWith('/student/');
      const isAllowed = isAllowedOrigin(origin, allowedOrigins)
        && (!isStudentRoute || isAllowedStudentOrigin(origin));
      if (!isAllowed && origin) {
        console.warn(`⚠️ CORS blocked origin: ${origin}`);
      }
      return isAllowed;
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  }))
  .use(cookie())
  // Request logging middleware
  .onRequest(({ request, set }) => {
    const requestId = generateRequestId();
    (request as any).requestId = requestId;
    (request as any).startTime = Date.now();
    set.headers['X-Request-ID'] = requestId;

    // CORS only controls response visibility; reject disallowed browser
    // origins before a same-site form request can mutate student state.
    if (new URL(request.url).pathname.startsWith('/student/')
      && !isAllowedStudentRequest(request.headers.get('origin'), request.method)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid student origin' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  })
  .onAfterHandle(({ request, set }) => {
    const duration = Date.now() - ((request as any).startTime || Date.now());
    const path = new URL(request.url).pathname;
    
    // Skip logging for health checks and static assets
    if (path === '/health' || path.startsWith('/docs') || path.startsWith('/anonymous-reviews/') || path.startsWith('/lesson-passes/')) return;
    
    logger.response({
      method: request.method,
      path,
      statusCode: 200,
      duration,
      requestId: (request as any).requestId,
    });
  })
  .onError(({ request, error, set, code }) => {
    const duration = Date.now() - ((request as any).startTime || Date.now());
    const path = new URL(request.url).pathname;
    const requestId = (request as any).requestId;
    if (path.startsWith('/mobile/student/')) {
      const response = mobileStudentFailure(error, String(code));
      set.status = response.status;
      set.headers['Cache-Control'] = 'no-store';
      return response.body;
    }
    if (path.startsWith('/admin/operations/compensation')) {
      const response = tutorCompensationFailure(error, code);
      set.status = response.status;
      return response.body;
    }
    if (path.startsWith('/anonymous-reviews/') || path.startsWith('/lesson-passes/')) {
      set.status = ['VALIDATION', 'PARSE'].includes(String(code)) ? 400 : String(code) === 'NOT_FOUND' ? 404 : 503;
      return { success: false, error: 'Review request could not be processed' };
    }
    
    // Determine appropriate status code
    let statusCode = 500;
    let userMessage = 'An unexpected error occurred. Please try again.';
    
    // Handle Elysia error codes
    const errorCode = String(code);
    if (errorCode === 'VALIDATION') {
      statusCode = 400;
      userMessage = 'Invalid request data. Please check your input.';
    } else if (errorCode === 'NOT_FOUND') {
      statusCode = 404;
      userMessage = 'The requested resource was not found.';
    } else if (errorCode === 'PARSE') {
      statusCode = 400;
      userMessage = 'Invalid request format.';
    }
    
    // Handle specific error messages
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Auth-related errors
    if (errorMessage.includes('Invalid email or password')) {
      statusCode = 401;
      userMessage = 'Invalid email or password. Please check your credentials.';
    } else if (errorMessage.includes('Not authenticated') || errorMessage.includes('Invalid or expired token')) {
      statusCode = 401;
      userMessage = 'Your session has expired. Please log in again.';
    } else if (errorMessage.includes('account is suspended')) {
      statusCode = 403;
      userMessage = errorMessage; // Keep the suspension details
    } else if (errorMessage.includes('EMAIL_EXISTS') || errorMessage.includes('already registered')) {
      statusCode = 409;
      userMessage = 'This email is already registered. Please use a different email or try logging in.';
    }
    
    // Rate limiting
    else if (errorMessage.includes('Rate limit') || errorMessage.includes('Too many requests')) {
      statusCode = 429;
      userMessage = 'Too many requests. Please wait a moment and try again.';
    }
    
    // Database connection errors
    else if (errorMessage.includes('connection') || errorMessage.includes('ECONNREFUSED')) {
      statusCode = 503;
      userMessage = 'Service temporarily unavailable. Please try again in a moment.';
    }
    
    // Validation errors from services
    else if (errorMessage.includes('required') || errorMessage.includes('invalid') || errorMessage.includes('must be')) {
      statusCode = 400;
      userMessage = errorMessage;
    }
    
    // Set the status code
    set.status = statusCode;
    
    // Log the error (with full details for debugging)
    logger.error('Request failed', error, {
      method: request.method,
      path,
      duration,
      requestId,
      statusCode,
      errorCode: code,
    });
    
    // Return user-friendly JSON response
    return {
      success: false,
      error: userMessage,
      requestId, // Include for support/debugging
      statusCode,
    };
  })
  // Security headers middleware
  .onAfterHandle(({ set }) => {
    // Prevent clickjacking attacks
    set.headers['X-Frame-Options'] = 'DENY';
    // Prevent MIME type sniffing
    set.headers['X-Content-Type-Options'] = 'nosniff';
    // Enable XSS filter in browsers
    set.headers['X-XSS-Protection'] = '1; mode=block';
    // Referrer policy for privacy
    set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
    // Permissions policy - restrict sensitive features
    set.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()';
    // Content Security Policy - prevent XSS and injection attacks
    set.headers['Content-Security-Policy'] = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https: blob:",
      "media-src 'self' https: blob:",
      "connect-src 'self' wss: ws: https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ');
    // HSTS in production
    if (isProduction) {
      set.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload';
    }
  })
  .use(Auth)
  .use(Tutor)
  .use(Schedule)
  .use(LessonWorkflow)
  .use(adminOperationsRoute)
  .use(tutorEarningsRoute)
  .use(testingChecklistRoute)
  .use(Student)
  .use(createMobileStudentRoutes(mobileStudentDependencies))
  .use(Debug)
  .use(Examination)
  .use(Admin)
  .use(qaRecordingRoute)
  .use(Interview)
  .use(Notification)
  .use(Inbox)
  .use(Ticket)
  .use(Lesson)
  .use(Proof)
  .use(Screening)
  .use(AnonymousReviews)
  .use(LessonPasses)
  .use(lessonMaterialRoutes)
  .use(dispatchRoutes)
  .use(youngLearnersRoute)
  .use(aiRoute)
  .use(categoryRoute)
  .use(mediaRoute)
  .use(analyticsRoute)
  // Simple health check for load balancers
  .get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))
  // Detailed health check with dependency status
  .get('/health/detailed', async () => {
    const checks: Record<string, { status: 'ok' | 'degraded' | 'down'; latency?: number; error?: string }> = {};
    
    // Check PostgreSQL
    const pgStart = Date.now();
    try {
      await db`SELECT 1`;
      checks.postgres = { status: 'ok', latency: Date.now() - pgStart };
    } catch (err: any) {
      checks.postgres = { status: 'down', error: err.message };
    }
    
    // Check Memgraph
    const mgStart = Date.now();
    try {
      const driver = getDriver();
      const session = driver.session();
      await session.run('RETURN 1');
      await session.close();
      checks.memgraph = { status: 'ok', latency: Date.now() - mgStart };
    } catch (err: any) {
      checks.memgraph = { status: 'down', error: err.message };
    }
    
    // Check Redis
    checks.redis = {
      status: isRedisConnected() ? 'ok' : 'degraded',
      latency: 0
    };
    
    // Determine overall status
    const allOk = Object.values(checks).every(c => c.status === 'ok');
    const anyDown = Object.values(checks).some(c => c.status === 'down');
    
    return {
      status: allOk ? 'ok' : anyDown ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.APP_VERSION || '1.0.0',
      checks
    };
  })


// Start HTTP server - listen on all interfaces for LAN access
.listen({ hostname: '0.0.0.0', port: 8765, maxRequestBodySize: 100 * 1024 * 1024 }, () => {
});


export type App = typeof app;

// Initialize Socket.IO server with the HTTP server
// @ts-ignore - Elysia's server has an underlying HTTP server
const httpServer = createServer();
const io = initSocketServer(httpServer);

// Attach Socket.IO to run alongside Elysia - listen on all interfaces for LAN access
httpServer.listen(8767, '0.0.0.0', async () => {
  
  // Wait for database initialization to complete before starting background jobs
  await dbInitPromise;
  
  // Start the session reminder service after socket is ready
  startReminderService();
  
  // Start the auto-unsuspend background job (now Memgraph is ready)
  startSuspensionJob();
  startAttendanceJob();
  startClassroomMediaReconciliation();
  startQaRecordingJobs();
  startCancellationRefundJob();

  // Start daily notification retention cleanup (delete read > N days)
  const notificationService = new NotificationService();
  const daysToKeep = parseInt(process.env.NOTIFICATION_RETENTION_DAYS || '30', 10);
  // Run once a day
  setInterval(async () => {
    try {
      const deleted = await notificationService.deleteOldNotifications(daysToKeep);
      if (deleted > 0) {
        await logRetentionCleanup(deleted);
      }
    } catch (err) {
      console.error('Error running notification retention cleanup:', err);
    }
  }, 24 * 60 * 60 * 1000);
  // Also run once on startup
  (async () => {
    try {
      const deleted = await notificationService.deleteOldNotifications(daysToKeep);
      if (deleted > 0) {
        await logRetentionCleanup(deleted);
      }
    } catch {}
  })();
});
