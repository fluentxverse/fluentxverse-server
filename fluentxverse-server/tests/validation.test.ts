/**
 * Tests for validation utilities
 */
import { describe, expect, it } from 'bun:test';
import {
  isValidEmail,
  isStrongPassword,
  isValidUUID,
  isValidDate,
  isFutureDate,
  isPastDate,
  isValidAge,
  sanitizeString,
  PATTERNS,
} from '../src/utils/validation';

const toIsoDate = (date: Date) => {
  const isoDate = date.toISOString().split('T')[0];
  if (!isoDate) {
    throw new Error('Failed to format ISO date');
  }
  return isoDate;
};

describe('Email Validation', () => {
  it('should accept valid emails', () => {
    expect(isValidEmail('test@example.com')).toBe(true);
    expect(isValidEmail('user.name@domain.org')).toBe(true);
    expect(isValidEmail('user+tag@domain.co.uk')).toBe(true);
  });

  it('should reject invalid emails', () => {
    expect(isValidEmail('invalid')).toBe(false);
    expect(isValidEmail('missing@')).toBe(false);
    expect(isValidEmail('@nodomain.com')).toBe(false);
    expect(isValidEmail('spaces in@email.com')).toBe(false);
  });
});

describe('Password Validation', () => {
  it('should accept strong passwords', () => {
    expect(isStrongPassword('Password1')).toBe(true);
    expect(isStrongPassword('MyStr0ngP@ss')).toBe(true);
    expect(isStrongPassword('Test1234')).toBe(true);
  });

  it('should reject weak passwords', () => {
    expect(isStrongPassword('password')).toBe(false); // no uppercase or number
    expect(isStrongPassword('PASSWORD1')).toBe(false); // no lowercase
    expect(isStrongPassword('Password')).toBe(false); // no number
    expect(isStrongPassword('Pass1')).toBe(false); // too short
  });
});

describe('UUID Validation', () => {
  it('should accept valid UUIDs', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isValidUUID('6ba7b810-9dad-41d8-80b4-00c04fd430c8')).toBe(true);
  });

  it('should reject invalid UUIDs', () => {
    expect(isValidUUID('not-a-uuid')).toBe(false);
    expect(isValidUUID('550e8400-e29b-51d4-a716-446655440000')).toBe(false); // version 5
    expect(isValidUUID('550e8400-e29b-41d4-c716-446655440000')).toBe(false); // invalid variant
  });
});

describe('Date Validation', () => {
  it('should accept valid ISO dates', () => {
    expect(isValidDate('2024-01-15')).toBe(true);
    expect(isValidDate('2023-12-31')).toBe(true);
  });

  it('should reject invalid dates', () => {
    expect(isValidDate('2024/01/15')).toBe(false); // wrong format
    expect(isValidDate('01-15-2024')).toBe(false); // wrong order
    expect(isValidDate('2024-13-01')).toBe(false); // invalid month
    expect(isValidDate('invalid')).toBe(false);
  });

  it('should correctly identify future dates', () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    expect(isFutureDate(toIsoDate(futureDate))).toBe(true);
    expect(isFutureDate('2020-01-01')).toBe(false);
  });

  it('should correctly identify past dates', () => {
    expect(isPastDate('2020-01-01')).toBe(true);
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    expect(isPastDate(toIsoDate(futureDate))).toBe(false);
  });
});

describe('Age Validation', () => {
  it('should validate minimum age requirement', () => {
    // Person born 20 years ago
    const twentyYearsAgo = new Date();
    twentyYearsAgo.setFullYear(twentyYearsAgo.getFullYear() - 20);
    expect(isValidAge(toIsoDate(twentyYearsAgo), 13)).toBe(true);
    expect(isValidAge(toIsoDate(twentyYearsAgo), 18)).toBe(true);

    // Person born 10 years ago
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    expect(isValidAge(toIsoDate(tenYearsAgo), 13)).toBe(false);
  });
});

describe('String Sanitization', () => {
  it('should remove HTML tags', () => {
    expect(sanitizeString('<script>alert("xss")</script>')).toBe('scriptalert("xss")/script');
    expect(sanitizeString('<div>Hello</div>')).toBe('divHello/div');
  });

  it('should remove javascript: protocol', () => {
    expect(sanitizeString('javascript:alert(1)')).toBe('alert(1)');
  });

  it('should remove event handlers', () => {
    expect(sanitizeString('onclick=alert(1)')).toBe('alert(1)');
    expect(sanitizeString('onerror=malicious()')).toBe('malicious()');
  });

  it('should trim whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });
});

describe('Regex Patterns', () => {
  it('should validate phone numbers', () => {
    expect(PATTERNS.PHONE.test('+14155551234')).toBe(true);
    expect(PATTERNS.PHONE.test('09171234567')).toBe(true);
    expect(PATTERNS.PHONE.test('invalid')).toBe(false);
  });

  it('should validate Ethereum addresses', () => {
    expect(PATTERNS.ETH_ADDRESS.test('0x1234567890123456789012345678901234567890')).toBe(true);
    expect(PATTERNS.ETH_ADDRESS.test('not-an-address')).toBe(false);
    expect(PATTERNS.ETH_ADDRESS.test('0x123')).toBe(false); // too short
  });

  it('should validate time format', () => {
    expect(PATTERNS.TIME.test('09:30')).toBe(true);
    expect(PATTERNS.TIME.test('14:00')).toBe(true);
    expect(PATTERNS.TIME.test('23:59:59')).toBe(true);
    expect(PATTERNS.TIME.test('25:00')).toBe(false);
    expect(PATTERNS.TIME.test('9:30')).toBe(false); // needs leading zero
  });
});
