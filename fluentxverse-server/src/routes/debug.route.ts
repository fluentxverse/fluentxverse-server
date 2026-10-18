import Elysia, { t } from 'elysia';
import { getDriver } from '../db/memgraph';
import { getRetentionHistory } from '../db/redis';
import { createAdminGuard } from '../middleware/auth.middleware';

const isProduction = process.env.NODE_ENV === 'production';

const Debug = new Elysia({ name: 'debug', prefix: '/debug' })
  // Global auth guard for all debug routes - only admins can access
  .onBeforeHandle(async ({ path, cookie, set }) => {
    // In production, completely disable debug routes
    if (isProduction) {
      set.status = 404;
      return { success: false, error: 'Not found' };
    }
    
    // In development, still require admin auth for sensitive endpoints
    const sensitiveRoutes = ['/debug/tutors-raw', '/debug/all-nodes', '/debug/exams-raw', '/debug/retention-history'];
    if (sensitiveRoutes.some(route => path === route)) {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return {
          success: false,
          error: 'Unauthorized - Admin authentication required'
        };
      }
    }
  })
  .post('/log', async ({ body }) => {
    try {
      const { tag = 'frontend', level = 'info', message = '', data = null } = body as any;
      const stamp = new Date().toISOString();
      const payload = data ? JSON.stringify(data) : '';
      const line = `[${stamp}] [${tag}] [${level}] ${message}${payload ? ' :: ' + payload : ''}`;
      // Print to server terminal
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      return { success: true };
    } catch (e) {
      console.error('Debug log error:', e);
      return { success: false };
    }
  })
  .get('/tutors-raw', async () => {
    const driver = getDriver();
    const session = driver.session();
    try {
      // User nodes ARE tutors - no role filter needed
      const result = await session.run(`
        MATCH (u:User)
        RETURN u.id as id, u.email as email, u.firstName as firstName, u.lastName as lastName,
               u.writtenExamPassed as writtenExamPassed, u.speakingExamPassed as speakingExamPassed,
               u.writtenExamScore as writtenExamScore, u.speakingExamScore as speakingExamScore,
               u.createdAt as createdAt
      `);
      const tutors = result.records.map(r => ({
        id: r.get('id'),
        email: r.get('email'),
        firstName: r.get('firstName'),
        lastName: r.get('lastName'),
        writtenExamPassed: r.get('writtenExamPassed'),
        speakingExamPassed: r.get('speakingExamPassed'),
        writtenExamScore: r.get('writtenExamScore'),
        speakingExamScore: r.get('speakingExamScore'),
        createdAt: r.get('createdAt')
      }));
      return { success: true, count: tutors.length, tutors };
    } finally {
      await session.close();
    }
  })
  .get('/all-nodes', async () => {
    const driver = getDriver();
    const session = driver.session();
    try {
      // Get all node labels and counts
      const result = await session.run(`
        MATCH (n)
        RETURN labels(n) as labels, count(*) as count
      `);
      const nodes = result.records.map(r => ({
        labels: r.get('labels'),
        count: r.get('count')?.toNumber?.() ?? r.get('count')
      }));
      return { success: true, nodes };
    } finally {
      await session.close();
    }
  })
  .get('/exams-raw', async () => {
    const driver = getDriver();
    const session = driver.session();
    try {
      // Get all Exam nodes with their relationships
      const result = await session.run(`
        MATCH (e:Exam)
        OPTIONAL MATCH (u:User)-[r]->(e)
        RETURN e, u.id as tutorId, u.email as tutorEmail, type(r) as relType
      `);
      const exams = result.records.map(r => ({
        exam: r.get('e')?.properties,
        tutorId: r.get('tutorId'),
        tutorEmail: r.get('tutorEmail'),
        relType: r.get('relType')
      }));
      return { success: true, count: exams.length, exams };
    } finally {
      await session.close();
    }
  })
  .get('/retention-history', async ({ set, cookie }) => {
    const adminAuth = createAdminGuard(cookie, set);
    if (!adminAuth) {
      set.status = 403;
      return { error: 'Unauthorized - Admin access required' };
    }

    try {
      const history = await getRetentionHistory();
      const totalDeleted = history.reduce((sum, entry) => sum + entry.deletedCount, 0);

      return {
        success: true,
        totalCleanupRuns: history.length,
        totalDeletedNotifications: totalDeleted,
        history: history.slice(-20), // Last 20 cleanup runs
      };
    } catch (error) {
      console.error('Retention history error:', error);
      set.status = 500;
      return { error: 'Failed to retrieve retention history' };
    }
  });
  

export default Debug;
