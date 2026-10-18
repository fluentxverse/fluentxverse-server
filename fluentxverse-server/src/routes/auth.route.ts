//** ELYSIA IMPORT */
import Elysia, { t } from "elysia";

//** SERVICE IMPORT */
import AuthService from "../services/auth.services/tutor.service";
import { TutorService } from "../services/tutor.services/tutor.service";
import { LoginSchema, RegisterSchema, LogoutSchema, MeSchema, UpdatePersonalInfoSchema, UpdateEmailSchema, UpdatePasswordSchema } from "../services/auth.services/auth.schema";
import type { LoginReturnParams } from "@/services/auth.services/auth.interface";
import { signAuthToken, verifyAuthToken, getCookieConfig, type JwtAuthPayload } from "../utils/jwt";
import { clearTutorSessionCookies, resolveTutorSession, setTutorSessionCookie } from '../utils/tutorSession';

// Define routes as an Elysia plugin instance to preserve route types
const Auth = new Elysia({ name: 'auth', prefix: '/tutor' })
    .post('/register', async ({ body, set }) => {
      try 
      {
        const authService = new AuthService();
        const result = await authService.register(body);

        // Immediately log the user in after successful registration
        const userData: LoginReturnParams = await authService.login({ email: body.email, password: body.password });

        // Create signed JWT token
        const token = await signAuthToken({
          userId: userData.id,
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          walletAddress: userData.walletAddress,
          mobileNumber: userData.mobileNumber,
          tier: userData.tier,
          role: 'tutor'
        });

        // Set httpOnly cookie with signed JWT
        setTutorSessionCookie(set, token);

        const responsePayload = {
          success: true,
          message: result.message,
          user: {
            ...userData,
            userId: userData.id
          }
        };
        
        return responsePayload;
        
      } catch (error: any) {
        
        // Handle EMAIL_EXISTS with proper 409 Conflict status
        if (error?.code === 'EMAIL_EXISTS' || error?.message === 'EMAIL_EXISTS') {
          return {
            success: false,
            message: 'Email is already registered',
            user: null
          };
        }
        
        // Re-throw other errors
        throw error;
      }

      }, RegisterSchema)


    .post('/login', async ({ body, set }) => {
      try {
        const authService = new AuthService();
        const userData = await authService.login(body);

        // Normalize user object (same pattern as student app)
        const normalizedUser = {
          id: userData.id,
          userId: userData.id,
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          mobileNumber: userData.mobileNumber,
          tier: userData.tier,
          role: userData.role || 'tutor',
          walletAddress: userData.walletAddress
        };

        // Create signed JWT token
        const token = await signAuthToken({
          userId: normalizedUser.userId,
          email: normalizedUser.email,
          firstName: normalizedUser.firstName,
          lastName: normalizedUser.lastName,
          mobileNumber: normalizedUser.mobileNumber,
          tier: normalizedUser.tier,
          role: normalizedUser.role,
          walletAddress: normalizedUser.walletAddress
        });

        // Set httpOnly cookie with signed JWT
        setTutorSessionCookie(set, token);
        
        return { success: true, user: normalizedUser };
      } catch (error: any) {
        
        // Handle specific error messages with appropriate status codes
        const errorMessage = error?.message || 'Login failed';
        
        // Return friendly error messages
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
    }, LoginSchema)
    
    .post('/logout', async ({ set }) => {
      clearTutorSessionCookies(set);
      return { success: true, message: 'Logged out successfully' };
    }, LogoutSchema)
    
    // Renew session cookie (extends maxAge) without re-authenticating
    .post('/refresh', async ({ request, set }) => {
      const payload = await resolveTutorSession(request);
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired session' };
      }

      // Issue a fresh JWT with extended expiry
      const newToken = await signAuthToken({
        userId: payload.userId,
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
        walletAddress: payload.walletAddress,
        mobileNumber: payload.mobileNumber,
        tier: payload.tier,
        role: payload.role
      });

      set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      set.headers['Pragma'] = 'no-cache';
      set.headers['Vary'] = 'Cookie';
      setTutorSessionCookie(set, newToken);
      return { success: true };
    })

    // Alias for /refresh at /tutor/refresh path
    .post('/tutor/refresh', async ({ request, set }) => {
      const payload = await resolveTutorSession(request);
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired session' };
      }

      // Issue a fresh JWT with extended expiry
      const newToken = await signAuthToken({
        userId: payload.userId,
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
        walletAddress: payload.walletAddress,
        mobileNumber: payload.mobileNumber,
        tier: payload.tier,
        role: payload.role
      });

      set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      set.headers['Pragma'] = 'no-cache';
      set.headers['Vary'] = 'Cookie';
      setTutorSessionCookie(set, newToken);
      return { success: true };
    })

    .get('/socket-token', async ({ request, set }) => {
      const payload = await resolveTutorSession(request);
      if (!payload) {
        set.status = 401;
        return { success: false, error: 'Invalid or expired token' };
      }

      const token = await signAuthToken({
        userId: payload.userId,
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
        walletAddress: payload.walletAddress,
        mobileNumber: payload.mobileNumber,
        tier: payload.tier,
        role: payload.role || 'tutor'
      }, 10 * 60);

      set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      set.headers['Pragma'] = 'no-cache';
      set.headers['Vary'] = 'Cookie';
      return { success: true, token };
    })
    
    .get('/me', async ({ request, set }) => {
      const payload = await resolveTutorSession(request);
      if (!payload) {
        set.status = 401;
        return { user: null, error: 'Invalid or expired session' };
      }

      try {
        // Refresh cookie on every /me call - issue new JWT
        const newToken = await signAuthToken({
          userId: payload.userId,
          email: payload.email,
          firstName: payload.firstName,
          lastName: payload.lastName,
          walletAddress: payload.walletAddress,
          mobileNumber: payload.mobileNumber,
          tier: payload.tier,
          role: payload.role
        });

        // Fetch profile picture from database
        const tutorService = new TutorService();
        const profilePicture = await tutorService.getCurrentProfilePicture(payload.userId);

        set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
        set.headers['Pragma'] = 'no-cache';
        set.headers['Vary'] = 'Cookie';
        setTutorSessionCookie(set, newToken);
        return { user: {
          userId: payload.userId,
          email: payload.email,
          firstName: payload.firstName ?? undefined,
          lastName: payload.lastName ?? undefined,
          walletAddress: payload.walletAddress ?? undefined,
          mobileNumber: payload.mobileNumber ?? undefined,
          tier: payload.tier ?? 1,
          profilePicture: profilePicture ?? undefined
        } };
      } catch (error: any) {
        console.error('Error restoring tutor session:', error);
        set.status = 500;
        return { user: null, error: 'Unable to restore session' };
      }
    }, MeSchema)

    .put('/user/personal-info', async ({ body, cookie, set }) => {
      try {
        const raw = cookie.tutorAuth?.value;
        if (!raw) throw new Error('Not authenticated');
        
        // Verify JWT token
        const payload = await verifyAuthToken(String(raw));
        if (!payload) throw new Error('Invalid or expired token');

        const authService = new AuthService();
        const result = await authService.updatePersonalInfo({
          userId: payload.userId,
          ...body
        });

        // Update mobileNumber in token if phoneNumber was updated
        const isProduction = process.env.NODE_ENV === 'production';
        const newToken = await signAuthToken({
          userId: payload.userId,
          email: payload.email,
          firstName: payload.firstName,
          lastName: payload.lastName,
          walletAddress: payload.walletAddress,
          mobileNumber: body.phoneNumber || payload.mobileNumber,
          tier: payload.tier,
          role: payload.role
        });
        
        cookie.tutorAuth?.set({
          value: newToken,
          ...getCookieConfig(isProduction)
        });

        set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
        set.headers['Pragma'] = 'no-cache';

        return { success: true, message: result.message };
      } catch (error: any) {
        console.error('Error updating personal info:', error);
        throw error;
      }
    }, UpdatePersonalInfoSchema)

    .get('/user/personal-info', async ({ cookie, set }) => {
      try {
        const raw = cookie.tutorAuth?.value;
        if (!raw) throw new Error('Not authenticated');
        
        // Verify JWT token
        const payload = await verifyAuthToken(String(raw));
        if (!payload) throw new Error('Invalid or expired token');

        const authService = new AuthService();
        const result = await authService.getPersonalInfo(payload.userId);

        set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
        set.headers['Pragma'] = 'no-cache';

        return { success: true, data: result };
      } catch (error: any) {
        console.error('Error getting personal info:', error);
        throw error;
      }
    })

    .put('/user/email', async ({ body, cookie, set }) => {
      try {
        const raw = cookie.tutorAuth?.value;
        if (!raw) throw new Error('Not authenticated');
        
        // Verify JWT token
        const payload = await verifyAuthToken(String(raw));
        if (!payload) throw new Error('Invalid or expired token');

        const authService = new AuthService();
        const result = await authService.updateEmail({
          userId: payload.userId,
          newEmail: body.newEmail,
          currentPassword: body.currentPassword
        });

        // Update email in token and refresh
        const isProduction = process.env.NODE_ENV === 'production';
        const newToken = await signAuthToken({
          userId: payload.userId,
          email: body.newEmail.toLowerCase(),
          firstName: payload.firstName,
          lastName: payload.lastName,
          walletAddress: payload.walletAddress,
          mobileNumber: payload.mobileNumber,
          tier: payload.tier,
          role: payload.role
        });
        
        cookie.tutorAuth?.set({
          value: newToken,
          ...getCookieConfig(isProduction)
        });

        set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
        set.headers['Pragma'] = 'no-cache';

        return { success: true, message: result.message };
      } catch (error: any) {
        console.error('Error updating email:', error);
        throw error;
      }
    }, UpdateEmailSchema)

    .put('/user/password', async ({ body, cookie, set }) => {
      try {
        const raw = cookie.tutorAuth?.value;
        if (!raw) throw new Error('Not authenticated');
        
        // Verify JWT token
        const payload = await verifyAuthToken(String(raw));
        if (!payload) throw new Error('Invalid or expired token');

        const authService = new AuthService();
        const result = await authService.updatePassword({
          userId: payload.userId,
          currentPassword: body.currentPassword,
          newPassword: body.newPassword
        });

        // Refresh token
        const isProduction = process.env.NODE_ENV === 'production';
        const newToken = await signAuthToken({
          userId: payload.userId,
          email: payload.email,
          firstName: payload.firstName,
          lastName: payload.lastName,
          walletAddress: payload.walletAddress,
          mobileNumber: payload.mobileNumber,
          tier: payload.tier,
          role: payload.role
        });
        
        cookie.tutorAuth?.set({
          value: newToken,
          ...getCookieConfig(isProduction)
        });

        set.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
        set.headers['Pragma'] = 'no-cache';

        return { success: true, message: result.message };
      } catch (error: any) {
        console.error('Error updating password:', error);
        throw error;
      }
    }, UpdatePasswordSchema)


export default Auth;
