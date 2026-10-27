import Elysia, { t } from 'elysia';
import { AdminService } from '../services/admin.services/admin.service';
import { suspensionJobService } from '../services/admin.services/suspension.job';
import { signAuthToken, verifyAuthToken, getCookieConfig } from '../utils/jwt';
import { createAdminGuard } from '../middleware/auth.middleware';
import { rateLimitMiddleware } from '../utils/rateLimiter';
import { retryTutorCertificationZkVerifySubmission } from '../services/proof.services/tutorCertificationWorkflow.service';
import { LegacyProofRetiredError } from '../services/proof.services/legacyProofRetirement';
import { adminTaskService } from '../services/admin.services/adminTask.service';

const adminService = new AdminService();

// Helper to get client IP for rate limiting
const getClientIp = (request: Request): string => {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         request.headers.get('x-real-ip') ||
         'unknown';
};

// Public routes that don't require authentication
const publicRoutes = ['/admin/login'];

const Admin = new Elysia({ prefix: '/admin' })
  // Global authentication guard for all admin routes
  .onBeforeHandle(async ({ path, cookie, set, request }) => {
    // Skip auth for public routes
    if (publicRoutes.some(route => path === route)) {
      return;
    }
    
    // All other admin routes require authentication
    const adminPayload = await createAdminGuard(cookie, set);
    if (!adminPayload) {
      return {
        success: false,
        error: 'Unauthorized - Admin authentication required'
      };
    }
    if (!['GET', 'HEAD'].includes(request.method) && !['/admin/login', '/admin/logout', '/admin/me', '/admin/change-password', '/admin/profile'].includes(path)) {
      const capability = path.includes('/tutors') || path.includes('/students') ? 'support' : 'operations';
      if (!await createAdminGuard(cookie, set, capability)) return { success: false, error: `${capability} permission required` };
    }
    
    // Store admin info in request context for use in handlers
    return;
  })
  .get('/socket-token', async ({ cookie, set }) => {
    const admin = await createAdminGuard(cookie, set);
    if (!admin) return { success: false, error: 'Unauthorized' };
    const token = await signAuthToken({
      userId: admin.userId,
      email: admin.email,
      role: 'admin'
    }, 10 * 60);
    set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
    set.headers['Pragma'] = 'no-cache';
    return { success: true, token };
  })
  .get('/tasks', async ({ cookie, set }) => {
    const admin = await createAdminGuard(cookie, set);
    if (!admin) return { success: false, error: 'Unauthorized' };
    try {
      return { success: true, data: await adminTaskService.list() };
    } catch (error) {
      console.error('Failed to list admin tasks:', error);
      set.status = 500;
      return { success: false, error: 'Failed to load tasks' };
    }
  })
  .get('/tasks/assignees', async ({ cookie, set }) => {
    const admin = await createAdminGuard(cookie, set);
    if (!admin) return { success: false, error: 'Unauthorized' };
    try {
      const admins = await adminService.listAdmins();
      return { success: true, data: admins.map(({ id, username, firstName, lastName }) => ({ id, username, firstName, lastName })) };
    } catch (error) {
      console.error('Failed to list task assignees:', error);
      set.status = 500;
      return { success: false, error: 'Failed to load admins' };
    }
  })
  .post('/tasks', async ({ body, cookie, set }) => {
    const admin = await createAdminGuard(cookie, set);
    if (!admin) return { success: false, error: 'Unauthorized' };
    if (!body.title.trim()) {
      set.status = 400;
      return { success: false, error: 'Title is required' };
    }
    try {
      if (!await adminService.getById(body.assigneeId)) {
        set.status = 400;
        return { success: false, error: 'Assignee is not an active admin' };
      }
      const task = await adminTaskService.create(body.title.trim(), body.description.trim(), body.kind, admin.userId, body.assigneeId);
      set.status = 201;
      return { success: true, data: task };
    } catch (error) {
      console.error('Failed to create admin task:', error);
      set.status = 500;
      return { success: false, error: 'Failed to create task' };
    }
  }, { body: t.Object({ title: t.String({ minLength: 1, maxLength: 200 }), description: t.String({ maxLength: 5000 }), kind: t.Union([t.Literal('task'), t.Literal('suggestion')]), assigneeId: t.String({ minLength: 1 }) }) })
  .patch('/tasks/:id/assignee', async ({ params, body, cookie, set }) => {
    const admin = await createAdminGuard(cookie, set);
    if (!admin) return { success: false, error: 'Unauthorized' };
    try {
      if (!await adminService.getById(body.assigneeId)) {
        set.status = 400;
        return { success: false, error: 'Assignee is not an active admin' };
      }
      const task = await adminTaskService.assign(params.id, body.assigneeId, admin.userId);
      if (!task) {
        set.status = 404;
        return { success: false, error: 'Task not found' };
      }
      return { success: true, data: task };
    } catch (error) {
      console.error('Failed to assign admin task:', error);
      set.status = 500;
      return { success: false, error: 'Failed to assign task' };
    }
  }, { params: t.Object({ id: t.String({ format: 'uuid' }) }), body: t.Object({ assigneeId: t.String({ minLength: 1 }) }) })
  .patch('/tasks/:id/status', async ({ params, body, cookie, set }) => {
    const admin = await createAdminGuard(cookie, set);
    if (!admin) return { success: false, error: 'Unauthorized' };
    try {
      const task = await adminTaskService.updateStatus(params.id, body.status, admin.userId);
      if (!task) {
        set.status = 404;
        return { success: false, error: 'Task not found' };
      }
      return { success: true, data: task };
    } catch (error) {
      console.error('Failed to update admin task:', error);
      set.status = 500;
      return { success: false, error: 'Failed to update task' };
    }
  }, { params: t.Object({ id: t.String({ format: 'uuid' }) }), body: t.Object({ status: t.Union([t.Literal('pending'), t.Literal('in_progress'), t.Literal('completed'), t.Literal('rejected')]) }) })
  /**
   * Get dashboard overview stats
   * GET /admin/stats
   */
  .get('/stats', async () => {
    try {
      const stats = await adminService.getDashboardStats();
      return {
        success: true,
        data: stats
      };
    } catch (error) {
      console.error('Error in /admin/stats:', error);
      return {
        success: false,
        error: 'Failed to get dashboard stats'
      };
    }
  })

  /**
   * Get exam statistics
   * GET /admin/exam-stats
   */
  .get('/exam-stats', async () => {
    try {
      const stats = await adminService.getExamStats();
      return {
        success: true,
        data: stats
      };
    } catch (error) {
      console.error('Error in /admin/exam-stats:', error);
      return {
        success: false,
        error: 'Failed to get exam stats'
      };
    }
  })

  /**
   * Get pending tutors (not fully certified)
   * GET /admin/pending-tutors
   */
  .get('/pending-tutors', async ({ query }) => {
    try {
      const limit = query.limit ? Number(query.limit) : 10;
      const tutors = await adminService.getPendingTutors(limit);
      return {
        success: true,
        data: tutors
      };
    } catch (error) {
      console.error('Error in /admin/pending-tutors:', error);
      return {
        success: false,
        error: 'Failed to get pending tutors'
      };
    }
  })

  /**
   * Get pending profile reviews (tutors who submitted their profile)
   * GET /admin/pending-profiles
   */
  .get('/pending-profiles', async ({ query }) => {
    try {
      const limit = query.limit ? Number(query.limit) : 20;
      const profiles = await adminService.getPendingProfileReviews(limit);
      return {
        success: true,
        data: profiles
      };
    } catch (error) {
      console.error('Error in /admin/pending-profiles:', error);
      return {
        success: false,
        error: 'Failed to get pending profiles'
      };
    }
  })

  /**
   * Approve or reject a tutor profile
   * POST /admin/profile/:tutorId/review
   */
  .post('/profile/:tutorId/review', async ({ params, body, cookie, set }) => {
    const reviewer = await createAdminGuard(cookie, set, 'operations');
    if (!reviewer) return { success: false, error: 'Unauthorized' };
    try {
      const { tutorId } = params;
      const { action, reason } = body as { action: 'approve' | 'reject'; reason?: string };

      if (!action || !['approve', 'reject'].includes(action)) {
        return { success: false, error: 'Invalid action. Must be "approve" or "reject"' };
      }

      await adminService.reviewTutorProfile(tutorId, action, reason, reviewer.userId);

      return { 
        success: true, 
        message: `Profile ${action === 'approve' ? 'approved' : 'rejected'} successfully` 
      };
    } catch (error) {
      console.error('Error in /admin/profile/:tutorId/review:', error);
      return { success: false, error: 'Failed to review profile' };
    }
  })

  /**
   * Approve or reject a specific profile item
   * POST /admin/profile/:tutorId/review-item
   */
  .post('/profile/:tutorId/review-item', async ({ params, body, cookie, set }) => {
    const reviewer = await createAdminGuard(cookie, set, 'operations');
    if (!reviewer) return { success: false, error: 'Unauthorized' };
    try {
      const { tutorId } = params;
      const { itemKey, action, reason } = body as { 
        itemKey: 'profilePicture' | 'videoIntro' | 'bio' | 'education' | 'interests';
        action: 'approve' | 'reject'; 
        reason?: string 
      };

      const validItems = ['profilePicture', 'videoIntro', 'bio', 'education', 'interests'];
      if (!itemKey || !validItems.includes(itemKey)) {
        return { success: false, error: 'Invalid item key' };
      }

      if (!action || !['approve', 'reject'].includes(action)) {
        return { success: false, error: 'Invalid action. Must be "approve" or "reject"' };
      }

      const result = await adminService.reviewProfileItem(tutorId, itemKey, action, reason, reviewer.userId);

      return { 
        success: true, 
        message: `${itemKey} ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
        data: result
      };
    } catch (error) {
      console.error('Error in /admin/profile/:tutorId/review-item:', error);
      return { success: false, error: 'Failed to review profile item' };
    }
  })

  /**
   * Get tutors with pending profile changes
   * GET /admin/pending-changes
   */
  .get('/pending-changes', async ({ query }) => {
    try {
      const limit = query.limit ? Number(query.limit) : 20;
      const tutors = await adminService.getTutorsWithPendingChanges(limit);
      return {
        success: true,
        data: tutors
      };
    } catch (error) {
      console.error('Error in /admin/pending-changes:', error);
      return { success: false, error: 'Failed to get pending changes' };
    }
  })

  /**
   * Review a pending profile change for an approved tutor
   * POST /admin/profile/:tutorId/review-change
   */
  .post('/profile/:tutorId/review-change', async ({ params, body }) => {
    try {
      const { tutorId } = params;
      const { changeIndex, action, reason } = body as { 
        changeIndex: number;
        action: 'approve' | 'reject'; 
        reason?: string 
      };

      if (typeof changeIndex !== 'number' || changeIndex < 0) {
        return { success: false, error: 'Invalid change index' };
      }

      if (!action || !['approve', 'reject'].includes(action)) {
        return { success: false, error: 'Invalid action. Must be "approve" or "reject"' };
      }

      const result = await adminService.reviewPendingChange(tutorId, changeIndex, action, reason);

      return { 
        success: true, 
        message: `Change ${action === 'approve' ? 'approved and applied' : 'rejected'} successfully`,
        data: result
      };
    } catch (error) {
      console.error('Error in /admin/profile/:tutorId/review-change:', error);
      return { success: false, error: 'Failed to review change' };
    }
  })

  /**
   * Get all tutors with filters
   * GET /admin/tutors
   */
  .get('/tutors', async ({ query }) => {
    try {
      const params = {
        page: query.page ? Number(query.page) : 1,
        limit: query.limit ? Number(query.limit) : 20,
        status: (query.status as 'all' | 'certified' | 'pending' | 'processing' | 'failed' | 'suspended' | 'pending_profile') || 'all',
        search: query.search || ''
      };
      const result = await adminService.getTutors(params);
      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('Error in /admin/tutors:', error);
      return {
        success: false,
        error: 'Failed to get tutors'
      };
    }
  })

  /**
   * Retry tutor certification zkVerify submission.
   * POST /admin/tutors/:tutorId/proof/retry
   */
  .post('/tutors/:tutorId/proof/retry', async ({ params, set }) => {
    try {
      const result = await retryTutorCertificationZkVerifySubmission(params.tutorId);
      return {
        success: true,
        data: result,
        message: 'Tutor certification proof submitted to zkVerify',
      };
    } catch (error) {
      console.error('Error in /admin/tutors/:tutorId/proof/retry:', error);
      set.status = error instanceof LegacyProofRetiredError ? 410 : 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retry tutor certification proof submission',
      };
    }
  })

  /**
   * Suspend a tutor
   * POST /admin/tutors/:tutorId/suspend
   */
  .post('/tutors/:tutorId/suspend', async ({ params, body }) => {
    try {
      const { tutorId } = params;
      const { reason, until } = body as { reason: string; until: string };
      
      if (!reason || !until) {
        return {
          success: false,
          error: 'Reason and suspension end date are required'
        };
      }

      await adminService.suspendTutor(tutorId, reason, new Date(until));
      return {
        success: true,
        data: { message: 'Tutor suspended successfully' }
      };
    } catch (error) {
      console.error('Error in /admin/tutors/:tutorId/suspend:', error);
      return {
        success: false,
        error: 'Failed to suspend tutor'
      };
    }
  }, {
    body: t.Object({
      reason: t.String(),
      until: t.String()
    })
  })

  /**
   * Unsuspend a tutor
   * POST /admin/tutors/:tutorId/unsuspend
   */
  .post('/tutors/:tutorId/unsuspend', async ({ params }) => {
    try {
      const { tutorId } = params;
      await adminService.unsuspendTutor(tutorId);
      return {
        success: true,
        data: { message: 'Tutor unsuspended successfully' }
      };
    } catch (error) {
      console.error('Error in /admin/tutors/:tutorId/unsuspend:', error);
      return {
        success: false,
        error: 'Failed to unsuspend tutor'
      };
    }
  })

  /**
   * Get all students with filters
   * GET /admin/students
   */
  .get('/students', async ({ query }) => {
    try {
      const params = {
        page: query.page ? Number(query.page) : 1,
        limit: query.limit ? Number(query.limit) : 20,
        status: (query.status as 'all' | 'active' | 'inactive') || 'all',
        search: query.search || ''
      };
      const result = await adminService.getStudents(params);
      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('Error in /admin/students:', error);
      return {
        success: false,
        error: 'Failed to get students'
      };
    }
  })

  /**
   * Suspend a student
   * POST /admin/students/:studentId/suspend
   */
  .post('/students/:studentId/suspend', async ({ params, body }) => {
    try {
      const { studentId } = params;
      const { reason, until } = body as { reason: string; until: string };
      
      if (!reason || !until) {
        return {
          success: false,
          error: 'Reason and suspension end date are required'
        };
      }

      await adminService.suspendStudent(studentId, reason, new Date(until));
      return {
        success: true,
        data: { message: 'Student suspended successfully' }
      };
    } catch (error) {
      console.error('Error in /admin/students/:studentId/suspend:', error);
      return {
        success: false,
        error: 'Failed to suspend student'
      };
    }
  }, {
    body: t.Object({
      reason: t.String(),
      until: t.String()
    })
  })

  /**
   * Unsuspend a student
   * POST /admin/students/:studentId/unsuspend
   */
  .post('/students/:studentId/unsuspend', async ({ params }) => {
    try {
      const { studentId } = params;
      await adminService.unsuspendStudent(studentId);
      return {
        success: true,
        data: { message: 'Student unsuspended successfully' }
      };
    } catch (error) {
      console.error('Error in /admin/students/:studentId/unsuspend:', error);
      return {
        success: false,
        error: 'Failed to unsuspend student'
      };
    }
  })

  /**
   * Get suspension history for a tutor
   * GET /admin/tutors/:tutorId/suspension-history
   */
  .get('/tutors/:tutorId/suspension-history', async ({ params }) => {
    try {
      const { tutorId } = params;
      const history = await suspensionJobService.getSuspensionHistory(tutorId, 'tutor');
      return {
        success: true,
        data: history
      };
    } catch (error) {
      console.error('Error in /admin/tutors/:tutorId/suspension-history:', error);
      return {
        success: false,
        error: 'Failed to get suspension history'
      };
    }
  })

  /**
   * Get suspension history for a student
   * GET /admin/students/:studentId/suspension-history
   */
  .get('/students/:studentId/suspension-history', async ({ params }) => {
    try {
      const { studentId } = params;
      const history = await suspensionJobService.getSuspensionHistory(studentId, 'student');
      return {
        success: true,
        data: history
      };
    } catch (error) {
      console.error('Error in /admin/students/:studentId/suspension-history:', error);
      return {
        success: false,
        error: 'Failed to get suspension history'
      };
    }
  })

  /**
   * Get recent activity feed
   * GET /admin/activity
   */
  .get('/activity', async ({ query }) => {
    try {
      const limit = query.limit ? Number(query.limit) : 10;
      const activities = await adminService.getRecentActivity(limit);
      return {
        success: true,
        data: activities
      };
    } catch (error) {
      console.error('Error in /admin/activity:', error);
      return {
        success: false,
        error: 'Failed to get recent activity'
      };
    }
  })

  /**
   * Admin Login
   * POST /admin/login
   */
  .post('/login', async ({ body, cookie, request, set }) => {
    // Rate limit login attempts to prevent brute force attacks
    const clientIp = getClientIp(request);
    const rateLimitResult = await rateLimitMiddleware(clientIp, 'auth', set as any);
    if (rateLimitResult) return rateLimitResult;
    
    try {
      const { username, password } = body as { username: string; password: string };
      
      if (!username || !password) {
        return {
          success: false,
          error: 'Username and password are required'
        };
      }

      const admin = await adminService.login({ username, password });

      // Sign JWT token for admin
      const isProduction = process.env.NODE_ENV === 'production';
      const token = await signAuthToken({
        userId: admin.id,
        email: admin.username, // Use username as email for admin
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role
      }, 60 * 60 * 8); // 8 hours expiry

      // Set httpOnly cookie with JWT
      cookie.adminAuth?.set({
        value: token,
        ...getCookieConfig(isProduction),
        maxAge: 60 * 60 * 8, // 8 hours
      });

      return {
        success: true,
        message: 'Login successful',
        user: {
          userId: admin.id,
          username: admin.username,
          firstName: admin.firstName,
          lastName: admin.lastName,
          role: admin.role
        }
      };
    } catch (error: any) {
      console.error('Error in /admin/login:', error);
      return {
        success: false,
        error: error.message || 'Login failed'
      };
    }
  }, {
    body: t.Object({
      username: t.String(),
      password: t.String()
    })
  })

  /**
   * Admin Logout
   * POST /admin/logout
   */
  .post('/logout', async ({ cookie }) => {
    try {
      // Clear the admin auth cookie
      const isProduction = process.env.NODE_ENV === 'production';
      cookie.adminAuth?.set({
        value: '',
        ...getCookieConfig(isProduction),
        maxAge: 0,
      });

      return {
        success: true,
        message: 'Logged out successfully'
      };
    } catch (error) {
      console.error('Error in /admin/logout:', error);
      return {
        success: false,
        error: 'Logout failed'
      };
    }
  })

  /**
   * Get current admin user
   * GET /admin/me
   */
  .get('/me', async ({ cookie }) => {
    try {
      const authCookie = cookie.adminAuth?.value;
      
      if (!authCookie) {
        return {
          success: false,
          error: 'Not authenticated'
        };
      }

      const userData = await verifyAuthToken(typeof authCookie === 'string' ? authCookie : String(authCookie));
      if (!userData?.userId) {
        return {
          success: false,
          error: 'Invalid session'
        };
      }

      // Optionally verify admin still exists in DB
      const admin = await adminService.getById(userData.userId);
      const isProduction = process.env.NODE_ENV === 'production';
      if (!admin) {
        // Clear invalid cookie
        cookie.adminAuth?.set({
          value: '',
          ...getCookieConfig(isProduction),
          maxAge: 0,
        });
        return {
          success: false,
          error: 'Session expired'
        };
      }

      return {
        success: true,
        user: {
          userId: admin.id,
          username: admin.username,
          firstName: admin.firstName,
          lastName: admin.lastName,
          role: admin.role
        }
      };
    } catch (error) {
      console.error('Error in /admin/me:', error);
      return {
        success: false,
        error: 'Failed to get user info'
      };
    }
  })

  /**
   * Create admin user (requires superadmin authentication)
   * POST /admin/create
   */
  .post('/create', async ({ body, cookie }) => {
    try {
      // Verify the current user is a superadmin
      const authCookie = cookie.adminAuth?.value;
      if (!authCookie) {
        return {
          success: false,
          error: 'Unauthorized - Superadmin authentication required'
        };
      }

      const userData = await verifyAuthToken(typeof authCookie === 'string' ? authCookie : String(authCookie));
      if (!userData?.userId) {
        return {
          success: false,
          error: 'Invalid session'
        };
      }

      // Verify current user is superadmin
      const currentAdmin = await adminService.getById(userData.userId);
      if (!currentAdmin || currentAdmin.role !== 'superadmin') {
        return {
          success: false,
          error: 'Only superadmins can create new admin accounts'
        };
      }

      const { username, password, firstName, lastName, role } = body as {
        username: string;
        password: string;
        firstName?: string;
        lastName?: string;
        role?: 'admin' | 'superadmin';
      };

      if (!username || !password) {
        return {
          success: false,
          error: 'Username and password are required'
        };
      }

      const admin = await adminService.createAdmin(username, password, firstName, lastName, role);

      return {
        success: true,
        message: 'Admin created successfully',
        data: {
          id: admin.id,
          username: admin.username,
          firstName: admin.firstName,
          lastName: admin.lastName,
          role: admin.role
        }
      };
    } catch (error: any) {
      console.error('Error in /admin/create:', error);
      return {
        success: false,
        error: error.message || 'Failed to create admin'
      };
    }
  }, {
    body: t.Object({
      username: t.String(),
      password: t.String(),
      firstName: t.Optional(t.String()),
      lastName: t.Optional(t.String()),
      role: t.Optional(t.Union([t.Literal('admin'), t.Literal('superadmin')]))
    })
  })

  /**
   * List all admin users
   * GET /admin/list
   */
  .get('/list', async ({ cookie }) => {
    try {
      const authCookie = cookie.adminAuth?.value;
      if (!authCookie) {
        return {
          success: false,
          error: 'Unauthorized'
        };
      }

      const userData = await verifyAuthToken(typeof authCookie === 'string' ? authCookie : String(authCookie));
      if (!userData?.userId) {
        return { success: false, error: 'Invalid session' };
      }

      // Verify current user is superadmin
      const currentAdmin = await adminService.getById(userData.userId);
      if (!currentAdmin || currentAdmin.role !== 'superadmin') {
        return {
          success: false,
          error: 'Only superadmins can list admin users'
        };
      }

      const admins = await adminService.listAdmins();
      return {
        success: true,
        data: admins
      };
    } catch (error) {
      console.error('Error in /admin/list:', error);
      return {
        success: false,
        error: 'Failed to list admins'
      };
    }
  })

  /**
   * Delete an admin user
   * DELETE /admin/:id
   */
  .delete('/:id', async ({ params, cookie }) => {
    try {
      const authCookie = cookie.adminAuth?.value;
      if (!authCookie) {
        return {
          success: false,
          error: 'Unauthorized'
        };
      }

      const userData = await verifyAuthToken(typeof authCookie === 'string' ? authCookie : String(authCookie));
      if (!userData?.userId) {
        return { success: false, error: 'Invalid session' };
      }

      // Verify current user is superadmin
      const currentAdmin = await adminService.getById(userData.userId);
      if (!currentAdmin || currentAdmin.role !== 'superadmin') {
        return {
          success: false,
          error: 'Only superadmins can delete admin users'
        };
      }

      // Prevent self-deletion
      if (params.id === userData.userId) {
        return {
          success: false,
          error: 'Cannot delete your own account'
        };
      }

      const deleted = await adminService.deleteAdmin(params.id);
      return {
        success: deleted,
        message: deleted ? 'Admin deleted successfully' : 'Admin not found'
      };
    } catch (error) {
      console.error('Error in DELETE /admin/:id:', error);
      return {
        success: false,
        error: 'Failed to delete admin'
      };
    }
  })

  /**
   * Update an admin user
   * PUT /admin/:id
   */
  .put('/:id', async ({ params, body, cookie }) => {
    try {
      const authCookie = cookie.adminAuth?.value;
      if (!authCookie) {
        return {
          success: false,
          error: 'Unauthorized'
        };
      }

      const userData = await verifyAuthToken(typeof authCookie === 'string' ? authCookie : String(authCookie));
      if (!userData?.userId) {
        return { success: false, error: 'Invalid session' };
      }

      // Verify current user is superadmin
      const currentAdmin = await adminService.getById(userData.userId);
      if (!currentAdmin || currentAdmin.role !== 'superadmin') {
        return {
          success: false,
          error: 'Only superadmins can update admin users'
        };
      }

      const { firstName, lastName, role } = body as {
        firstName?: string;
        lastName?: string;
        role?: 'admin' | 'superadmin';
      };

      const updated = await adminService.updateAdmin(params.id, { firstName, lastName, role });
      if (!updated) {
        return {
          success: false,
          error: 'Admin not found'
        };
      }

      return {
        success: true,
        data: updated
      };
    } catch (error) {
      console.error('Error in PUT /admin/:id:', error);
      return {
        success: false,
        error: 'Failed to update admin'
      };
    }
  }, {
    body: t.Object({
      firstName: t.Optional(t.String()),
      lastName: t.Optional(t.String()),
      role: t.Optional(t.Union([t.Literal('admin'), t.Literal('superadmin')]))
    })
  })

  /**
   * Change password for current admin
   * POST /admin/change-password
   */
  .post('/change-password', async ({ body, cookie }) => {
    try {
      const authCookie = cookie.adminAuth?.value;
      if (!authCookie) {
        return {
          success: false,
          error: 'Unauthorized'
        };
      }

      const userData = await verifyAuthToken(typeof authCookie === 'string' ? authCookie : String(authCookie));
      if (!userData?.userId) {
        return { success: false, error: 'Invalid session' };
      }

      const { currentPassword, newPassword } = body as {
        currentPassword: string;
        newPassword: string;
      };

      if (!currentPassword || !newPassword) {
        return {
          success: false,
          error: 'Current password and new password are required'
        };
      }

      if (newPassword.length < 8) {
        return {
          success: false,
          error: 'New password must be at least 8 characters'
        };
      }

      const result = await adminService.changePassword(userData.userId, currentPassword, newPassword);
      return result;
    } catch (error) {
      console.error('Error in /admin/change-password:', error);
      return {
        success: false,
        error: 'Failed to change password'
      };
    }
  }, {
    body: t.Object({
      currentPassword: t.String(),
      newPassword: t.String()
    })
  })

  /**
   * Get comprehensive analytics data
   * GET /admin/analytics
   */
  .get('/analytics', async ({ query }) => {
    try {
      const period = (query.period as string) || 'week';
      const analytics = await adminService.getAnalytics(period);
      return {
        success: true,
        data: analytics
      };
    } catch (error) {
      console.error('Error in /admin/analytics:', error);
      return {
        success: false,
        error: 'Failed to get analytics data'
      };
    }
  })

  /**
   * Get suspension analytics
   * GET /admin/analytics/suspensions
   */
  .get('/analytics/suspensions', async () => {
    try {
      const data = await adminService.getSuspensionAnalytics();
      return {
        success: true,
        data
      };
    } catch (error) {
      console.error('Error in /admin/analytics/suspensions:', error);
      return {
        success: false,
        error: 'Failed to get suspension analytics'
      };
    }
  })

  /**
   * Get all sessions/bookings with filters
   * GET /admin/sessions
   */
  .get('/sessions', async ({ query }) => {
    try {
      const page = query.page ? Number(query.page) : 1;
      const limit = query.limit ? Number(query.limit) : 20;
      const status = query.status as string | undefined;
      const search = query.search as string | undefined;
      const startDate = query.startDate as string | undefined;
      const endDate = query.endDate as string | undefined;
      
      const sessions = await adminService.getAllSessions({ page, limit, status, search, startDate, endDate });
      return {
        success: true,
        data: sessions
      };
    } catch (error) {
      console.error('Error in /admin/sessions:', error);
      return {
        success: false,
        error: 'Failed to get sessions'
      };
    }
  })

  /**
   * Get session statistics
   * GET /admin/sessions/stats
   */
  .get('/sessions/stats', async () => {
    try {
      const stats = await adminService.getSessionStats();
      return {
        success: true,
        data: stats
      };
    } catch (error) {
      console.error('Error in /admin/sessions/stats:', error);
      return {
        success: false,
        error: 'Failed to get session stats'
      };
    }
  })

  /**
   * Get session details by ID
   * GET /admin/sessions/:sessionId
   */
  .get('/sessions/:sessionId', async ({ params }) => {
    try {
      const { sessionId } = params;
      const sessionDetails = await adminService.getSessionDetails(sessionId);
      return {
        success: true,
        data: sessionDetails
      };
    } catch (error) {
      console.error('Error in /admin/sessions/:sessionId:', error);
      return {
        success: false,
        error: 'Failed to get session details'
      };
    }
  })

  /**
   * Get ticket statistics and transactions
   * GET /admin/tickets/stats
   */
  .get('/tickets/stats', async () => {
    try {
      const stats = await adminService.getTicketStats();
      return {
        success: true,
        data: stats
      };
    } catch (error) {
      console.error('Error in /admin/tickets/stats:', error);
      return {
        success: false,
        error: 'Failed to get ticket stats'
      };
    }
  })

  /**
   * Get ticket transactions with filters
   * GET /admin/tickets/transactions
   */
  .get('/tickets/transactions', async ({ query }) => {
    try {
      const page = query.page ? Number(query.page) : 1;
      const limit = query.limit ? Number(query.limit) : 20;
      const type = query.type as string | undefined; // 'booking', 'purchase', 'refund'
      const studentId = query.studentId as string | undefined;
      
      const transactions = await adminService.getTicketTransactions({ page, limit, type, studentId });
      return {
        success: true,
        data: transactions
      };
    } catch (error) {
      console.error('Error in /admin/tickets/transactions:', error);
      return {
        success: false,
        error: 'Failed to get ticket transactions'
      };
    }
  })

  /**
   * Get fraud alerts and suspicious activity
   * GET /admin/fraud/alerts
   */
  .get('/fraud/alerts', async ({ query }) => {
    try {
      const page = query.page ? Number(query.page) : 1;
      const limit = query.limit ? Number(query.limit) : 20;
      const severity = query.severity as string | undefined; // 'high', 'medium', 'low'
      
      const alerts = await adminService.getFraudAlerts({ page, limit, severity });
      return {
        success: true,
        data: alerts
      };
    } catch (error) {
      console.error('Error in /admin/fraud/alerts:', error);
      return {
        success: false,
        error: 'Failed to get fraud alerts'
      };
    }
  })

  /**
   * Get real-time system monitoring data
   * GET /admin/monitor/realtime
   */
  .get('/monitor/realtime', async () => {
    try {
      const data = await adminService.getRealtimeMonitoring();
      return {
        success: true,
        data
      };
    } catch (error) {
      console.error('Error in /admin/monitor/realtime:', error);
      return {
        success: false,
        error: 'Failed to get monitoring data'
      };
    }
  });

export default Admin;
