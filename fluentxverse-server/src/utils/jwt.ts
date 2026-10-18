/**
 * JWT Utilities for Cookie-based Authentication
 * 
 * Uses signed JWTs stored in httpOnly cookies for secure session management.
 * This prevents cookie tampering and provides cryptographic verification.
 */

import type { Cookie } from 'elysia';
import { isTokenInvalidatedBySignUpdate } from '../db/redis';

// JWT payload structure for auth cookies
export interface JwtAuthPayload {
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  familyName?: string;
  givenName?: string;
  walletAddress?: string;
  mobileNumber?: string;
  tier?: number;
  role?: string;
  // JWT standard claims
  sub?: string;   // Subject (often same as userId)
  name?: string;  // Display name
  iat?: number;   // Issued at
  exp?: number;   // Expiration
}

/**
 * Detect if the server is running on localhost based on API_PUBLIC_URL.
 * This allows NODE_ENV=production in Docker while still using correct
 * cookie settings for local development (no Secure flag, no domain).
 */
const isLocalhost = (): boolean => {
  const apiUrl = process.env.API_PUBLIC_URL || '';
  try {
    const hostname = new URL(apiUrl).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
};

// API-host-only cookies are available to the student app's credentialed API
// requests without exposing them to other app subdomains on either production domain.
const getCookieDomain = (): string | undefined => {
  if (isLocalhost()) return undefined;
  return process.env.COOKIE_DOMAIN || undefined;
};

/**
 * Cookie configuration helper.
 * Uses API_PUBLIC_URL to decide whether to enable Secure,
 * so it works correctly for both local Docker (http://localhost) and
 * deployed production (https://api.fluentxverse.com).
 */
export const getCookieConfig = (isProduction: boolean) => {
  // On localhost, always use development-safe cookie settings
  // even if NODE_ENV=production (common in Docker setups)
  const useSecureCookies = isProduction && !isLocalhost();
  
  return {
    httpOnly: true,
    secure: useSecureCookies,
    sameSite: 'lax' as const,
    maxAge: 60 * 60, // 1 hour
    path: '/',
    domain: getCookieDomain()
  };
};

// Get JWT secret from environment (with strict validation)
const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';
  
  // In production, JWT_SECRET is absolutely required
  if (isProduction) {
    if (!secret) {
      console.error('\n❌ FATAL: JWT_SECRET environment variable is not set!');
      console.error('   This is required in production for security.');
      console.error('   Please set a strong, random secret (min 32 characters).\n');
      process.exit(1);
    }
    if (secret.length < 32) {
      console.error('\n❌ FATAL: JWT_SECRET must be at least 32 characters long!');
      process.exit(1);
    }
    if (secret === 'change-me-in-production' || secret.includes('dev-secret')) {
      console.error('\n❌ FATAL: JWT_SECRET appears to be a default/dev value!');
      console.error('   Please use a secure, random secret in production.\n');
      process.exit(1);
    }
    return secret;
  }
  
  // In development, warn but allow default secret
  if (!secret || secret === 'change-me-in-production') {
    console.warn('⚠️  Warning: Using default JWT_SECRET. Set a proper secret in production!');
    return 'dev-secret-change-me-in-production-min-32-chars';
  }
  return secret;
};

/**
 * Sign a JWT token with the auth payload
 * @param payload - User data to encode in the token
 * @param expiresInSeconds - Token expiration time (default: 1 hour)
 * @returns Signed JWT string
 */
export async function signAuthToken(
  payload: Omit<JwtAuthPayload, 'iat' | 'exp'>,
  expiresInSeconds: number = 60 * 60 // 1 hour default
): Promise<string> {
  const secret = getJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  
  const fullPayload: JwtAuthPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  // Create JWT header
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  // Base64URL encode header and payload
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  
  // Create signature
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await hmacSha256(signatureInput, secret);
  const encodedSignature = base64UrlEncode(signature);

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

/**
 * Verify and decode a JWT token
 * @param token - JWT string to verify
 * @returns Decoded payload if valid, null if invalid/expired/revoked
 */
export async function verifyAuthToken(token: string): Promise<JwtAuthPayload | null> {
  try {
    const secret = getJwtSecret();
    const parts = token.split('.');
    
    if (parts.length !== 3) {
      console.warn('[JWT] Invalid token format');
      return null;
    }

    const encodedHeader = parts[0]!;
    const encodedPayload = parts[1]!;
    const encodedSignature = parts[2]!;

    // Verify signature
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = await hmacSha256(signatureInput, secret);
    const expectedEncodedSignature = base64UrlEncode(expectedSignature);

    if (encodedSignature !== expectedEncodedSignature) {
      console.warn('[JWT] Invalid signature');
      return null;
    }

    // Decode payload
    const payload: JwtAuthPayload = JSON.parse(base64UrlDecode(encodedPayload));

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      console.warn('[JWT] Token expired');
      return null;
    }

    // Check if token was invalidated by password change (signUpdate)
    if (payload.userId && payload.iat) {
      const isInvalidated = await isTokenInvalidatedBySignUpdate(payload.userId, payload.iat);
      if (isInvalidated) {
        console.warn('[JWT] Token invalidated by password change');
        return null;
      }
    }

    return payload;
  } catch (error) {
    console.error('[JWT] Verification error:', error);
    return null;
  }
}

/**
 * Verify an admin JWT token
 * Same as verifyAuthToken but checks for admin role
 */
export async function verifyAdminToken(token: string): Promise<JwtAuthPayload | null> {
  const payload = await verifyAuthToken(token);
  if (!payload) return null;
  
  // Check if user has admin role
  if (payload.role !== 'admin' && payload.role !== 'superadmin') {
    console.warn('🚫 Token valid but user is not admin:', payload.userId);
    return null;
  }
  
  return payload;
}

/**
 * Decode a JWT without verifying (for debugging/logging only)
 * DO NOT use this for authentication - always use verifyAuthToken
 */
export function decodeTokenUnsafe(token: string): JwtAuthPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(base64UrlDecode(parts[1]!));
  } catch {
    return null;
  }
}

// ============ Helper Functions ============

function base64UrlEncode(data: string | ArrayBuffer): string {
  let base64: string;
  
  if (typeof data === 'string') {
    base64 = btoa(data);
  } else {
    // ArrayBuffer (from HMAC)
    const bytes = new Uint8Array(data);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    base64 = btoa(binary);
  }
  
  // Convert to base64url
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str: string): string {
  // Add padding if needed
  let padded = str;
  const padding = 4 - (str.length % 4);
  if (padding !== 4) {
    padded += '='.repeat(padding);
  }
  
  // Convert from base64url to base64
  const base64 = padded
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  
  return atob(base64);
}

async function hmacSha256(message: string, secret: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  return crypto.subtle.sign('HMAC', key, messageData);
}

// ============ Cookie Helper Functions ============

/**
 * Verify JWT from cookie and return payload
 * Throws an error if not authenticated or invalid token
 */
export async function verifyAuthCookie(
  cookieValue: string | undefined,
  cookieName: string = 'tutorAuth'
): Promise<JwtAuthPayload> {
  if (!cookieValue) {
    throw new Error('Not authenticated');
  }
  
  const payload = await verifyAuthToken(cookieValue);
  if (!payload) {
    throw new Error('Invalid or expired token');
  }
  
  return payload;
}

/**
 * Refresh JWT cookie with new expiry
 * Call this on authenticated requests to extend session
 */
export async function refreshJwtCookie(
  cookie: Record<string, Cookie<any>>,
  payload: JwtAuthPayload,
  cookieName: 'tutorAuth' | 'studentAuth' | 'adminAuth' = 'tutorAuth'
): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';
  const newToken = await signAuthToken({
    userId: payload.userId,
    email: payload.email,
    firstName: payload.firstName,
    lastName: payload.lastName,
    familyName: payload.familyName,
    givenName: payload.givenName,
    walletAddress: payload.walletAddress,
    mobileNumber: payload.mobileNumber,
    tier: payload.tier,
    role: payload.role
  });
  
  cookie[cookieName]?.set({
    value: newToken,
    ...getCookieConfig(isProduction)
  });
}
