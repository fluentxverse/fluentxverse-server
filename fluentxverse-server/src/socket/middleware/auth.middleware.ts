import type { Socket } from 'socket.io';
import { verifyAuthToken, type JwtAuthPayload } from '../../utils/jwt';
import { parseCookie } from 'elysia/cookies';

type AdminCookieAuth = {
  userId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
};

export const authMiddleware = async (
  socket: Socket,
  next: (err?: Error) => void
) => {
  try {
    // Prefer explicit token from handshake.auth; fallback to cookie in dev
    const tokenFromAuth = (socket.handshake.auth as any)?.token as string | undefined;
    const cookieString = socket.handshake.headers.cookie;
    let authPayload: JwtAuthPayload | null = null;

    // Try to verify JWT token from handshake.auth
    if (tokenFromAuth && tokenFromAuth.includes('.')) {
      authPayload = await verifyAuthToken(tokenFromAuth);
      if (authPayload) {
      }
    }

    // Cookie names are not proof of role; always match the signed claim.
    if (!authPayload && cookieString) {
      const roles: Record<string, string[]> = {
        adminAuth: ['admin', 'superadmin'], tutorAuth: ['tutor'], studentAuth: ['student'],
      };
      for (const name of Object.keys(roles)) {
        for (const candidate of cookieString.split(';')) {
          if (!candidate.trimStart().startsWith(`${name}=`)) continue;
          const jar = await parseCookie({ headers: {}, status: 200 }, candidate.trim());
          const raw = jar[name]?.value;
          if (typeof raw !== 'string') continue;
          const payload = await verifyAuthToken(raw);
          if (payload?.role && roles[name]?.includes(payload.role)) {
            authPayload = payload;
            break;
          }
        }
        if (authPayload) break;
      }
    }

    // SECURITY: Require authentication in ALL environments
    // Anonymous sockets are a security risk - they can listen to events and send malicious data
    if (!authPayload) {
      console.warn('❌ Socket connection rejected: No valid authentication');
      return next(new Error('Authentication required: No valid JWT token or cookie'));
    }

    if (!authPayload.userId || !authPayload.email
      || !['student', 'tutor', 'admin', 'superadmin'].includes(authPayload.role || '')) {
      return next(new Error('Invalid authentication data'));
    }

    // Attach user data to socket
    socket.data.userId = authPayload.userId;
    socket.data.userType = authPayload.role === 'admin' || authPayload.role === 'superadmin'
      ? 'admin'
      : authPayload.role === 'tutor'
        ? 'tutor'
        : 'student';
    socket.data.email = authPayload.email;

    next();
  } catch (error) {
    console.error('Socket authentication error:', error);
    next(new Error('Authentication failed'));
  }
};
