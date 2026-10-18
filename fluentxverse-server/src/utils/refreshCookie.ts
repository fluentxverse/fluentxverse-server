import type { Cookie } from 'elysia';
import type { AuthData } from '@/services/auth.services/auth.interface';
import { verifyAuthToken, getCookieConfig, type JwtAuthPayload } from './jwt';

export interface CookieAuthPayload extends JwtAuthPayload {
  sub: string;
  userId: string;
  role: string;
  name?: string;
}

/**
 * Get auth data from cookie (supports both tutor and student auth)
 * Returns the decoded JWT payload or null if not authenticated
 */
export async function getAuthFromCookie(cookie: Record<string, Cookie<any>>): Promise<CookieAuthPayload | null> {
  try {
    // Try tutorAuth first
    const tutorAuth = cookie.tutorAuth?.value;
    if (tutorAuth) {
      const decoded = await verifyAuthToken(typeof tutorAuth === 'string' ? tutorAuth : String(tutorAuth));
      if (decoded?.userId) {
        return { ...decoded, sub: decoded.userId, userId: decoded.userId, role: 'tutor', name: decoded.firstName || decoded.givenName || decoded.email };
      }
    }

    // Try studentAuth
    const studentAuth = cookie.studentAuth?.value;
    if (studentAuth) {
      const decoded = await verifyAuthToken(typeof studentAuth === 'string' ? studentAuth : String(studentAuth));
      if (decoded?.userId) {
        return { ...decoded, sub: decoded.userId, userId: decoded.userId, role: 'student', name: decoded.firstName || decoded.givenName || decoded.email };
      }
    }

    // Try adminAuth
    const adminAuth = cookie.adminAuth?.value;
    if (adminAuth) {
      const decoded = await verifyAuthToken(typeof adminAuth === 'string' ? adminAuth : String(adminAuth));
      if (decoded?.userId) {
        return { ...decoded, sub: decoded.userId, userId: decoded.userId, role: 'admin', name: decoded.firstName || decoded.givenName || decoded.email };
      }
    }

    return null;
  } catch (error) {
    console.error('Error getting auth from cookie:', error);
    return null;
  }
}

/**
 * @deprecated Use refreshJwtCookie from jwt.ts instead - this function stores raw JSON, not signed JWTs
 * Refresh the auth cookie with a new expiration time (1 hour)
 * Call this on every authenticated request to keep the session alive
 */
export function refreshAuthCookie(cookie: Record<string, Cookie<any>>, authData: AuthData, cookieName: 'tutorAuth' | 'studentAuth' = 'tutorAuth') {
  console.warn('SECURITY WARNING: refreshAuthCookie is deprecated. Use refreshJwtCookie from jwt.ts instead.');
  const isProduction = process.env.NODE_ENV === 'production';
  
  cookie[cookieName]?.set({
    value: JSON.stringify({
      userId: authData.userId,
      email: authData.email,
      firstName: authData.firstName,
      lastName: authData.lastName,
      familyName: authData.familyName,
      givenName: authData.givenName,
      walletAddress: authData.walletAddress,
      mobileNumber: authData.mobileNumber,
      tier: authData.tier,
      role: authData.role
    }),
    ...getCookieConfig(isProduction),
  });
}
