import { afterEach, describe, expect, test } from 'bun:test';
import { getAllowedOrigins, isAllowedOrigin, isAllowedStudentOrigin, isAllowedStudentRequest, isAllowedAdminMutationOrigin } from '../src/config/cors';
import { getCookieConfig } from '../src/utils/jwt';

const originalApiPublicUrl = process.env.API_PUBLIC_URL;
const originalCookieDomain = process.env.COOKIE_DOMAIN;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalApiPublicUrl === undefined) delete process.env.API_PUBLIC_URL;
  else process.env.API_PUBLIC_URL = originalApiPublicUrl;
  if (originalCookieDomain === undefined) delete process.env.COOKIE_DOMAIN;
  else process.env.COOKIE_DOMAIN = originalCookieDomain;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe('student production origin', () => {
  const allowed = getAllowedOrigins('https://student.fluentxverse.xyz');

  test('accepts only the exact configured scheme, host, and port', () => {
    expect(isAllowedOrigin('https://student.fluentxverse.xyz', allowed)).toBe(true);
    expect(isAllowedOrigin('http://student.fluentxverse.xyz', allowed)).toBe(false);
    expect(isAllowedOrigin('https://student.fluentxverse.xyz:8443', allowed)).toBe(false);
    expect(isAllowedOrigin('https://student.fluentxverse.xyz.evil.example', allowed)).toBe(false);
  });

  test('student routes exclude other app origins', () => {
    process.env.NODE_ENV = 'development';
    expect(isAllowedStudentOrigin('https://student.fluentxverse.xyz')).toBe(true);
    expect(isAllowedStudentOrigin('https://tutor.fluentxverse.xyz')).toBe(false);
    expect(isAllowedStudentOrigin('http://localhost:5174')).toBe(true);
    expect(isAllowedStudentOrigin('http://localhost:5173')).toBe(false);
  });

  test('production student routes reject local browser origins', () => {
    process.env.NODE_ENV = 'production';
    expect(isAllowedStudentOrigin('https://student.fluentxverse.xyz')).toBe(true);
    expect(isAllowedStudentOrigin('http://localhost:5174')).toBe(false);
    expect(isAllowedStudentRequest('http://localhost:5174', 'POST')).toBe(false);
  });

  test('student mutations require an allowed browser origin', () => {
    expect(isAllowedStudentRequest('https://student.fluentxverse.xyz', 'POST')).toBe(true);
    expect(isAllowedStudentRequest('https://tutor.fluentxverse.xyz', 'POST')).toBe(false);
    expect(isAllowedStudentRequest(null, 'POST')).toBe(false);
    expect(isAllowedStudentRequest(null, 'GET')).toBe(true);
  });
});

describe('session cookie policy', () => {
  test('the new production domain also uses a secure API-host-only cookie', () => {
    process.env.API_PUBLIC_URL = 'https://api.fluentxverse.com';
    delete process.env.COOKIE_DOMAIN;
    expect(getCookieConfig(true)).toMatchObject({httpOnly:true,secure:true,sameSite:'lax',domain:undefined});
  });
  test('production uses a secure API-host-only cookie', () => {
    process.env.API_PUBLIC_URL = 'https://api.fluentxverse.xyz';
    delete process.env.COOKIE_DOMAIN;
    expect(getCookieConfig(true)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      domain: undefined,
    });
  });

  test('local HTTP keeps its development cookie', () => {
    process.env.API_PUBLIC_URL = 'http://localhost:8765';
    expect(getCookieConfig(true)).toMatchObject({
      secure: false,
      sameSite: 'lax',
      domain: undefined,
    });
  });
});

describe('dual-domain migration origins', () => {
  for (const domain of ['fluentxverse.com', 'fluentxverse.xyz']) {
    test(`${domain} permits exact app origins without weakening role restrictions`, () => {
      process.env.NODE_ENV = 'production';
      const allowed = getAllowedOrigins();
      for (const app of ['student', 'tutor', 'dashboard']) {
        expect(isAllowedOrigin(`https://${app}.${domain}`, allowed)).toBe(true);
        expect(isAllowedOrigin(`http://${app}.${domain}`, allowed)).toBe(false);
        expect(isAllowedOrigin(`https://${app}.${domain}.evil.example`, allowed)).toBe(false);
      }
      expect(isAllowedStudentRequest(`https://student.${domain}`, 'POST')).toBe(true);
      expect(isAllowedStudentRequest(`https://tutor.${domain}`, 'POST')).toBe(false);
      expect(isAllowedStudentRequest(`https://dashboard.${domain}`, 'POST')).toBe(false);
      expect(isAllowedStudentRequest(`https://student.${domain}:8443`, 'POST')).toBe(false);
      expect(isAllowedAdminMutationOrigin(`https://dashboard.${domain}`)).toBe(true);
      expect(isAllowedAdminMutationOrigin(`https://student.${domain}`)).toBe(false);
      expect(isAllowedAdminMutationOrigin(`https://dashboard.${domain}.evil.example`)).toBe(false);
    });
  }
  test('administrator mutations reject absent and unrelated origins', () => {
    expect(isAllowedAdminMutationOrigin(null)).toBe(false);
    expect(isAllowedAdminMutationOrigin('https://evil.example')).toBe(false);
  });
});
