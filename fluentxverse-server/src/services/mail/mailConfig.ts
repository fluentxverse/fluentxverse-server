import { z } from 'zod';
import { MailError } from './mailPolicy';
const connection = z.object({ host: z.string().min(1).max(253).regex(/^[a-z0-9.-]+$/i), port: z.number().int().min(1).max(65535), user: z.string().min(1).max(254), passwordEnv: z.string().regex(/^[A-Z][A-Z0-9_]+$/) }).strict();
const schema = z.array(z.object({
  id: z.string().regex(/^[a-z0-9-]{1,50}$/), label: z.string().min(1).max(80), address: z.email().max(254),
  adminIds: z.array(z.string().min(1).max(100)).max(100).default([]),
  shared: z.boolean().default(false),
  imap: connection, smtp: connection.extend({ secure: z.boolean().default(true) }), sentFolder: z.string().max(255).optional(),
}).strict()).max(10);
export type MailboxConfig = z.infer<typeof schema>[number] & { imapPassword: string; smtpPassword: string };
export type MailActor = { userId: string; role?: string };
export function mailConfigs(env: Record<string, string | undefined> = process.env): MailboxConfig[] {
  try {
    const configured = env.MAIL_ACCOUNTS_JSON?.trim() ? JSON.parse(env.MAIL_ACCOUNTS_JSON) : [];
    if (env.TUTOR) {
      if (!Array.isArray(configured)) throw new Error('Invalid mailbox list');
      const existing = configured.find((a: any) => a.address?.toLowerCase() === 'tutor@fluentxverse.com');
      if (existing) Object.assign(existing, { shared: true, adminIds: [], imap: { ...existing.imap, passwordEnv: 'TUTOR' }, smtp: { ...existing.smtp, passwordEnv: 'TUTOR' } });
      else configured.push({ id: 'tutor', label: 'Tutor Applications', address: 'tutor@fluentxverse.com', shared: true, adminIds: [],
        imap: { host: 'mail.spacemail.com', port: 993, user: 'tutor@fluentxverse.com', passwordEnv: 'TUTOR' },
        smtp: { host: 'mail.spacemail.com', port: 465, secure: true, user: 'tutor@fluentxverse.com', passwordEnv: 'TUTOR' } });
    }
    const configs = schema.parse(configured);
    if (new Set(configs.map(account => account.id)).size !== configs.length) throw new Error('Duplicate mailbox');
    return configs.map(account => {
      const imapPassword = env[account.imap.passwordEnv], smtpPassword = env[account.smtp.passwordEnv];
      if (!imapPassword || !smtpPassword) throw new Error('Missing password');
      return { ...account, imapPassword, smtpPassword };
    });
  } catch { throw new MailError(503, 'Email configuration is incomplete. Ask a system administrator to check the server configuration.'); }
}
export const mayUseMailbox = (actor: MailActor, account: MailboxConfig) =>
  ['admin', 'superadmin'].includes(actor.role || '') && (account.shared || account.adminIds.includes(actor.userId));
