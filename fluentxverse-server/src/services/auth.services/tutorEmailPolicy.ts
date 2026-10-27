export const EMAIL_CONFIRMATION_TTL = 30 * 60_000;
export const EMAIL_RESEND_COOLDOWN = 60_000;
export class TutorEmailError extends Error {
  constructor(readonly status: number, message: string, readonly retryAfter?: number) { super(message); }
}
export function tutorEmailFailure(error: unknown, code: string) {
  return { status: error instanceof TutorEmailError ? error.status : ['VALIDATION', 'PARSE'].includes(code) ? 400 : 503,
    body: { success: false, error: error instanceof TutorEmailError ? error.message : 'Email confirmation is temporarily unavailable. Please try again.' },
    retryAfter: error instanceof TutorEmailError ? error.retryAfter : undefined };
}
export const normalizedTutorEmail = (email: string) => email.trim().toLowerCase();
export const tutorEmailVerified = (user: Record<string, any>) => user.verifiedEmail === true
  && typeof user.email === 'string' && user.verifiedEmailAddress === normalizedTutorEmail(user.email);
