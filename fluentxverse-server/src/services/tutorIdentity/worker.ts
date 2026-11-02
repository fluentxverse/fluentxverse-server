import { tutorIdentity, identityEnabled } from './service';
import { getDriver } from '../../db/memgraph';
import { mailConfigs } from '../mail/mailConfig';
import { mailProvider } from '../mail/mailProvider';
import type { MailDraft } from '../../../../shared/mail';
import { logger } from '../../utils/logger';
import { ensureTutorIdentitySchema } from './schema';
import { cleanupIdentityImageTemps } from './storage';

export async function deliverIdentityNotices() {
  const s = getDriver().session(), now = new Date().toISOString();
  try {
    const candidates = (await s.run(`MATCH(n:TutorIdentityNotice) WHERE n.status <> 'sent' AND n.nextAttempt <= $now
      RETURN n.id AS id ORDER BY n.nextAttempt LIMIT 20`, { now })).records;
    for (const row of candidates) {
      const id = row.get('id'), lease = new Date(Date.now() + 120000).toISOString();
      const claim = await s.executeWrite(async tx => {
        const r = (await tx.run(`MATCH(n:TutorIdentityNotice {id:$id}) SET n.revision=coalesce(n.revision,0)+1 RETURN n`, { id })).records[0];
        const n = r?.get('n').properties;
        if (!n || n.status === 'sent' || n.nextAttempt > now) return null;
        const u = (await tx.run('MATCH(u:User {id:$tutorId}) RETURN u.email AS email', { tutorId: n.tutorId })).records[0];
        await tx.run(`MATCH(n:TutorIdentityNotice {id:$id}) SET n.nextAttempt=$lease`, { id, lease });
        return { ...n, email: u?.get('email') };
      });
      if (!claim) continue;
      try {
        const account = mailConfigs().find(a => a.address === 'tutor@fluentxverse.com');
        if (!account || !claim.email) throw Error('Identity mail sender unavailable');
        const draft: MailDraft = { id, accountId: account.id, to: claim.email, cc: '', bcc: '',
          subject: 'Tutor application identity update', text: `${claim.text}\n\nContinue at https://tutor.fluentxverse.com/interview\n\nDo not send your ID by email.`,
          html: '', attachments: [], inReplyTo: '', references: [], revision: 0, updatedAt: now };
        await mailProvider.send(account, draft, `identity-${id.replace(/[^a-z0-9-]/gi, '-')}`);
        await s.run(`MATCH(n:TutorIdentityNotice {id:$id,nextAttempt:$lease}) SET n.status='sent',n.sentAt=$now`, { id, lease, now: new Date().toISOString() });
      } catch {
        await s.run(`MATCH(n:TutorIdentityNotice {id:$id,nextAttempt:$lease}) SET n.nextAttempt=$retry`, { id, lease, retry: new Date(Date.now() + 300000).toISOString() });
        logger.warn('Identity notification delivery pending');
      }
    }
  } finally { await s.close(); }
}
export function startTutorIdentityWorker() {
  if (!identityEnabled()) return;
  let running = false;
  let ready = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { if (!ready) { await ensureTutorIdentitySchema(); await tutorIdentity.recoverMissingImages(); ready = true; }
      try { await cleanupIdentityImageTemps(); await tutorIdentity.maintenance(); }
      catch { logger.error('Tutor identity retention requires attention'); }
      // Storage outages must not prevent already-committed review emails from being delivered.
      await deliverIdentityNotices();
    }
    catch { logger.error('Tutor identity maintenance requires attention'); }
    finally { running = false; }
  };
  void tick();
  setInterval(tick, 60000).unref();
}
