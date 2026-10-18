import StudentService from '../services/auth.services/student.service';
import { ScheduleService } from '../services/schedule.services/schedule.service';
import { MobileAuthError, MobileAuthService, type MobileAccount } from '../services/auth.services/mobileAuth.service';
import { PostgresMobileSessionStore } from '../services/auth.services/mobileSession.store';
import { getDriver } from '../db/memgraph';
import { rateLimitMiddleware } from '../utils/rateLimiter';
import type { MobileStudentDependencies } from './mobileStudent.route';

function normalize(user: Record<string, any>): MobileAccount {
  if (!user.id || (user.role && user.role !== 'student')) throw new MobileAuthError(401, 'Student account required.');
  return {
    userId: user.id, role: 'student', email: user.email || null,
    givenName: user.givenName || null, familyName: user.familyName || null,
    suspendedUntil: user.suspendedUntil || null, signUpdate: Number(user.signUpdate) || 0,
  };
}

const store = new PostgresMobileSessionStore();
let auth: MobileAuthService | null = null;
const studentService = new StudentService();
const scheduleService = new ScheduleService();

export const mobileStudentDependencies: MobileStudentDependencies = {
  auth() {
    if (process.env.MOBILE_JWT_SECRET && process.env.MOBILE_JWT_SECRET === process.env.JWT_SECRET) {
      throw new MobileAuthError(503, 'Mobile authentication requires a dedicated signing key.');
    }
    if (!auth) auth = new MobileAuthService(store, async userId => {
      const session = getDriver().session();
      try {
        const result = await session.run('MATCH (s:Student {id: $userId}) RETURN s', { userId });
        const properties = result.records[0]?.get('s')?.properties;
        if (!properties?.id || (properties.role && properties.role !== 'student')) return null;
        return properties ? normalize(properties) : null;
      } finally { await session.close(); }
    }, process.env.MOBILE_JWT_SECRET || '');
    return auth;
  },
  async login(email, password) {
    try { return normalize(await studentService.login({ email, password })); } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid email or password')) {
        throw new MobileAuthError(401, 'Invalid email or password.');
      }
      if (error instanceof Error && error.message.includes('suspended')) {
        throw new MobileAuthError(403, 'Your student account is suspended.');
      }
      throw error;
    }
  },
  profile: userId => studentService.getOwnProfile(userId),
  stats: userId => scheduleService.getStudentStats(userId),
  bookings: userId => scheduleService.getStudentBookings(userId),
  rateLimit: (request, set, kind) => rateLimitMiddleware(
    `mobile:${request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'}`,
    kind, set,
  ),
};
