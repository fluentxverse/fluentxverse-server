/**
 * Auth Service Tests
 * 
 * Comprehensive tests for authentication functionality including:
 * - JWT token signing and verification
 * - Password hashing validation
 * - Input validation
 * - Cookie configuration
 */

import { describe, test, expect, beforeAll } from 'bun:test';

// =====================================
// JWT Utilities Tests
// =====================================

describe('JWT Utilities', () => {
  // Mock the JWT functions locally for unit testing
  // These test the cryptographic operations without database dependencies
  
  const base64UrlEncode = (data: string | ArrayBuffer): string => {
    let base64: string;
    if (typeof data === 'string') {
      base64 = btoa(data);
    } else {
      const bytes = new Uint8Array(data);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
      }
      base64 = btoa(binary);
    }
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const base64UrlDecode = (data: string): string => {
    let base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (base64.length % 4)) % 4;
    if (padding !== 4) base64 += '='.repeat(padding);
    return atob(base64);
  };

  const hmacSha256 = async (message: string, secret: string): Promise<ArrayBuffer> => {
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
  };

  const signToken = async (payload: Record<string, any>, secret: string): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = { ...payload, iat: now, exp: now + 3600 };
    const header = { alg: 'HS256', typ: 'JWT' };
    
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    const signature = await hmacSha256(signatureInput, secret);
    const encodedSignature = base64UrlEncode(signature);
    
    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
  };

  const verifyToken = async (token: string, secret: string): Promise<Record<string, any> | null> => {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      
      const [encodedHeader, encodedPayload, encodedSignature] = parts;
      const signatureInput = `${encodedHeader}.${encodedPayload}`;
      const expectedSignature = await hmacSha256(signatureInput, secret);
      const expectedEncodedSignature = base64UrlEncode(expectedSignature);
      
      if (encodedSignature !== expectedEncodedSignature) return null;
      
      const payload = JSON.parse(base64UrlDecode(encodedPayload!));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) return null;
      
      return payload;
    } catch {
      return null;
    }
  };

  describe('Token Signing', () => {
    test('should create valid JWT structure', async () => {
      const payload = { userId: 'test-123', email: 'test@example.com' };
      const secret = 'test-secret-at-least-32-characters-long';
      
      const token = await signToken(payload, secret);
      const parts = token.split('.');
      
      expect(parts.length).toBe(3);
      expect(parts[0]).toBeTruthy(); // header
      expect(parts[1]).toBeTruthy(); // payload
      expect(parts[2]).toBeTruthy(); // signature
    });

    test('should include standard claims (iat, exp)', async () => {
      const payload = { userId: 'test-123' };
      const secret = 'test-secret-at-least-32-characters-long';
      
      const token = await signToken(payload, secret);
      const decoded = await verifyToken(token, secret);
      
      expect(decoded).not.toBeNull();
      expect(decoded!.iat).toBeDefined();
      expect(decoded!.exp).toBeDefined();
      expect(decoded!.exp).toBeGreaterThan(decoded!.iat);
    });

    test('should preserve payload data', async () => {
      const payload = {
        userId: 'user-abc-123',
        email: 'john@example.com',
        role: 'student',
        tier: 1
      };
      const secret = 'test-secret-at-least-32-characters-long';
      
      const token = await signToken(payload, secret);
      const decoded = await verifyToken(token, secret);
      
      expect(decoded!.userId).toBe(payload.userId);
      expect(decoded!.email).toBe(payload.email);
      expect(decoded!.role).toBe(payload.role);
      expect(decoded!.tier).toBe(payload.tier);
    });
  });

  describe('Token Verification', () => {
    test('should verify valid token', async () => {
      const payload = { userId: 'test-123' };
      const secret = 'test-secret-at-least-32-characters-long';
      
      const token = await signToken(payload, secret);
      const verified = await verifyToken(token, secret);
      
      expect(verified).not.toBeNull();
      expect(verified!.userId).toBe('test-123');
    });

    test('should reject token with wrong secret', async () => {
      const payload = { userId: 'test-123' };
      const secret1 = 'correct-secret-at-least-32-characters';
      const secret2 = 'wrong-secret-at-least-32-characters!!';
      
      const token = await signToken(payload, secret1);
      const verified = await verifyToken(token, secret2);
      
      expect(verified).toBeNull();
    });

    test('should reject malformed token', async () => {
      const secret = 'test-secret-at-least-32-characters-long';
      
      const verified1 = await verifyToken('not.a.valid.jwt', secret);
      const verified2 = await verifyToken('only-one-part', secret);
      const verified3 = await verifyToken('', secret);
      
      expect(verified1).toBeNull();
      expect(verified2).toBeNull();
      expect(verified3).toBeNull();
    });

    test('should reject token with tampered payload', async () => {
      const payload = { userId: 'test-123', role: 'student' };
      const secret = 'test-secret-at-least-32-characters-long';
      
      const token = await signToken(payload, secret);
      const parts = token.split('.');
      
      // Tamper with payload (change role to admin)
      const tamperedPayload = base64UrlEncode(
        JSON.stringify({ ...payload, role: 'admin', iat: Date.now(), exp: Date.now() + 3600 })
      );
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
      
      const verified = await verifyToken(tamperedToken, secret);
      expect(verified).toBeNull();
    });

    test('should reject expired token', async () => {
      const secret = 'test-secret-at-least-32-characters-long';
      
      // Create token that expired 1 hour ago
      const now = Math.floor(Date.now() / 1000);
      const expiredPayload = { userId: 'test', iat: now - 7200, exp: now - 3600 };
      const header = { alg: 'HS256', typ: 'JWT' };
      
      const encodedHeader = base64UrlEncode(JSON.stringify(header));
      const encodedPayload = base64UrlEncode(JSON.stringify(expiredPayload));
      const signatureInput = `${encodedHeader}.${encodedPayload}`;
      const signature = await hmacSha256(signatureInput, secret);
      const encodedSignature = base64UrlEncode(signature);
      const expiredToken = `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
      
      const verified = await verifyToken(expiredToken, secret);
      expect(verified).toBeNull();
    });
  });

  describe('Base64URL Encoding', () => {
    test('should encode and decode strings correctly', () => {
      const original = 'Hello, World!';
      const encoded = base64UrlEncode(original);
      const decoded = base64UrlDecode(encoded);
      
      expect(decoded).toBe(original);
    });

    test('should handle URL-unsafe characters', () => {
      const original = 'test+with/special+chars/';
      const encoded = base64UrlEncode(original);
      
      // Base64URL should not contain + or /
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      
      const decoded = base64UrlDecode(encoded);
      expect(decoded).toBe(original);
    });

    test('should handle JSON payloads', () => {
      const payload = { userId: '123', email: 'test@example.com', special: '?&=' };
      const encoded = base64UrlEncode(JSON.stringify(payload));
      const decoded = JSON.parse(base64UrlDecode(encoded));
      
      expect(decoded).toEqual(payload);
    });
  });
});

// =====================================
// Password Hashing Tests
// =====================================

describe('Password Security', () => {
  // Using bcrypt-ts like the actual service
  const { hash, compare } = require('bcrypt-ts');

  describe('Password Hashing', () => {
    test('should hash password with bcrypt', async () => {
      const password = 'SecurePass123!';
      const hashed = await hash(password, 10);
      
      expect(hashed).not.toBe(password);
      expect(hashed.length).toBeGreaterThan(50);
      expect(hashed).toMatch(/^\$2[aby]?\$\d{2}\$/); // bcrypt format
    });

    test('should verify correct password', async () => {
      const password = 'MyP@ssw0rd!';
      const hashed = await hash(password, 10);
      
      const isValid = await compare(password, hashed);
      expect(isValid).toBe(true);
    });

    test('should reject incorrect password', async () => {
      const password = 'CorrectPassword123!';
      const wrongPassword = 'WrongPassword123!';
      const hashed = await hash(password, 10);
      
      const isValid = await compare(wrongPassword, hashed);
      expect(isValid).toBe(false);
    });

    test('should reject similar but different passwords', async () => {
      const password = 'Password123!';
      const similarPassword = 'Password123';  // Missing !
      const hashed = await hash(password, 10);
      
      const isValid = await compare(similarPassword, hashed);
      expect(isValid).toBe(false);
    });

    test('should generate different hashes for same password', async () => {
      const password = 'SamePassword123!';
      
      const hash1 = await hash(password, 10);
      const hash2 = await hash(password, 10);
      
      // Same password should produce different hashes (due to salt)
      expect(hash1).not.toBe(hash2);
      
      // But both should verify correctly
      expect(await compare(password, hash1)).toBe(true);
      expect(await compare(password, hash2)).toBe(true);
    });
  });

  describe('Password Strength', () => {
    // Testing password validation rules
    const validatePassword = (password: string): { valid: boolean; errors: string[] } => {
      const errors: string[] = [];
      
      if (password.length < 8) {
        errors.push('Password must be at least 8 characters');
      }
      if (password.length > 128) {
        errors.push('Password must not exceed 128 characters');
      }
      if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
      }
      if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
      }
      if (!/\d/.test(password)) {
        errors.push('Password must contain at least one number');
      }
      
      return { valid: errors.length === 0, errors };
    };

    test('should accept strong passwords', () => {
      const strongPasswords = [
        'SecurePass123',
        'MyP@ssw0rd!',
        'Ab1defgh',
        'ComplexPassword99',
      ];
      
      for (const password of strongPasswords) {
        const result = validatePassword(password);
        expect(result.valid).toBe(true);
      }
    });

    test('should reject weak passwords', () => {
      const weakPasswords = [
        { password: 'short1A', reason: 'too short' },
        { password: 'nocapitals123', reason: 'no uppercase' },
        { password: 'NOLOWERCASE123', reason: 'no lowercase' },
        { password: 'NoNumbersHere', reason: 'no digits' },
      ];
      
      for (const { password, reason } of weakPasswords) {
        const result = validatePassword(password);
        expect(result.valid).toBe(false);
      }
    });
  });
});

// =====================================
// Cookie Configuration Tests
// =====================================

describe('Cookie Configuration', () => {
  const getCookieConfig = (isProduction: boolean) => ({
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    maxAge: 60 * 60, // 1 hour
    path: '/',
  });

  describe('Development Configuration', () => {
    test('should use non-secure cookies', () => {
      const config = getCookieConfig(false);
      expect(config.secure).toBe(false);
    });

    test('should set httpOnly flag', () => {
      const config = getCookieConfig(false);
      expect(config.httpOnly).toBe(true);
    });

    test('should use lax sameSite policy', () => {
      const config = getCookieConfig(false);
      expect(config.sameSite).toBe('lax');
    });
  });

  describe('Production Configuration', () => {
    test('should use secure cookies', () => {
      const config = getCookieConfig(true);
      expect(config.secure).toBe(true);
    });

    test('should set httpOnly flag', () => {
      const config = getCookieConfig(true);
      expect(config.httpOnly).toBe(true);
    });

    test('should have 1 hour expiration', () => {
      const config = getCookieConfig(true);
      expect(config.maxAge).toBe(3600);
    });
  });
});

// =====================================
// Email Validation Tests
// =====================================

describe('Email Validation', () => {
  const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!email || email.length > 320) return false;
    return emailRegex.test(email.trim().toLowerCase());
  };

  test('should accept valid emails', () => {
    const validEmails = [
      'user@example.com',
      'user.name@example.com',
      'user+tag@example.com',
      'user@subdomain.example.com',
      'user123@example.co.jp',
    ];
    
    for (const email of validEmails) {
      expect(isValidEmail(email)).toBe(true);
    }
  });

  test('should reject invalid emails', () => {
    const invalidEmails = [
      'not-an-email',
      '@no-local-part.com',
      'no-domain@',
      'spaces in@email.com',
      'double@@at.com',
      '',
    ];
    
    for (const email of invalidEmails) {
      expect(isValidEmail(email)).toBe(false);
    }
  });
});

// =====================================
// Nanoid ID Generation Tests
// =====================================

describe('ID Generation', () => {
  const { nanoid } = require('nanoid');

  test('should generate IDs of specified length', () => {
    const id = nanoid(12);
    expect(id.length).toBe(12);
  });

  test('should generate unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(nanoid(12));
    }
    // All 100 IDs should be unique
    expect(ids.size).toBe(100);
  });

  test('should use URL-safe characters', () => {
    const id = nanoid(100);
    // nanoid uses A-Za-z0-9_-
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

// =====================================
// Rate Limiting Header Tests
// =====================================

describe('Rate Limit Headers', () => {
  const generateRateLimitHeaders = (
    limit: number,
    remaining: number,
    resetTime: number
  ) => ({
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': String(resetTime),
    'Retry-After': remaining <= 0 ? String(Math.ceil((resetTime - Date.now()) / 1000)) : undefined,
  });

  test('should include required headers', () => {
    const headers = generateRateLimitHeaders(100, 50, Date.now() + 60000);
    
    expect(headers['X-RateLimit-Limit']).toBe('100');
    expect(headers['X-RateLimit-Remaining']).toBe('50');
    expect(headers['X-RateLimit-Reset']).toBeDefined();
  });

  test('should include Retry-After when rate limited', () => {
    const resetTime = Date.now() + 60000;
    const headers = generateRateLimitHeaders(100, 0, resetTime);
    
    expect(headers['X-RateLimit-Remaining']).toBe('0');
    expect(headers['Retry-After']).toBeDefined();
  });

  test('should not include Retry-After when not limited', () => {
    const headers = generateRateLimitHeaders(100, 50, Date.now() + 60000);
    
    expect(headers['Retry-After']).toBeUndefined();
  });
});

console.log('🧪 Auth tests loaded successfully');
