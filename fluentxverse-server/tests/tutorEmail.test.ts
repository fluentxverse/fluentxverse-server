import { expect, test } from 'bun:test';
import { mailConfigs, mayUseMailbox } from '../src/services/mail/mailConfig';
import { MailService } from '../src/services/mail/mailService';
import { tutorConfirmationURL } from '../src/services/auth.services/tutorEmail.service';
import { tutorEmailFailure, tutorEmailVerified } from '../src/services/auth.services/tutorEmailPolicy';

test('tutor mailbox is shared with every admin, not students/tutors; secrets never enter the public account list', () => {
  const configs = mailConfigs({ TUTOR: 'synthetic-password-$-literal' });
  expect(configs).toHaveLength(1);
  expect(configs[0]!.address).toBe('tutor@fluentxverse.com');
  expect(configs[0]!.smtpPassword).toBe('synthetic-password-$-literal');
  for (const role of ['admin', 'superadmin']) {
    expect(mayUseMailbox({ userId: 'any-new-admin', role }, configs[0]!)).toBe(true);
    const publicStatus = new MailService(undefined, undefined, () => configs).status({ userId: 'any-new-admin', role });
    expect(JSON.stringify(publicStatus)).not.toMatch(/password|literal|smtp|imap/);
  }
  for (const role of ['tutor', 'student', '']) expect(mayUseMailbox({ userId: 'any', role }, configs[0]!)).toBe(false);
});
test('verification is bound to the current normalized address, not a JWT or unbound legacy flag', () => {
  expect(tutorEmailVerified({ email: 'Alice@example.test', verifiedEmail: true, verifiedEmailAddress: 'alice@example.test' })).toBe(true);
  expect(tutorEmailVerified({ email: 'changed@example.test', verifiedEmail: true, verifiedEmailAddress: 'alice@example.test' })).toBe(false);
  expect(tutorEmailVerified({ email: 'alice@example.test', verifiedEmail: true })).toBe(false);
});
test('adding shared tutor mail never grants another administrator a private mailbox', () => {
  const privateAccount = { id: 'private', label: 'Private', address: 'owner@example.test', shared: false, adminIds: ['owner'],
    imap: { host: 'mail.spacemail.com', port: 993, user: 'owner@example.test', passwordEnv: 'PRIVATE_PASS' },
    smtp: { host: 'mail.spacemail.com', port: 465, secure: true, user: 'owner@example.test', passwordEnv: 'PRIVATE_PASS' } };
  const configs = mailConfigs({ MAIL_ACCOUNTS_JSON: JSON.stringify([privateAccount]), PRIVATE_PASS: 'synthetic', TUTOR: 'synthetic-tutor' });
  const service = new MailService(undefined, undefined, () => configs);
  expect(service.status({ userId: 'different-admin', role: 'superadmin' }).accounts.map(a => a.id)).toEqual(['tutor']);
  expect(service.status({ userId: 'owner', role: 'admin' }).accounts.map(a => a.id)).toEqual(['private', 'tutor']);
});
test('confirmation URL is pinned in production and secrets stay in the fragment', () => {
  const url = new URL(tutorConfirmationURL('a'.repeat(43), { NODE_ENV: 'production' } as any));
  expect(url.origin).toBe('https://tutor.fluentxverse.com'); expect(url.pathname).toBe('/confirm-email');
  expect(url.search).toBe(''); expect(url.hash).toBe('#token=' + 'a'.repeat(43));
  for (const origin of ['https://evil.test', 'https://tutor.fluentxverse.com/redirect', 'https://user@tutor.fluentxverse.com'])
    expect(() => tutorConfirmationURL('a'.repeat(43), { NODE_ENV: 'production', TUTOR_PUBLIC_URL: origin } as any)).toThrow('unavailable');
  expect(JSON.stringify(tutorEmailFailure(new Error('PRIVATE_TOKEN'), 'UNKNOWN'))).not.toContain('PRIVATE_TOKEN');
});
