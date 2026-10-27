import { db } from '../../db/postgres';
import type { MailDraft, MailPreferences, MailSendResult } from '../../../../shared/mail';
import { MailError } from './mailPolicy';

export interface MailRepository {
  listDrafts(owner: string, account: string): Promise<MailDraft[]>;
  getDraft(owner: string, account: string, id: string): Promise<MailDraft>;
  saveDraft(owner: string, draft: Omit<MailDraft, 'updatedAt'>): Promise<MailDraft>;
  deleteDraft(owner: string, account: string, id: string): Promise<void>;
  preferences(owner: string): Promise<MailPreferences>;
  savePreferences(owner: string, preferences: MailPreferences): Promise<void>;
  sendResult(owner: string, account: string, draftId: string, requestId: string): Promise<MailSendResult | null>;
  reserveSend(owner: string, account: string, draftId: string, revision: number, requestId: string): Promise<MailSendResult | null>;
  finishSend(owner: string, requestId: string, result: MailSendResult): Promise<void>;
}
let initialized: Promise<void> | undefined;
async function ensureTables() {
  if (!initialized) initialized = (async () => {
    await db`CREATE TABLE IF NOT EXISTS admin_mail_drafts (owner_id text NOT NULL, id uuid NOT NULL, account_id text NOT NULL, revision integer NOT NULL, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (owner_id,id))`;
    await db`CREATE TABLE IF NOT EXISTS admin_mail_preferences (owner_id text PRIMARY KEY, payload jsonb NOT NULL)`;
    await db`CREATE TABLE IF NOT EXISTS admin_mail_sends (owner_id text NOT NULL, request_id uuid NOT NULL, account_id text NOT NULL, draft_id uuid NOT NULL, draft_revision integer NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (owner_id,request_id))`;
    await db`CREATE INDEX IF NOT EXISTS admin_mail_sends_rate ON admin_mail_sends(owner_id,created_at)`;
  })().catch(error => { initialized = undefined; throw error; });
  return initialized;
}
const draftRow = (row: any): MailDraft => ({ ...row.payload, revision: row.revision, updatedAt: new Date(row.updated_at).toISOString() });
export const mailRepository: MailRepository = {
  async listDrafts(owner, account) { await ensureTables(); return (await db`SELECT * FROM admin_mail_drafts WHERE owner_id=${owner} AND account_id=${account} ORDER BY updated_at DESC LIMIT 100`).map(draftRow); },
  async getDraft(owner, account, id) {
    await ensureTables(); const row = (await db`SELECT * FROM admin_mail_drafts WHERE owner_id=${owner} AND account_id=${account} AND id=${id}`)[0];
    if (!row) throw new MailError(404, 'Draft not found.'); return draftRow(row);
  },
  async saveDraft(owner, draft) {
    await ensureTables();
    return db.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`admin-mail-drafts:${owner}`}))`;
    if (!draft.revision) {
      const count = (await tx`SELECT count(*)::int AS count FROM admin_mail_drafts WHERE owner_id=${owner}`)[0];
      if (count.count >= 100) throw new MailError(409, 'You have 100 saved drafts. Delete an older draft before creating another.');
    }
    const rows = await tx`INSERT INTO admin_mail_drafts (owner_id,id,account_id,revision,payload)
      SELECT ${owner},${draft.id}::uuid,${draft.accountId},1,${draft}::jsonb WHERE ${draft.revision}=0 OR EXISTS(SELECT 1 FROM admin_mail_drafts WHERE owner_id=${owner} AND id=${draft.id})
      ON CONFLICT(owner_id,id) DO UPDATE SET payload=EXCLUDED.payload, revision=admin_mail_drafts.revision+1, updated_at=now()
      WHERE admin_mail_drafts.revision=${draft.revision} AND admin_mail_drafts.account_id=${draft.accountId}
      RETURNING *`;
    if (!rows[0]) throw new MailError(409, 'This draft changed in another tab. Close the composer and reopen the saved draft.');
    return draftRow(rows[0]);
    });
  },
  async deleteDraft(owner, account, id) { await ensureTables(); await db`DELETE FROM admin_mail_drafts WHERE owner_id=${owner} AND account_id=${account} AND id=${id}`; },
  async preferences(owner) { await ensureTables(); return (await db`SELECT payload FROM admin_mail_preferences WHERE owner_id=${owner}`)[0]?.payload || { signature: '', contacts: [] }; },
  async savePreferences(owner, preferences) { await ensureTables(); await db`INSERT INTO admin_mail_preferences VALUES (${owner},${preferences}::jsonb) ON CONFLICT(owner_id) DO UPDATE SET payload=EXCLUDED.payload`; },
  async sendResult(owner, account, draftId, requestId) {
    await ensureTables();
    const row = (await db`SELECT * FROM admin_mail_sends WHERE owner_id=${owner} AND (request_id=${requestId} OR (account_id=${account} AND draft_id=${draftId})) ORDER BY (request_id=${requestId}) DESC,created_at LIMIT 1`)[0];
    if (row && (row.account_id !== account || row.draft_id !== draftId)) throw new MailError(409, 'Send request does not match this draft.');
    return row?.result || null;
  },
  async reserveSend(owner, account, draftId, revision, requestId) {
    await ensureTables();
    return db.begin(async tx => {
      // Serializing per operator makes request deduplication and send-rate accounting atomic.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`admin-mail:${owner}`}))`;
      const existing = (await tx`SELECT * FROM admin_mail_sends WHERE owner_id=${owner} AND request_id=${requestId}`)[0];
      if (existing) {
        if (existing.account_id !== account || existing.draft_id !== draftId) throw new MailError(409, 'Send request does not match this draft.');
        return existing.result as MailSendResult;
      }
      const sending = (await tx`SELECT result FROM admin_mail_sends WHERE owner_id=${owner} AND account_id=${account} AND draft_id=${draftId} LIMIT 1`)[0];
      if (sending) return sending.result as MailSendResult;
      const stored = (await tx`SELECT revision FROM admin_mail_drafts WHERE owner_id=${owner} AND account_id=${account} AND id=${draftId} FOR UPDATE`)[0];
      if (!stored || stored.revision !== revision) throw new MailError(409, 'Save the latest draft before sending.');
      const rate = (await tx`SELECT count(*)::int AS count FROM admin_mail_sends WHERE owner_id=${owner} AND created_at > now()-interval '1 minute'`)[0];
      if (rate.count >= 10) throw new MailError(429, 'Sending limit reached. Try again in a minute.');
      await tx`INSERT INTO admin_mail_sends (owner_id,request_id,account_id,draft_id,draft_revision,result) VALUES (${owner},${requestId},${account},${draftId},${revision},'{"status":"sending"}'::jsonb)`;
      return null;
    });
  },
  async finishSend(owner, requestId, result) {
    await ensureTables();
    await db.begin(async tx => {
      const rows = await tx`UPDATE admin_mail_sends SET result=${result}::jsonb WHERE owner_id=${owner} AND request_id=${requestId} RETURNING draft_id,account_id,draft_revision`;
      if (result.status === 'sent' && rows[0]) await tx`DELETE FROM admin_mail_drafts WHERE owner_id=${owner} AND id=${rows[0].draft_id} AND account_id=${rows[0].account_id} AND revision=${rows[0].draft_revision}`;
    });
  },
};
