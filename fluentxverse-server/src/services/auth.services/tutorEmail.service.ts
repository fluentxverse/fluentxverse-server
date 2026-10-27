import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getDriver } from '../../db/memgraph';
import { mailConfigs } from '../mail/mailConfig';
import { sendTutorConfirmationMail } from '../mail/mailProvider';
import { EMAIL_CONFIRMATION_TTL, EMAIL_RESEND_COOLDOWN, TutorEmailError, normalizedTutorEmail, tutorEmailVerified } from './tutorEmailPolicy';

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
let schema: Promise<void> | undefined;
async function ensureSchema() {
  return schema ??= (async () => {
    const s = getDriver().session();
    try {
      for (const property of ['tutorId', 'tokenHash'])
        await s.run(`CREATE CONSTRAINT ON (v:TutorEmailVerification) ASSERT v.${property} IS UNIQUE`);
    } finally { await s.close(); }
  })().catch(error => { schema = undefined; throw error; });
}
export function tutorConfirmationURL(token: string, env = process.env) {
  const origin = env.TUTOR_PUBLIC_URL || 'https://tutor.fluentxverse.com';
  const url = new URL(origin);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    (env.NODE_ENV === 'production' ? url.origin !== 'https://tutor.fluentxverse.com' :
      !(url.origin === 'https://tutor.fluentxverse.com' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))))
    throw new TutorEmailError(503, 'Tutor email confirmation is temporarily unavailable.');
  url.pathname = '/confirm-email';
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}
export async function sendTutorConfirmation(email: string, token: string) {
  const account = mailConfigs().find(a => a.address.toLowerCase() === 'tutor@fluentxverse.com');
  if (!account) throw new TutorEmailError(503, 'Tutor email confirmation is temporarily unavailable.');
  const url = tutorConfirmationURL(token);
  const result = await sendTutorConfirmationMail(account, email, url);
  // SMTP acceptance is not a guarantee of inbox delivery; never expose provider errors or tokens.
  return result.messageId;
}
export class TutorEmailService {
  constructor(private readonly deliver = sendTutorConfirmation, private readonly clock = Date.now) {}
  async status(tutorId: string) {
    const s = getDriver().session();
    try {
      const row = (await s.run('MATCH(u:User {id:$id}) OPTIONAL MATCH(v:TutorEmailVerification {tutorId:u.id}) RETURN u,v', { id: tutorId })).records[0];
      if (!row) throw new TutorEmailError(401, 'Tutor account not found.');
      const u = row.get('u').properties, v = row.get('v')?.properties;
      if (u.role && u.role !== 'tutor') throw new TutorEmailError(403, 'Tutor account required.');
      const sameEmail = v?.email === normalizedTutorEmail(u.email);
      return { verified: tutorEmailVerified(u), assessmentComplete: u.writtenExamPassed === true && u.speakingExamPassed === true, email: u.email, sender: 'tutor@fluentxverse.com',
        resendAvailableAt: sameEmail && v.lastRequestedAt ? Number(v.lastRequestedAt) + EMAIL_RESEND_COOLDOWN : 0,
        deliveryStatus: sameEmail ? v?.deliveryStatus || 'not_sent' : 'not_sent' };
    } finally { await s.close(); }
  }
  async send(tutorId: string) {
    await ensureSchema();
    const token = randomBytes(32).toString('base64url'), hash = tokenHash(token), now = this.clock();
    const s = getDriver().session();
    let claim: { email: string; verified: boolean };
    try {
      claim = await s.executeWrite(async tx => {
        const u = (await tx.run('MATCH(u:User {id:$id}) SET u.emailVerificationRevision=coalesce(u.emailVerificationRevision,0)+1 RETURN u', { id: tutorId })).records[0]?.get('u').properties;
        if (!u || (u.role && u.role !== 'tutor')) throw new TutorEmailError(401, 'Tutor account not found.');
        if (Date.parse(u.suspendedUntil || '') > now) throw new TutorEmailError(403, 'This account is suspended.');
        const email = normalizedTutorEmail(u.email);
        if (tutorEmailVerified(u)) return { email, verified: true };
        if (!z.email().safeParse(email).success) throw new TutorEmailError(409, 'Update your email address before requesting confirmation.');
        const old = (await tx.run('MATCH(v:TutorEmailVerification {tutorId:$id}) RETURN v', { id: tutorId })).records[0]?.get('v').properties;
        const last = Number(old?.lastRequestedAt || 0), window = Number(old?.windowStartedAt || 0);
        if (last + EMAIL_RESEND_COOLDOWN > now) throw new TutorEmailError(429, 'Please wait before requesting another confirmation email.', Math.ceil((last + EMAIL_RESEND_COOLDOWN - now) / 1000));
        const count = window + 3600_000 > now ? Number(old?.requestCount || 0) : 0;
        if (count >= 5) throw new TutorEmailError(429, 'Confirmation email limit reached. Please try again later.', Math.ceil((window + 3600_000 - now) / 1000));
        await tx.run(`MERGE(v:TutorEmailVerification {tutorId:$id}) SET v.email=$email,v.tokenHash=$hash,v.expiresAt=$expires,
          v.lastRequestedAt=$now,v.windowStartedAt=$window,v.requestCount=$count,v.addressVersion=$version,v.deliveryStatus='sending' REMOVE v.consumedAt`,
          { id: tutorId, email, hash, expires: now + EMAIL_CONFIRMATION_TTL, now, window: count ? window : now, count: count + 1, version: Number(u.emailAddressVersion || 0) });
        return { email, verified: false };
      });
    } finally { await s.close(); }
    if (claim.verified) return { verified: true, sent: false };
    let accepted = false;
    try { await this.deliver(claim.email, token); accepted = true; } catch { /* SMTP outcomes can be uncertain; keep the token valid until expiry/resend. */ }
    const update = getDriver().session();
    try { await update.run('MATCH(v:TutorEmailVerification {tutorId:$id,tokenHash:$hash}) SET v.deliveryStatus=$status', { id: tutorId, hash, status: accepted ? 'accepted' : 'unknown' }); }
    finally { await update.close(); }
    if (!accepted) throw new TutorEmailError(503, 'We could not confirm email delivery. Check your inbox or request another link after one minute.');
    return { verified: false, sent: true };
  }
  async confirm(token: string, actorId?: string) {
    if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new TutorEmailError(400, 'This confirmation link is invalid or expired. Request a new link.');
    const s = getDriver().session(), hash = tokenHash(token), now = this.clock();
    try {
      return await s.executeWrite(async tx => {
        const found = (await tx.run('MATCH(v:TutorEmailVerification {tokenHash:$hash}) RETURN v.tutorId AS id', { hash })).records[0]?.get('id');
        const invalid = () => new TutorEmailError(400, 'This confirmation link is invalid or expired. Request a new link.');
        if (!found) throw invalid();
        if (actorId && actorId !== found) throw new TutorEmailError(409, 'This link belongs to another tutor account. Sign out before confirming it.');
        const u = (await tx.run('MATCH(u:User {id:$id}) SET u.emailVerificationRevision=coalesce(u.emailVerificationRevision,0)+1 RETURN u', { id: found })).records[0]?.get('u').properties;
        const v = (await tx.run('MATCH(v:TutorEmailVerification {tutorId:$id,tokenHash:$hash}) RETURN v', { id: found, hash })).records[0]?.get('v').properties;
        if (!u || (u.role && u.role !== 'tutor') || !v || Number(v.expiresAt) <= now || !Number.isFinite(Number(v.expiresAt)) || v.email !== normalizedTutorEmail(u.email) || Number(v.addressVersion) !== Number(u.emailAddressVersion || 0)) throw invalid();
        if (Date.parse(u.suspendedUntil || '') > now) throw new TutorEmailError(403, 'This account is suspended.');
        await tx.run(`MATCH(u:User {id:$id}),(v:TutorEmailVerification {tutorId:$id,tokenHash:$hash})
          SET u.verifiedEmail=true,u.verifiedEmailAddress=$email,u.emailVerifiedAt=$now,v.consumedAt=$now REMOVE v.tokenHash`, { id: found, hash, email: v.email, now });
        return { verified: true };
      });
    } finally { await s.close(); }
  }
}
export const tutorEmailService = new TutorEmailService();
