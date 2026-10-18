import Elysia, { t } from "elysia";
import StudentService from "../services/auth.services/student.service";
import { verifyAuthToken, signAuthToken, getCookieConfig, type JwtAuthPayload } from "../utils/jwt";
import { nanoid } from "nanoid";
import { verifyMessage } from "viem";
import { ticketService } from "../services/ticket.services/ticket.service";
import { trialLaunchMode } from '../services/schedule.services/trialPolicy';
import { favoritesService } from "../services/favorites.services/favorites.service";
import { rateLimitMiddleware } from "../utils/rateLimiter";
import type { StudentUserData, NormalizedStudentUser } from "../services/auth.services/auth.interface";
import { verifyPrivySession } from "../services/auth.services/privy.service";
import { getDriver } from "../db/memgraph";
import { resolveStudentSession, setStudentSessionCookie, clearStudentSessionCookies } from '../utils/studentSession';

function normalizeStudentUser(userData: StudentUserData | any): NormalizedStudentUser {
  return {
    id: userData.id,
    userId: userData.id,
    email: userData.email,
    givenName: userData.givenName || null,
    familyName: userData.familyName || null,
    mobileNumber: userData.mobileNumber || null,
    tier: userData.tier ?? 0,
    role: userData.role || 'student',
    walletAddress: userData.externalWalletAddress || (typeof userData.smartWalletAddress === 'string'
      ? userData.smartWalletAddress
      : userData.smartWalletAddress?.address || null),
  };
}

async function setStudentSession(set: any, user: NormalizedStudentUser) {
  const token = await signAuthToken({
    userId: user.userId,
    email: user.email || '',
    familyName: user.familyName || undefined,
    givenName: user.givenName || undefined,
    mobileNumber: user.mobileNumber || undefined,
    tier: user.tier,
    role: user.role,
    walletAddress: user.walletAddress || undefined,
  });
  setStudentSessionCookie(set, token);
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  return authorization.slice(7).trim() || null;
}

// In-memory nonce store (use Redis in production for multi-instance deployments)
const nonceStore = new Map<string, { nonce: string; expires: number }>();

// Clean up expired nonces periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of nonceStore.entries()) {
    if (value.expires < now) {
      nonceStore.delete(key);
    }
  }
}, 60000); // Clean every minute

const Student = new Elysia({ name: "student" })
  .post("/student/register", async ({ body, cookie, set }) => {
    try {
      const studentService = new StudentService();
      const result = await studentService.register(body);
      const userData: StudentUserData = await studentService.login({ email: body.email, password: body.password });

      // Normalize user object for frontend consistency
      const normalizedUser: NormalizedStudentUser = {
        id: userData.id,
        userId: userData.id,
        email: userData.email,
        givenName: userData.givenName || null,
        familyName: userData.familyName || null,
        mobileNumber: userData.mobileNumber || null,
        tier: userData.tier ?? 0,
        role: userData.role || 'student',
        walletAddress: (userData.smartWalletAddress && (typeof userData.smartWalletAddress === 'string')) ? userData.smartWalletAddress : ((userData.smartWalletAddress as { address: string } | null)?.address || null)
      };

      const token = await signAuthToken({
        userId: normalizedUser.userId,
        email: normalizedUser.email || '',
        familyName: normalizedUser.familyName || undefined,
        givenName: normalizedUser.givenName || undefined,
        mobileNumber: normalizedUser.mobileNumber || undefined,
        tier: normalizedUser.tier,
        role: normalizedUser.role,
        walletAddress: normalizedUser.walletAddress || undefined
      });
      const isProduction = process.env.NODE_ENV === 'production';
      cookie.studentAuth?.set({
        value: token,
        ...getCookieConfig(isProduction)
      });

      return {
        success: true,
        message: result.message,
        user: normalizedUser
      };
    } catch (error: any) {
      // Map email-exists to a 409 friendly response
      if (error?.code === 'EMAIL_EXISTS' || error?.message === 'EMAIL_EXISTS') {
        if (set) set.status = 409;
        return { success: false, message: 'Email is already registered', user: null };
      }
      throw error;
    }
  }, {
    body: t.Object({
      email: t.String(),
      password: t.String(),
      familyName: t.String(),
      givenName: t.String(),
      birthDate: t.String(),
      mobileNumber: t.String()
    }),
    response: {
      200: t.Object({
        success: t.Boolean(),
        message: t.String(),
        user: t.Any()
      })
    }
  })

  .post("/student/login", async ({ body, cookie, request, set }) => {
    // Rate limit login attempts to prevent brute force attacks
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                     request.headers.get('x-real-ip') || 'unknown';
    const rateLimitResult = await rateLimitMiddleware(clientIp, 'auth', set as any);
    if (rateLimitResult) return { ...rateLimitResult, user: null };
    
    try {
      const studentService = new StudentService();
      const userData: StudentUserData = await studentService.login(body);

      const normalizedUser: NormalizedStudentUser = {
        id: userData.id,
        userId: userData.id,
        email: userData.email,
        givenName: userData.givenName || null,
        familyName: userData.familyName || null,
        mobileNumber: userData.mobileNumber || null,
        tier: userData.tier ?? 0,
        role: userData.role || 'student',
        walletAddress: (userData.smartWalletAddress && (typeof userData.smartWalletAddress === 'string')) ? userData.smartWalletAddress : ((userData.smartWalletAddress as { address: string } | null)?.address || null)
      };

      const token = await signAuthToken({
        userId: normalizedUser.userId,
        email: normalizedUser.email || '',
        familyName: normalizedUser.familyName || undefined,
        givenName: normalizedUser.givenName || undefined,
        mobileNumber: normalizedUser.mobileNumber || undefined,
        tier: normalizedUser.tier,
        role: normalizedUser.role,
        walletAddress: normalizedUser.walletAddress || undefined
      });
      const isProduction = process.env.NODE_ENV === 'production';
      cookie.studentAuth?.set({
        value: token,
        ...getCookieConfig(isProduction)
      });

      return {
        success: true,
        user: normalizedUser
      };
    } catch (error: any) {
      
      // Handle specific error messages with friendly responses
      const errorMessage = error?.message || 'Login failed';
      
      if (errorMessage.includes('Invalid email or password')) {
        return {
          success: false,
          error: 'Invalid email or password. Please check your credentials and try again.',
          user: null
        };
      }
      
      if (errorMessage.includes('suspended')) {
        return {
          success: false,
          error: errorMessage, // Keep suspension details
          user: null
        };
      }
      
      // For other errors, throw to let global handler process
      throw error;
    }
  }, {
    body: t.Object({
      email: t.String(),
      password: t.String()
    }),
    response: {
      200: t.Object({
        success: t.Boolean(),
        user: t.Any(),
        error: t.Optional(t.String())
      })
    }
  })

  .post('/student/auth/privy', async ({ body, cookie, request, set }) => {
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    const rateLimitResult = await rateLimitMiddleware(clientIp, 'privyAuth', set as any);
    if (rateLimitResult) return rateLimitResult;

    const accessToken = getBearerToken(request);
    if (!accessToken) {
      set.status = 401;
      return { success: false, error: 'Missing Privy access token' };
    }

    try {
      const identity = await verifyPrivySession(accessToken);
      const userData = await new StudentService().loginByPrivy(identity);
      if (!userData) {
        return {
          success: true,
          status: 'registration_required',
          profile: {
            provider: identity.provider,
            email: identity.email,
            givenName: identity.givenName,
            familyName: identity.familyName,
          },
        };
      }

      const user = normalizeStudentUser(userData);
      await setStudentSession(set, user);
      return { success: true, status: 'authenticated', user };
    } catch (error: any) {
      console.error('Privy student authentication failed:', error);
      set.status = 401;
      return { success: false, error: 'Invalid Privy session' };
    }
  }, {
    body: t.Object({}),
  })

  .post('/student/register/privy', async ({ body, cookie, request, set }) => {
    const accessToken = getBearerToken(request);
    if (!accessToken) {
      set.status = 401;
      return { success: false, error: 'Missing Privy access token' };
    }

    try {
      const identity = await verifyPrivySession(accessToken);
      const userData = await new StudentService().registerByPrivy({
        identity,
        email: body.email,
        givenName: body.givenName,
        familyName: body.familyName,
        birthDate: body.birthDate,
        mobileNumber: body.mobileNumber,
      });
      const user = normalizeStudentUser(userData);
      await setStudentSession(set, user);
      return { success: true, user };
    } catch (error: any) {
      if (error?.code === 'EMAIL_EXISTS' || error?.message === 'EMAIL_EXISTS') {
        set.status = 409;
        return { success: false, error: 'Email is already registered' };
      }
      console.error('Privy student registration failed:', error);
      set.status = 401;
      return { success: false, error: 'Invalid Privy session' };
    }
  }, {
    body: t.Object({
      email: t.String({ minLength: 3 }),
      familyName: t.String({ minLength: 1 }),
      givenName: t.String({ minLength: 1 }),
      birthDate: t.String({ minLength: 1 }),
      mobileNumber: t.String({ minLength: 1 }),
    }),
  })

  .post('/student/logout', async ({ set }) => {
    clearStudentSessionCookies(set);
    return { success: true, message: 'Logged out successfully' };
  }, {
    response: {
      200: t.Object({
        success: t.Boolean(),
        message: t.String()
      })
    }
  })

  // Renew student session cookie (extends maxAge) without re-authenticating
  .post('/student/refresh', async ({ request, set }) => {
    try {
      const payload = await resolveStudentSession(request);
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }

      setStudentSessionCookie(set, await signAuthToken(payload));

      set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      set.headers['Pragma'] = 'no-cache';
      set.headers['Vary'] = 'Cookie';
      return { success: true };
    } catch (error: any) {
      console.error('Error refreshing student session:', error);
      set.status = 401;
      return { success: false, error: 'Invalid session' };
    }
  }, {
    response: {
      200: t.Object({
        success: t.Boolean()
      })
    }
  })

  .get('/student/socket-token', async ({ cookie, set }) => {
    try {
      const raw = cookie.studentAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(raw as string);
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }

      const token = await signAuthToken({
        userId: payload.userId,
        email: payload.email,
        familyName: payload.familyName ?? payload.lastName,
        givenName: payload.givenName ?? payload.firstName,
        mobileNumber: payload.mobileNumber,
        tier: payload.tier,
        role: payload.role || 'student',
        walletAddress: payload.walletAddress
      }, 10 * 60);

      set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      set.headers['Pragma'] = 'no-cache';
      set.headers['Vary'] = 'Cookie';
      return { success: true, token };
    } catch (error: any) {
      console.error('Error issuing student socket token:', error);
      set.status = 401;
      return { success: false, error: 'Invalid session' };
    }
  })

  .get('/student/me', async ({ request, set }) => {
    try {
      const payload = await resolveStudentSession(request);
      if (!payload) {
        set.status = 401;
        return { user: null, error: 'Invalid or expired token' };
      }

      const session = getDriver().session();
      let storedUser: Record<string, any> | null = null;
      try {
        const result = await session.run(
          `MATCH (student:Student {id: $userId}) RETURN student`,
          { userId: payload.userId }
        );
        storedUser = result.records[0]?.get('student')?.properties || null;
      } finally {
        await session.close();
      }

      const walletAddress = storedUser?.externalWalletAddress
        || (typeof storedUser?.smartWalletAddress === 'string'
          ? storedUser.smartWalletAddress
          : storedUser?.smartWalletAddress?.address)
        || payload.walletAddress
        || undefined;

      // Refresh the session with current database-backed profile fields.
      await setStudentSession(set, {
        id: payload.userId,
        userId: payload.userId,
        email: storedUser?.email || payload.email,
        givenName: storedUser?.givenName || payload.givenName || payload.firstName || null,
        familyName: storedUser?.familyName || payload.familyName || payload.lastName || null,
        mobileNumber: storedUser?.mobileNumber || payload.mobileNumber || null,
        tier: storedUser?.tier ?? payload.tier ?? 0,
        role: storedUser?.role || payload.role || 'student',
        walletAddress: walletAddress || null,
      });

      set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      set.headers['Pragma'] = 'no-cache';
      set.headers['Vary'] = 'Cookie';

      const normalized = {
        userId: payload.userId || null,
        id: payload.userId || null,
        email: storedUser?.email || payload.email,
        givenName: storedUser?.givenName || payload.givenName || payload.firstName || undefined,
        familyName: storedUser?.familyName || payload.familyName || payload.lastName || undefined,
        firstName: storedUser?.givenName || payload.firstName || payload.givenName || undefined,
        lastName: storedUser?.familyName || payload.lastName || payload.familyName || undefined,
        walletAddress,
        mobileNumber: storedUser?.mobileNumber || payload.mobileNumber || undefined,
        tier: storedUser?.tier ?? payload.tier ?? 0,
        role: storedUser?.role || payload.role || 'student'
      };

      return { user: normalized };
    } catch (error: any) {
      console.error('Error parsing student auth cookie:', error);
      set.status = 503;
      return { user: null, error: 'Unable to verify session. Please try again.' };
    }
  }, {
    response: {
      200: t.Object({ user: t.Any() }),
      401: t.Object({ user: t.Null(), error: t.String() }),
      503: t.Object({ user: t.Null(), error: t.String() })
    }
  })

  .put('/student/user/personal-info', async ({ body, cookie, set }) => {
    try {
      const raw = cookie.studentAuth?.value;
      if (!raw) throw new Error('Not authenticated');
      const payload = await verifyAuthToken(raw as string);
      if (!payload) {
        set.status = 401;
        return { success: false, message: 'Invalid or expired token' };
      }

      const studentService = new StudentService();
      const result = await studentService.updatePersonalInfo({
        userId: payload.userId,
        ...body
      });

      // Update mobileNumber in cookie if phoneNumber was updated
      if (body.phoneNumber) {
        const token = await signAuthToken({
          ...payload,
          mobileNumber: body.phoneNumber
        });
        const isProduction = process.env.NODE_ENV === 'production';
        cookie.studentAuth?.set({
          value: token,
          ...getCookieConfig(isProduction)
        });
      }

      set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      set.headers['Pragma'] = 'no-cache';

      return { success: true, message: result.message };
    } catch (error: any) {
      console.error('Error updating student personal info:', error);
      throw error;
    }
  }, {
    body: t.Object({
      phoneNumber: t.Optional(t.String()),
      country: t.Optional(t.String()),
      region: t.Optional(t.String()),
      regionName: t.Optional(t.String()),
      province: t.Optional(t.String()),
      provinceName: t.Optional(t.String()),
      city: t.Optional(t.String()),
      cityName: t.Optional(t.String()),
      zipCode: t.Optional(t.String()),
      addressLine: t.Optional(t.String()),
      sameAsPermanent: t.Optional(t.Boolean()),
      schoolAttended: t.Optional(t.String()),
      educationalAttainment: t.Optional(t.String()),
      major: t.Optional(t.String()),
      teachingExperience: t.Optional(t.String()),
      teachingQualifications: t.Optional(t.Array(t.String())),
      currentProficiency: t.Optional(t.String()),
      learningGoals: t.Optional(t.Array(t.String())),
      preferredLearningStyle: t.Optional(t.String()),
      availability: t.Optional(t.Array(t.String())),
    }),
    response: {
      200: t.Object({
        success: t.Boolean(),
        message: t.String()
      })
    }
  })

  .put('/student/user/email', async ({ body, cookie, set }) => {
    try {
      const raw = cookie.studentAuth?.value;
      if (!raw) throw new Error('Not authenticated');
      const payload = await verifyAuthToken(raw as string);
      if (!payload) {
        set.status = 401;
        return { success: false, message: 'Invalid or expired token' };
      }

      const studentService = new StudentService();
      const result = await studentService.updateEmail({
        userId: payload.userId,
        newEmail: body.newEmail,
        currentPassword: body.currentPassword
      });

      // Update email in cookie
      const token = await signAuthToken({
        ...payload,
        email: body.newEmail.toLowerCase()
      });
      const isProduction = process.env.NODE_ENV === 'production';
      cookie.studentAuth?.set({
        value: token,
        ...getCookieConfig(isProduction)
      });

      set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      set.headers['Pragma'] = 'no-cache';

      return { success: true, message: result.message };
    } catch (error: any) {
      console.error('Error updating student email:', error);
      throw error;
    }
  }, {
    body: t.Object({
      newEmail: t.String(),
      currentPassword: t.String()
    }),
    response: {
      200: t.Object({
        success: t.Boolean(),
        message: t.String()
      })
    }
  })

  .put('/student/user/password', async ({ body, cookie, set }) => {
    try {
      const raw = cookie.studentAuth?.value;
      if (!raw) throw new Error('Not authenticated');
      const payload = await verifyAuthToken(raw as string);
      if (!payload) {
        set.status = 401;
        return { success: false, message: 'Invalid or expired token' };
      }

      const studentService = new StudentService();
      const result = await studentService.updatePassword({
        userId: payload.userId,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword
      });

      set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      set.headers['Pragma'] = 'no-cache';

      return { success: true, message: result.message };
    } catch (error: any) {
      console.error('Error updating student password:', error);
      throw error;
    }
  }, {
    body: t.Object({
      currentPassword: t.String(),
      newPassword: t.String()
    }),
    response: {
      200: t.Object({
        success: t.Boolean(),
        message: t.String()
      })
    }
  })

  // Generate a nonce for wallet authentication (SIWE - Sign-In With Wallet)
  .post('/student/auth/wallet/nonce', async ({ body, set }) => {
    try {
      const { walletAddress } = body;
      
      // Generate a unique nonce
      const nonce = nanoid(32);
      const expires = Date.now() + 5 * 60 * 1000; // 5 minutes expiry
      
      // Store nonce associated with wallet address
      nonceStore.set(walletAddress.toLowerCase(), { nonce, expires });
      
      // Create the message to be signed
      const message = `Sign this message to authenticate with FluentXVerse.\n\nNonce: ${nonce}\nWallet: ${walletAddress}\nTimestamp: ${new Date().toISOString()}`;
      
      set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      set.headers['Pragma'] = 'no-cache';
      
      return {
        success: true,
        nonce,
        message
      };
    } catch (error: any) {
      console.error('Nonce generation error:', error);
      throw error;
    }
  }, {
    body: t.Object({
      walletAddress: t.String()
    }),
    response: {
      200: t.Object({
        success: t.Boolean(),
        nonce: t.String(),
        message: t.String()
      })
    }
  })

  // Wallet-based authentication with signature verification (SIWE)
  .post('/student/auth/wallet', async ({ body, cookie, set }) => {
    try {
      const { walletAddress, signature, message } = body;
      const normalizedAddress = walletAddress.toLowerCase();
      
      // Step 1: Verify nonce exists and hasn't expired
      const storedNonce = nonceStore.get(normalizedAddress);
      if (!storedNonce) {
        set.status = 401;
        return {
          success: false,
          status: 'error',
          user: null,
          message: 'Invalid or expired nonce. Please request a new one.'
        };
      }
      
      if (storedNonce.expires < Date.now()) {
        nonceStore.delete(normalizedAddress);
        set.status = 401;
        return {
          success: false,
          status: 'error',
          user: null,
          message: 'Nonce expired. Please request a new one.'
        };
      }
      
      // Verify the nonce is in the message
      if (!message.includes(storedNonce.nonce)) {
        set.status = 401;
        return {
          success: false,
          status: 'error',
          user: null,
          message: 'Invalid message format.'
        };
      }
      
      // Step 2: Verify signature
      const isValid = await verifyMessage({
        address: walletAddress as `0x${string}`,
        message,
        signature: signature as `0x${string}`
      });
      
      if (!isValid) {
        set.status = 401;
        return {
          success: false,
          status: 'error',
          user: null,
          message: 'Invalid signature. Authentication failed.'
        };
      }
      
      // Step 3: Check if wallet exists in database
      const studentService = new StudentService();
      const result = await studentService.loginByWallet(walletAddress);

      if (result.status === 'not_found') {
        // Keep nonce for registration - don't delete it yet
        return {
          success: true,
          status: 'not_found',
          user: null,
          message: 'Wallet not found. Please complete registration.'
        };
      }

      if (result.status === 'incomplete_registration') {
        // Keep nonce for registration completion - don't delete it yet
        return {
          success: true,
          status: 'incomplete_registration',
          user: result.user,
          missingFields: result.missingFields,
          message: 'Registration incomplete. Please complete your profile.'
        };
      }

      // Full authentication - delete nonce and set cookie
      nonceStore.delete(normalizedAddress);
      
      const userData: StudentUserData = result.user;
      const normalizedUser: NormalizedStudentUser = {
        id: userData.id,
        userId: userData.id,
        email: userData.email,
        givenName: userData.givenName || null,
        familyName: userData.familyName || null,
        mobileNumber: userData.mobileNumber || null,
        tier: userData.tier ?? 0,
        role: userData.role || 'student',
        walletAddress: userData.externalWalletAddress || (typeof userData.smartWalletAddress === 'string' ? userData.smartWalletAddress : null) || null
      };

      const token = await signAuthToken({
        userId: normalizedUser.userId,
        email: normalizedUser.email || '',
        familyName: normalizedUser.familyName || undefined,
        givenName: normalizedUser.givenName || undefined,
        mobileNumber: normalizedUser.mobileNumber || undefined,
        tier: normalizedUser.tier,
        role: normalizedUser.role,
        walletAddress: normalizedUser.walletAddress || undefined
      });
      const isProduction = process.env.NODE_ENV === 'production';
      cookie.studentAuth?.set({
        value: token,
        ...getCookieConfig(isProduction)
      });

      set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      set.headers['Pragma'] = 'no-cache';

      return {
        success: true,
        status: 'authenticated',
        user: normalizedUser,
        message: 'Login successful'
      };
    } catch (error: any) {
      console.error('Wallet auth error:', error);
      throw error;
    }
  }, {
    body: t.Object({
      walletAddress: t.String(),
      signature: t.String(),
      message: t.String()
    }),
    response: {
      200: t.Object({
        success: t.Boolean(),
        status: t.String(),
        user: t.Any(),
        message: t.String(),
        missingFields: t.Optional(t.Array(t.String()))
      })
    }
  })

  // Register new student with wallet - requires signature verification
  .post('/student/register/wallet', async ({ body, cookie, set }) => {
    try {
      const { walletAddress, signature, message, email, givenName, familyName, birthDate, mobileNumber } = body;
      const normalizedAddress = walletAddress.toLowerCase();
      
      // Verify nonce exists and hasn't expired
      const storedNonce = nonceStore.get(normalizedAddress);
      if (!storedNonce) {
        set.status = 401;
        return { success: false, message: 'Invalid or expired nonce. Please request a new one.', user: null };
      }
      
      if (storedNonce.expires < Date.now()) {
        nonceStore.delete(normalizedAddress);
        set.status = 401;
        return { success: false, message: 'Nonce expired. Please request a new one.', user: null };
      }
      
      // Verify the nonce is in the message
      if (!message.includes(storedNonce.nonce)) {
        set.status = 401;
        return { success: false, message: 'Invalid message format.', user: null };
      }
      
      // Verify signature
      const isValid = await verifyMessage({
        address: walletAddress as `0x${string}`,
        message,
        signature: signature as `0x${string}`
      });
      
      if (!isValid) {
        set.status = 401;
        return { success: false, message: 'Invalid signature. Authentication failed.', user: null };
      }
      
      // Delete used nonce (one-time use)
      nonceStore.delete(normalizedAddress);
      
      const studentService = new StudentService();
      const result = await studentService.registerByWallet({ walletAddress, email, givenName, familyName, birthDate, mobileNumber });

      // Send a free trial ticket to the newly registered user
      if (!trialLaunchMode()) try {
        const trialResult = await ticketService.transferTrialTicketToNewUser(walletAddress);
        if (trialResult.success) {
        } else {
        }
      } catch (trialError) {
        // Don't fail registration if trial ticket transfer fails
        console.error('Failed to send trial ticket to new user:', trialError);
      }

      const userData: StudentUserData = result.user;
      const normalizedUser: NormalizedStudentUser = {
        id: userData.id,
        userId: userData.id,
        email: userData.email,
        givenName: userData.givenName || null,
        familyName: userData.familyName || null,
        mobileNumber: userData.mobileNumber || null,
        tier: userData.tier ?? 0,
        role: userData.role || 'student',
        walletAddress: userData.externalWalletAddress || null
      };

      const token = await signAuthToken({
        userId: normalizedUser.userId,
        email: normalizedUser.email || '',
        familyName: normalizedUser.familyName || undefined,
        givenName: normalizedUser.givenName || undefined,
        mobileNumber: normalizedUser.mobileNumber || undefined,
        tier: normalizedUser.tier,
        role: normalizedUser.role,
        walletAddress: normalizedUser.walletAddress || undefined
      });
      const isProduction = process.env.NODE_ENV === 'production';
      cookie.studentAuth?.set({
        value: token,
        ...getCookieConfig(isProduction)
      });

      set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      set.headers['Pragma'] = 'no-cache';

      return {
        success: true,
        message: result.message,
        user: normalizedUser
      };
    } catch (error: any) {
      console.error('Wallet registration error:', error);
      if (error?.code === 'WALLET_EXISTS') {
        if (set) set.status = 409;
        return { success: false, message: 'Wallet is already registered', user: null };
      }
      if (error?.code === 'EMAIL_EXISTS') {
        if (set) set.status = 409;
        return { success: false, message: 'Email is already registered', user: null };
      }
      throw error;
    }
  }, {
    body: t.Object({
      walletAddress: t.String(),
      signature: t.String(),
      message: t.String(),
      email: t.Optional(t.String()),
      givenName: t.Optional(t.String()),
      familyName: t.Optional(t.String()),
      birthDate: t.Optional(t.String()),
      mobileNumber: t.Optional(t.String())
    }),
    response: {
      200: t.Object({
        success: t.Boolean(),
        message: t.String(),
        user: t.Any()
      })
    }
  })

  /**
   * Get student's own profile
   * GET /student/profile
   */
  .get('/student/profile', async ({ cookie, set }) => {
    
    try {
      const authCookie = cookie.studentAuth?.value;
      if (!authCookie) {
        console.error('[StudentRoute] No studentAuth cookie');
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(authCookie as string);
      if (!payload) {
        console.error('[StudentRoute] Invalid or expired token');
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const studentId = payload.userId;

      const studentService = new StudentService();
      const profileData = await studentService.getOwnProfile(studentId);

      return { success: true, data: profileData };
    } catch (error: any) {
      console.error('[StudentRoute] Profile error:', error);
      set.status = 500;
      return { success: false, error: error.message || 'Failed to get profile' };
    }
  })

  /**
   * Update student's lesson preferences
   * PUT /student/preferences
   */
  .put('/student/preferences', async ({ body, cookie, set }) => {
    
    try {
      const authCookie = cookie.studentAuth?.value;
      if (!authCookie) {
        console.error('[StudentRoute] No studentAuth cookie');
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(authCookie as string);
      if (!payload) {
        console.error('[StudentRoute] Invalid or expired token');
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const studentId = payload.userId;

      const preferences = body as {
        preferCameraOn: boolean;
        errorCorrection: 'during_feedback' | 'proactively' | 'tutor_choice';
        otherRequests: string;
      };

      const studentService = new StudentService();
      const result = await studentService.updateLessonPreferences(studentId, preferences);

      return result;
    } catch (error: any) {
      console.error('[StudentRoute] Preferences update error:', error);
      set.status = 500;
      return { success: false, error: error.message || 'Failed to update preferences' };
    }
  })

  /**
   * Update student's About Me info (purpose, occupation, hobbies)
   * PUT /student/about-me
   */
  .put('/student/about-me', async ({ body, cookie, set }) => {
    
    try {
      const authCookie = cookie.studentAuth?.value;
      if (!authCookie) {
        console.error('[StudentRoute] No studentAuth cookie');
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(authCookie as string);
      if (!payload) {
        console.error('[StudentRoute] Invalid or expired token');
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const studentId = payload.userId;

      const aboutMe = body as {
        purpose: string;
        occupation: string;
        hobbies: string[];
        bio: string;
      };

      const studentService = new StudentService();
      const result = await studentService.updateAboutMe(studentId, aboutMe);

      return result;
    } catch (error: any) {
      console.error('[StudentRoute] About Me update error:', error);
      set.status = 500;
      return { success: false, error: error.message || 'Failed to update about me' };
    }
  })

  /**
   * Save last viewed lesson for student
   * PUT /student/last-viewed-lesson
   */
  .put('/student/last-viewed-lesson', async ({ body, cookie, set }) => {
    try {
      const authCookie = cookie.studentAuth?.value;
      if (!authCookie) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(authCookie as string);
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const studentId = payload.userId;

      const lesson = body as {
        sessionId?: string;
        courseId: string;
        lessonId: string;
        lessonNumber: number;
        title: string;
        goal: string;
        viewedAt: number;
      };

      const studentService = new StudentService();
      const result = await studentService.saveLastViewedLesson(studentId, lesson);

      return result;
    } catch (error: any) {
      console.error('[StudentRoute] Save last viewed lesson error:', error);
      set.status = 500;
      return { success: false, error: error.message || 'Failed to save last viewed lesson' };
    }
  })

  /**
   * Get last viewed lesson for student
   * GET /student/last-viewed-lesson
   */
  .get('/student/last-viewed-lesson', async ({ cookie, set, query }) => {
    try {
      const authCookie = cookie.studentAuth?.value;
      if (!authCookie) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(authCookie as string);
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const studentId = payload.userId;

      const studentService = new StudentService();
      const sessionId = typeof query.sessionId === 'string' ? query.sessionId : undefined;
      const result = await studentService.getLastViewedLesson(studentId, sessionId);

      return result;
    } catch (error: any) {
      console.error('[StudentRoute] Get last viewed lesson error:', error);
      set.status = 500;
      return { success: false, error: error.message || 'Failed to get last viewed lesson' };
    }
  })

  /**
   * Get student's favorite tutors with pagination
   * GET /student/favorites?page=1&limit=10
   */
  .get('/student/favorites', async ({ cookie, set, query }) => {
    try {
      const authCookie = cookie.studentAuth?.value;
      if (!authCookie) {
        set.status = 401;
        return { success: false, error: 'Not authenticated', data: { favorites: [], total: 0, page: 1, limit: 10, totalPages: 0 } };
      }

      const payload = await verifyAuthToken(authCookie as string);
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token', data: { favorites: [], total: 0, page: 1, limit: 10, totalPages: 0 } };
      }
      const studentId = payload.userId;

      // Parse pagination params with defaults
      const page = Math.max(1, parseInt(query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(query.limit as string) || 10));

      const result = await favoritesService.getFavorites(studentId, page, limit);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[StudentRoute] Get favorites error:', error);
      set.status = 500;
      return { success: false, error: error.message || 'Failed to get favorites', data: { favorites: [], total: 0, page: 1, limit: 10, totalPages: 0 } };
    }
  })

  /**
   * Add a tutor to favorites
   * POST /student/favorites/:tutorId
   * Rate limited: 30 actions per minute
   */
  .post('/student/favorites/:tutorId', async ({ params, cookie, set }) => {
    try {
      const authCookie = cookie.studentAuth?.value;
      if (!authCookie) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(authCookie as string);
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const studentId = payload.userId;

      // Rate limiting check
      const rateLimitError = await rateLimitMiddleware(studentId, 'favorites', set as any);
      if (rateLimitError) return rateLimitError;

      const { tutorId } = params;
      const result = await favoritesService.addFavorite(studentId, tutorId);
      return result;
    } catch (error: any) {
      console.error('[StudentRoute] Add favorite error:', error);
      set.status = 500;
      return { success: false, error: error.message || 'Failed to add favorite' };
    }
  })

  /**
   * Remove a tutor from favorites
   * DELETE /student/favorites/:tutorId
   */
  .delete('/student/favorites/:tutorId', async ({ params, cookie, set }) => {
    try {
      const authCookie = cookie.studentAuth?.value;
      if (!authCookie) {
        set.status = 401;
        return { success: false, error: 'Not authenticated' };
      }

      const payload = await verifyAuthToken(authCookie as string);
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }
      const studentId = payload.userId;

      const { tutorId } = params;
      const result = await favoritesService.removeFavorite(studentId, tutorId);
      return result;
    } catch (error: any) {
      console.error('[StudentRoute] Remove favorite error:', error);
      set.status = 500;
      return { success: false, error: error.message || 'Failed to remove favorite' };
    }
  })

  /**
   * Check if a tutor is in favorites
   * GET /student/favorites/:tutorId/check
   */
  .get('/student/favorites/:tutorId/check', async ({ params, cookie, set }) => {
    try {
      const authCookie = cookie.studentAuth?.value;
      if (!authCookie) {
        set.status = 401;
        return { success: false, isFavorite: false };
      }

      const payload = await verifyAuthToken(authCookie as string);
      if (!payload) {
        set.status = 401;
        return { success: false, isFavorite: false };
      }
      const studentId = payload.userId;

      const { tutorId } = params;
      const isFavorite = await favoritesService.isFavorite(studentId, tutorId);
      return { success: true, isFavorite };
    } catch (error: any) {
      console.error('[StudentRoute] Check favorite error:', error);
      set.status = 500;
      return { success: false, isFavorite: false };
    }
  });

export default Student;
