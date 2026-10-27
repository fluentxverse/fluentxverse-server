import { ImapFlow, type FetchMessageObject, type SearchObject } from 'imapflow';
import nodemailer from 'nodemailer';
import MimeComposer from 'nodemailer/lib/mail-composer';
import { simpleParser } from 'mailparser';
import type { MailAction, MailAddress, MailDraft, MailFolder, MailMessage, MailPage, MailSummary } from '../../../../shared/mail';
import type { MailboxConfig } from './mailConfig';
import { checkSend, decodeFiles, MailError, MAX_MESSAGE, safeFilename, safeMailHtml, safeReceivedHtml } from './mailPolicy';
import { renderTutorConfirmationEmail, tutorConfirmationLogo, TUTOR_CONFIRMATION_SUBJECT, TUTOR_LOGO_CID } from './tutorConfirmation.template';

export interface MailProvider {
  folders(account: MailboxConfig): Promise<MailFolder[]>;
  list(account: MailboxConfig, folder: string, page: number, search: string, filter: string): Promise<MailPage>;
  message(account: MailboxConfig, folder: string, uid: number, validity: string): Promise<MailMessage>;
  attachment(account: MailboxConfig, folder: string, uid: number, validity: string, index: number): Promise<{ name: string; content: Buffer }>;
  action(account: MailboxConfig, folder: string, validity: string, uids: number[], action: MailAction, destination?: string): Promise<void>;
  createFolder(account: MailboxConfig, name: string): Promise<void>;
  verify(account: MailboxConfig): Promise<void>;
  send(account: MailboxConfig, draft: MailDraft, requestId: string): Promise<{ messageId: string; warning?: string }>;
}
const addresses = (items: any[] | undefined): MailAddress[] => (items || []).filter(item => item.address).map(item => ({ name: item.name || '', address: item.address }));
const summary = (message: FetchMessageObject): MailSummary => ({
  uid: message.uid, subject: message.envelope?.subject || '(No subject)',
  from: addresses(message.envelope?.from), to: addresses(message.envelope?.to),
  date: new Date(message.envelope?.date || message.internalDate || 0).toISOString(),
  seen: Boolean(message.flags?.has('\\Seen')), starred: Boolean(message.flags?.has('\\Flagged')),
  hasAttachments: JSON.stringify(message.bodyStructure || {}).includes('attachment'), messageId: message.envelope?.messageId || '',
});
let connections = 0;
async function withClient<T>(account: MailboxConfig, callback: (client: ImapFlow) => Promise<T>): Promise<T> {
  if (connections >= 6) throw new MailError(429, 'Email is busy. Try again shortly.');
  connections++;
  const client = new ImapFlow({ host: account.imap.host, port: account.imap.port, secure: true,
    auth: { user: account.imap.user, pass: account.imapPassword }, tls: { rejectUnauthorized: true }, logger: false,
    connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 30000, disableAutoIdle: true });
  client.on('error', () => {});
  try { await client.connect(); return await callback(client); }
  catch (error) { if (error instanceof MailError) throw error; throw new MailError(502, 'The email provider could not complete this request. Check the connection and try again.'); }
  finally { try { if (client.usable) await client.logout(); } catch {} client.close(); connections--; }
}
async function withFolder<T>(account: MailboxConfig, folder: string, validity: string | undefined, readOnly: boolean, callback: (client: ImapFlow) => Promise<T>) {
  return withClient(account, async client => {
    const lock = await client.getMailboxLock(folder, { readOnly });
    try {
      if (validity && String(client.mailbox && client.mailbox.uidValidity) !== validity) throw new MailError(409, 'This folder changed on the provider. Refresh before continuing.');
      return await callback(client);
    } finally { lock.release(); }
  });
}
async function parseMessage(client: ImapFlow, uid: number) {
  const message = await client.fetchOne(uid, { envelope: true, flags: true, size: true, bodyStructure: true }, { uid: true });
  if (!message) throw new MailError(404, 'Message no longer exists in this folder.');
  if ((message.size || 0) > MAX_MESSAGE) throw new MailError(413, 'This message exceeds the 20 MB reading limit.');
  const download = await client.download(String(uid), undefined, { uid: true, maxBytes: MAX_MESSAGE + 1 });
  if (!download?.content) throw new MailError(404, 'Message could not be downloaded.');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of download.content) {
    size += chunk.length;
    if (size > MAX_MESSAGE) { download.content.destroy(); throw new MailError(413, 'This message exceeds the 20 MB reading limit.'); }
    chunks.push(Buffer.from(chunk));
  }
  const parsed = await simpleParser(Buffer.concat(chunks), { skipHtmlToText: false, skipTextToHtml: true, skipImageLinks: true });
  return { message, parsed };
}
function smtp(account: MailboxConfig) {
  return nodemailer.createTransport({ host: account.smtp.host, port: account.smtp.port, secure: account.smtp.secure,
    requireTLS: !account.smtp.secure, tls: { rejectUnauthorized: true }, auth: { user: account.smtp.user, pass: account.smtpPassword },
    connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 30000, disableFileAccess: true, disableUrlAccess: true });
}
export async function buildOutgoingMessage(account: MailboxConfig, draft: MailDraft, requestId: string) {
  const { to, cc, bcc } = checkSend(draft), messageId = `<${requestId}@${account.address.split('@')[1]}>`;
  const rich = composedMimeContent(draft.html ? safeMailHtml(draft.html) : '');
  const message = new MimeComposer({ from: { name: account.label, address: account.address }, to, cc, bcc, subject: draft.subject, text: draft.text,
    html: draft.html ? rich.html : undefined, messageId, inReplyTo: draft.inReplyTo || undefined, references: draft.references,
    attachments: [...decodeFiles(draft.attachments), ...rich.attachments], disableFileAccess: true, disableUrlAccess: true }).compile();
  // Bcc belongs in the SMTP envelope, never in the wire message's headers.
  message.keepBcc = false;
  return { raw: await message.build(), messageId, envelope: { from: account.address, to: [...new Set([...to, ...cc, ...bcc])] } };
}
export async function buildTutorConfirmationMessage(account: MailboxConfig, recipient: string, url: string) {
  if (account.address.toLowerCase() !== 'tutor@fluentxverse.com') throw new MailError(503, 'Tutor sender is unavailable.');
  const content = renderTutorConfirmationEmail(url);
  const { to } = checkSend({ to: recipient, cc: '', bcc: '', subject: TUTOR_CONFIRMATION_SUBJECT, text: content.text } as MailDraft);
  if (to.length !== 1) throw new MailError(400, 'One confirmation recipient is required.');
  const messageId = '<' + crypto.randomUUID() + '@fluentxverse.com>';
  const raw = await new MimeComposer({ from: { name: 'FluentXVerse Tutor Applications', address: account.address }, to,
    subject: TUTOR_CONFIRMATION_SUBJECT, ...content, messageId,
    attachments: [{ filename: 'fluentxverse-icon.png', contentType: 'image/png', content: tutorConfirmationLogo(),
      cid: TUTOR_LOGO_CID, contentDisposition: 'inline' }], disableFileAccess: true, disableUrlAccess: true }).compile().build();
  return { raw, envelope: { from: account.address, to }, messageId };
}
async function sendBuiltMessage(account: MailboxConfig, message: Awaited<ReturnType<typeof buildOutgoingMessage>>) {
  const { raw, envelope, messageId } = message, transport = smtp(account);
  let result;
  try { result = await transport.sendMail({ envelope, raw, disableFileAccess: true, disableUrlAccess: true }); }
  finally { transport.close(); }
  let warning = result.rejected.length ? `${result.rejected.length} recipient(s) were rejected by the provider. Check before resending.` : '';
  try {
    await withClient(account, async client => {
      const folder = account.sentFolder || (await client.list()).find(item => item.specialUse === '\\Sent')?.path;
      if (!folder) throw new Error('Sent folder missing');
      if (!await client.append(folder, raw, ['\\Seen'])) throw new Error('Sent copy not accepted');
    });
  } catch { warning = [warning, 'SMTP accepted the message, but saving the Sent copy failed. Do not resend.'].filter(Boolean).join(' '); }
  return { messageId, ...(warning ? { warning } : {}) };
}

// Only this fixed server-owned template bypasses the interactive composer's styling limits.
export async function sendTutorConfirmationMail(account: MailboxConfig, recipient: string, url: string) {
  return sendBuiltMessage(account, await buildTutorConfirmationMessage(account, recipient, url));
}
export const mailProvider: MailProvider = {
  folders: account => withClient(account, async client => (await client.list({ statusQuery: { messages: true, unseen: true } }))
    .filter(folder => !folder.flags.has('\\Noselect')).map(folder => ({ path: folder.path, name: folder.name,
      role: folder.path.toUpperCase() === 'INBOX' ? 'inbox' : (folder.specialUse || '').replace('\\', '').toLowerCase(),
      total: folder.status?.messages || 0, unread: folder.status?.unseen || 0 }))),
  list: (account, folder, requestedPage, search, filter) => withFolder(account, folder, undefined, true, async client => {
    const query: SearchObject = { deleted: false };
    if (search) query.or = [{ from: search }, { to: search }, { subject: search }, { body: search }];
    if (filter === 'unread') query.seen = false;
    if (filter === 'starred') query.flagged = true;
    const ids = await client.search(query, { uid: true });
    const sorted = (ids || []).sort((a, b) => b - a), pages = Math.max(1, Math.ceil(sorted.length / 25)), page = Math.min(requestedPage, pages);
    const selected = sorted.slice((page - 1) * 25, page * 25), messages: MailSummary[] = [];
    if (selected.length) for await (const message of client.fetch(selected.join(','), { envelope: true, flags: true, bodyStructure: true, internalDate: true }, { uid: true })) messages.push(summary(message));
    messages.sort((a, b) => b.uid - a.uid);
    return { messages, total: sorted.length, page, pages, uidValidity: String(client.mailbox && client.mailbox.uidValidity) };
  }),
  message: (account, folder, uid, validity) => withFolder(account, folder, validity, true, async client => {
    const { message, parsed } = await parseMessage(client, uid);
    return { ...summary(message), replyTo: addresses(parsed.replyTo?.value), cc: addresses(Array.isArray(parsed.cc) ? parsed.cc.flatMap(item => item.value) : parsed.cc?.value),
      text: parsed.text || '', html: parsed.html ? safeReceivedHtml(parsed.html, parsed.attachments) : '', references: typeof parsed.references === 'string' ? [parsed.references] : parsed.references || [],
      attachments: parsed.attachments.map((file, index) => ({ index, name: safeFilename(file.filename || 'attachment'), type: file.contentType, size: file.size })) };
  }),
  attachment: (account, folder, uid, validity, index) => withFolder(account, folder, validity, true, async client => {
    const { parsed } = await parseMessage(client, uid), file = parsed.attachments[index];
    if (!file) throw new MailError(404, 'Attachment not found.');
    return { name: safeFilename(file.filename || 'attachment'), content: file.content };
  }),
  action: (account, folder, validity, uids, action, destination) => withFolder(account, folder, validity, false, async client => {
    const range = uids.join(',');
    if (action === 'read' || action === 'star') await client.messageFlagsAdd(range, [action === 'read' ? '\\Seen' : '\\Flagged'], { uid: true });
    else if (action === 'unread' || action === 'unstar') await client.messageFlagsRemove(range, [action === 'unread' ? '\\Seen' : '\\Flagged'], { uid: true });
    else {
      const folders = await client.list();
      const special = { archive: '\\Archive', trash: '\\Trash', spam: '\\Junk' };
      const target = action === 'move' ? destination : folders.find(item => item.specialUse === special[action as keyof typeof special])?.path;
      if (!target || target === folder || !folders.some(item => item.path === target && !item.flags.has('\\Noselect'))) throw new MailError(409, 'The destination folder is unavailable. Choose another folder.');
      await client.messageMove(range, target, { uid: true });
    }
  }),
  createFolder: (account, name) => withClient(account, async client => { await client.mailboxCreate(name); }),
  verify: async account => { await withClient(account, async () => {}); const transport = smtp(account); try { await transport.verify(); } catch { throw new MailError(502, 'SMTP connection failed. Check provider credentials and TLS settings.'); } finally { transport.close(); } },
  send: async (account, draft, requestId) => sendBuiltMessage(account, await buildOutgoingMessage(account, draft, requestId)),
};
import { composedMimeContent } from './mailCompose';
