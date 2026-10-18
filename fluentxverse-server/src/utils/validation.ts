/**
 * Validation utilities for FluentXVerse API
 * Provides reusable schema patterns and custom validators
 */
import { t, type TSchema } from "elysia";

// ============================================
// Common Regex Patterns
// ============================================
export const PATTERNS = {
  // Email: RFC 5322 simplified
  EMAIL: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  
  // Password: min 8 chars, 1 uppercase, 1 lowercase, 1 number
  PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/,
  
  // Phone: E.164 format or common formats
  PHONE: /^(\+?[1-9]\d{1,14}|0\d{10,11})$/,
  
  // UUID v4
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  
  // Date: ISO 8601 date (YYYY-MM-DD)
  DATE_ISO: /^\d{4}-\d{2}-\d{2}$/,
  
  // Date-time: ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ)
  DATETIME_ISO: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/,
  
  // Time: HH:mm or HH:mm:ss
  TIME: /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/,
  
  // Alphanumeric with spaces
  ALPHANUMERIC_SPACE: /^[a-zA-Z0-9\s]+$/,
  
  // Name: letters, spaces, hyphens, apostrophes
  NAME: /^[a-zA-ZÀ-ÿ\s'-]{1,100}$/,
  
  // Slug: lowercase letters, numbers, hyphens
  SLUG: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  
  // Wallet address: Ethereum format
  ETH_ADDRESS: /^0x[a-fA-F0-9]{40}$/,
  
  // No HTML/script tags
  NO_HTML: /^[^<>]*$/,
  
  // Zip code (US or PH format)
  ZIP_CODE: /^(\d{5}(-\d{4})?|\d{4})$/,
} as const;

// ============================================
// Custom Type Validators
// ============================================

/**
 * Email with format validation
 */
export const Email = () => t.String({
  format: 'email',
  pattern: PATTERNS.EMAIL.source,
  minLength: 5,
  maxLength: 255,
  description: 'Valid email address',
  error: 'Invalid email format'
});

/**
 * Strong password validation
 */
export const Password = () => t.String({
  minLength: 8,
  maxLength: 128,
  pattern: PATTERNS.PASSWORD.source,
  description: 'Password must be at least 8 characters with uppercase, lowercase, and number',
  error: 'Password must be at least 8 characters with uppercase, lowercase, and number'
});

/**
 * Simple password (for login - no pattern enforcement)
 */
export const LoginPassword = () => t.String({
  minLength: 1,
  maxLength: 128,
  description: 'Account password'
});

/**
 * Safe string - prevents XSS by blocking HTML tags
 */
export const SafeString = (opts?: { minLength?: number; maxLength?: number }) => t.String({
  minLength: opts?.minLength ?? 1,
  maxLength: opts?.maxLength ?? 1000,
  pattern: PATTERNS.NO_HTML.source,
  error: 'Input contains invalid characters'
});

/**
 * Name field validation
 */
export const Name = (opts?: { minLength?: number; maxLength?: number }) => t.String({
  minLength: opts?.minLength ?? 1,
  maxLength: opts?.maxLength ?? 100,
  pattern: PATTERNS.NAME.source,
  description: 'Name (letters, spaces, hyphens, apostrophes only)',
  error: 'Invalid name format'
});

/**
 * Phone number validation
 */
export const PhoneNumber = () => t.String({
  pattern: PATTERNS.PHONE.source,
  minLength: 10,
  maxLength: 15,
  description: 'Phone number in E.164 or common format',
  error: 'Invalid phone number format'
});

/**
 * UUID validation
 */
export const UUID = () => t.String({
  pattern: PATTERNS.UUID.source,
  description: 'UUID v4 format',
  error: 'Invalid UUID format'
});

/**
 * ID string (flexible - allows custom ID formats)
 */
export const ID = () => t.String({
  minLength: 1,
  maxLength: 100,
  pattern: PATTERNS.NO_HTML.source,
  description: 'Resource identifier'
});

/**
 * ISO date string (YYYY-MM-DD)
 */
export const DateString = () => t.String({
  pattern: PATTERNS.DATE_ISO.source,
  description: 'Date in ISO format (YYYY-MM-DD)',
  error: 'Invalid date format. Use YYYY-MM-DD'
});

/**
 * ISO datetime string
 */
export const DateTimeString = () => t.String({
  pattern: PATTERNS.DATETIME_ISO.source,
  description: 'Date-time in ISO format',
  error: 'Invalid date-time format'
});

/**
 * Time string (HH:mm or HH:mm:ss)
 */
export const TimeString = () => t.String({
  pattern: PATTERNS.TIME.source,
  description: 'Time in HH:mm or HH:mm:ss format',
  error: 'Invalid time format. Use HH:mm'
});

/**
 * Ethereum wallet address
 */
export const WalletAddress = () => t.String({
  pattern: PATTERNS.ETH_ADDRESS.source,
  description: 'Ethereum wallet address (0x...)',
  error: 'Invalid wallet address format'
});

/**
 * Pagination limit with bounds
 */
export const PaginationLimit = (defaultVal = 20, maxVal = 100) => t.Optional(t.Number({
  minimum: 1,
  maximum: maxVal,
  default: defaultVal,
  description: `Number of items per page (max: ${maxVal})`
}));

/**
 * Pagination offset
 */
export const PaginationOffset = (defaultVal = 0) => t.Optional(t.Number({
  minimum: 0,
  default: defaultVal,
  description: 'Number of items to skip'
}));

/**
 * Page number (1-indexed)
 */
export const PageNumber = () => t.Optional(t.Number({
  minimum: 1,
  default: 1,
  description: 'Page number (starts at 1)'
}));

/**
 * URL validation
 */
export const URL = () => t.String({
  format: 'uri',
  maxLength: 2048,
  description: 'Valid URL',
  error: 'Invalid URL format'
});

/**
 * Zip/Postal code
 */
export const ZipCode = () => t.String({
  pattern: PATTERNS.ZIP_CODE.source,
  description: 'Zip or postal code',
  error: 'Invalid zip code format'
});

// ============================================
// Common Schema Patterns
// ============================================

/**
 * Standard API success response
 */
export const SuccessResponse = <T extends TSchema>(dataSchema: T) => t.Object({
  success: t.Literal(true),
  data: dataSchema
});

/**
 * Standard API error response
 */
export const ErrorResponse = () => t.Object({
  success: t.Literal(false),
  error: t.String()
});

/**
 * Paginated list response
 */
export const PaginatedResponse = <T extends TSchema>(itemSchema: T) => t.Object({
  success: t.Literal(true),
  data: t.Object({
    items: t.Array(itemSchema),
    total: t.Number(),
    page: t.Number(),
    limit: t.Number(),
    hasMore: t.Boolean()
  })
});

/**
 * Standard pagination query params
 */
export const PaginationQuery = {
  query: t.Object({
    page: PageNumber(),
    limit: PaginationLimit(),
    offset: PaginationOffset()
  })
};

// ============================================
// Validation Helpers
// ============================================

/**
 * Validate and sanitize a string against XSS
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  return PATTERNS.EMAIL.test(email);
}

/**
 * Validate password strength
 */
export function isStrongPassword(password: string): boolean {
  return PATTERNS.PASSWORD.test(password);
}

/**
 * Validate UUID format
 */
export function isValidUUID(uuid: string): boolean {
  return PATTERNS.UUID.test(uuid);
}

/**
 * Validate date string
 */
export function isValidDate(dateStr: string): boolean {
  if (!PATTERNS.DATE_ISO.test(dateStr)) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

/**
 * Check if date is in the future
 */
export function isFutureDate(dateStr: string): boolean {
  const date = new Date(dateStr);
  return date > new Date();
}

/**
 * Check if date is in the past
 */
export function isPastDate(dateStr: string): boolean {
  const date = new Date(dateStr);
  return date < new Date();
}

/**
 * Validate age from birth date (must be at least minAge)
 */
export function isValidAge(birthDate: string, minAge: number = 13): boolean {
  const birth = new Date(birthDate);
  const today = new Date();
  const age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    return age - 1 >= minAge;
  }
  return age >= minAge;
}

export default {
  PATTERNS,
  Email,
  Password,
  LoginPassword,
  SafeString,
  Name,
  PhoneNumber,
  UUID,
  ID,
  DateString,
  DateTimeString,
  TimeString,
  WalletAddress,
  PaginationLimit,
  PaginationOffset,
  PageNumber,
  URL,
  ZipCode,
  SuccessResponse,
  ErrorResponse,
  PaginatedResponse,
  PaginationQuery,
  sanitizeString,
  isValidEmail,
  isStrongPassword,
  isValidUUID,
  isValidDate,
  isFutureDate,
  isPastDate,
  isValidAge,
};
