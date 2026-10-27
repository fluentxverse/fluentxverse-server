import { describe, expect, test } from 'bun:test';
import Elysia from 'elysia';
import { MailService } from '../src/services/mail/mailService';
import { MailError, checkSend, readMailJson, safeMailHtml, safeReceivedHtml, validateDraft } from '../src/services/mail/mailPolicy';
import { mailConfigs } from '../src/services/mail/mailConfig';
import { createMailRoute } from '../src/routes/mail.route';
import type { MailDraft, MailSendResult } from '../../shared/mail';
import type { MailRepository } from '../src/services/mail/mailRepository';
import type { MailProvider } from '../src/services/mail/mailProvider';
import { buildOutgoingMessage } from '../src/services/mail/mailProvider';
import { simpleParser } from 'mailparser';

const account = { id: 'support', label: 'FluentXVerse Support', address: 'support@example.test', shared: false, adminIds: ['owner', 'staff'], imap: { host: 'imap.example.test', port: 993, user: 'support', passwordEnv: 'MAIL_PASS' }, smtp: { host: 'smtp.example.test', port: 465, secure: true, user: 'support', passwordEnv: 'MAIL_PASS' }, imapPassword: 'PRIVATE', smtpPassword: 'PRIVATE' };
const actor = { userId: 'owner', role: 'superadmin' };
const draft = (): MailDraft => ({ id: crypto.randomUUID(), accountId: 'support', to: 'student@example.test', cc: '', bcc: '', subject: 'Lesson update', text: 'Hello from FluentXVerse.', html: '<p>Hello from FluentXVerse.</p>', attachments: [], inReplyTo: '', references: [], revision: 1, updatedAt: new Date().toISOString() });
function fixture() {
  const rows = new Map<string, MailDraft>(), results = new Map<string, MailSendResult>();
  const key = (owner: string, id: string) => owner + ':' + id;
  let sent = 0, fail = false;
  const repository: MailRepository = {
    async listDrafts(owner, account) { return [...rows].filter(([id, row]) => id.startsWith(owner + ':') && row.accountId === account).map(([, row]) => row); },
    async getDraft(owner, account, id) { const row = rows.get(key(owner, id)); if (!row || row.accountId !== account) throw new MailError(404, 'Draft not found.'); return row; },
    async saveDraft(owner, input) { const previous = rows.get(key(owner, input.id)); if (previous && previous.revision !== input.revision) throw new MailError(409, 'Conflict'); const data = { ...input, revision: input.revision + 1, updatedAt: new Date().toISOString() }; rows.set(key(owner, data.id), data); return data; },
    async deleteDraft(owner, account, id) { const row = rows.get(key(owner, id)); if (row?.accountId === account) rows.delete(key(owner, id)); },
    async preferences() { return { signature: '', contacts: [] }; }, async savePreferences() {},
    async sendResult(owner, account, id, request) { return results.get(key(owner, request)) || null; },
    async reserveSend(owner, account, id, revision, request) { const previous = results.get(key(owner, request)); if (previous) return previous; results.set(key(owner, request), { status: 'sending' }); return null; },
    async finishSend(owner, request, value) { results.set(key(owner, request), value); },
  };
  const provider: MailProvider = {
    async folders() { return []; }, async list() { return { messages: [], total: 0, page: 1, pages: 1, uidValidity: '10' }; },
    async message() { throw new MailError(404, 'Message not found.'); }, async attachment() { return { name: 'notes.txt', content: Buffer.from('private attachment') }; },
    async action() {}, async createFolder() {}, async verify() {},
    async send() { sent++; await Bun.sleep(5); if (fail) throw new Error('SMTP outcome unknown'); return { messageId: '<sent@example.test>' }; },
  };
  return { service: new MailService(repository, provider, () => [account]), rows, results, sent: () => sent, fail: () => { fail = true; } };
}
describe('email boundaries', () => {
  test('unconfigured state is honest; secrets and provider hosts never appear in status', () => {
    expect(new MailService(undefined, undefined, () => []).status(actor)).toEqual({ accounts: [], configured: false });
    const status = fixture().service.status(actor);
    expect(status.accounts).toEqual([{ id: 'support', label: account.label, address: account.address }]);
    expect(JSON.stringify(status)).not.toMatch(/PRIVATE|password|imap\./);
  });
  test('staff require an explicit account grant and cannot cross mailboxes', () => {
    const service = fixture().service;
    expect(() => service.status({ userId: 'other', role: 'admin' })).toThrow('Email access');
    expect(service.status({ userId: 'staff', role: 'admin' }).accounts).toHaveLength(1);
    expect(() => service.account(actor, 'missing')).toThrow('unavailable');
  });
  test('personal mailboxes have no superadmin bypass; support is shared with administrators only', async () => {
    const personal = { ...account, id: 'personal', adminIds: ['staff'], shared: false };
    const support = { ...account, shared: true, adminIds: [] };
    const service = new MailService(undefined, undefined, () => [personal, support]);
    expect(service.status({ userId: 'staff', role: 'admin' }).accounts.map(item => item.id)).toEqual(['personal', 'support']);
    expect(service.status(actor).accounts.map(item => item.id)).toEqual(['support']);
    expect(service.status({ userId: 'other', role: 'admin' }).accounts.map(item => item.id)).toEqual(['support']);
    expect(() => service.account(actor, 'personal')).toThrow('unavailable');
    expect(() => service.folders(actor, 'personal')).toThrow('unavailable');
    expect(() => service.attachment(actor, 'personal', 'INBOX', 1, '10', 0)).toThrow('unavailable');
    expect(() => service.listDrafts(actor, 'personal')).toThrow('unavailable');
    await expect(service.send(actor, 'personal', crypto.randomUUID(), 1, crypto.randomUUID())).rejects.toThrow('unavailable');
    expect(() => service.status({ userId: 'staff', role: 'student' })).toThrow('Email access');
    expect(() => new MailService(undefined, undefined, () => [personal]).status(actor)).toThrow('Email access');
  });
  test('missing secrets and malformed configurations fail closed', () => {
    expect(mailConfigs({})).toEqual([]);
    expect(() => mailConfigs({ MAIL_ACCOUNTS_JSON: '{broken' })).toThrow('configuration');
    const { imapPassword, smtpPassword, ...config } = account;
    expect(() => mailConfigs({ MAIL_ACCOUNTS_JSON: JSON.stringify([config]) })).toThrow('configuration');
    expect(mailConfigs({ MAIL_ACCOUNTS_JSON: JSON.stringify([config]), MAIL_PASS: 'secret' })[0]?.imapPassword).toBe('secret');
  });
  test('rejects header injection, undeclared fields and oversized attachments', () => {
    const { updatedAt, ...input } = draft();
    expect(() => validateDraft({ ...input, subject: 'Hi\r\nBcc: stolen@example.test' })).toThrow('Invalid draft');
    expect(() => validateDraft({ ...input, from: 'spoof@example.test' })).toThrow('Invalid draft');
    expect(() => validateDraft({ ...input, attachments: [{ name: 'x', type: 'text/plain', data: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') }] })).toThrow();
    expect(() => checkSend({ ...draft(), to: 'not an email' })).toThrow('valid email');
    expect(() => checkSend({ ...draft(), subject: '' })).toThrow('subject');
  });
  test('streaming JSON limits apply even without a Content-Length header', async () => {
    let chunks = 0;
    const body = new ReadableStream({ pull(controller) { if (++chunks > 15) controller.close(); else controller.enqueue(new Uint8Array(1024 * 1024)); } });
    const request = new Request('http://localhost/admin/mail/support/drafts', { method: 'PUT', body });
    await expect(readMailJson(request)).rejects.toThrow('10 MB limit'); expect(chunks).toBeLessThan(15);
  });
  test('rich text removes scripts, remote images, styles, tracking and unsafe links', () => {
    const html = safeMailHtml('<p onclick="steal()">Hi<strong>there</strong></p><script>steal()</script><img src="https://tracker.test/x"><a href="javascript:steal()">bad</a><a href="https://fluentxverse.com">good</a><iframe src="https://tracker.test"/>');
    expect(html).toContain('<strong>there</strong>'); expect(html).toContain('https://fluentxverse.com');
    expect(html).not.toMatch(/script|onclick|tracker|iframe|javascript|<img/);
    const received = safeReceivedHtml('<table><tr><td style="color:#0255ff;background:url(https://tracker.test)">Details</td></tr></table><img src="https://tracker.test"><style>@import url(https://tracker.test);</style><form><input name="secret"></form>');
    expect(received).toContain('<table>'); expect(received).toContain('color:#0255ff'); expect(received).toContain('background:var(--mail-bg-0,none)'); expect(received).not.toMatch(/url\s*\(|@import|<form|<input|<img src=/);
    expect(received).toContain('data-mail-src="https://tracker.test/"');
  });
  test('draft ownership, account binding and optimistic versions remain scoped', async () => {
    const { service } = fixture(), { updatedAt, ...input } = draft(); input.revision = 0;
    const saved = await service.saveDraft(actor, 'support', input);
    expect(saved.revision).toBe(1);
    expect(await service.listDrafts({ userId: 'staff', role: 'admin' }, 'support')).toEqual([]);
    await expect(service.saveDraft(actor, 'support', { ...input, revision: 0 })).rejects.toThrow('Conflict');
    expect(() => service.saveDraft(actor, 'support', { ...input, accountId: 'other' })).toThrow('does not match');
  });
  test('real MIME generation retains rich content, reply references and attachments without leaking Bcc', async () => {
    const value = { ...draft(), cc: 'coordinator@example.test', bcc: 'private@example.test', inReplyTo: '<original@example.test>', references: ['<original@example.test>'], attachments: [{ name: 'notes.txt', type: 'text/plain', data: Buffer.from('Private notes').toString('base64') }], html: '<p>Hello <strong>there</strong></p><img src="https://tracker.test/pixel">' };
    const { raw, envelope, messageId } = await buildOutgoingMessage(account, value, crypto.randomUUID());
    const parsed = await simpleParser(raw);
    expect(envelope.from).toBe(account.address); expect(envelope.to).toContain('private@example.test');
    expect(parsed.bcc).toBeUndefined(); expect(raw.toString()).not.toContain('private@example.test');
    expect(parsed.from?.value[0]?.address).toBe(account.address); expect(parsed.html).toContain('<strong>there</strong>'); expect(parsed.html).not.toContain('tracker');
    expect(parsed.inReplyTo).toBe('<original@example.test>'); expect(parsed.messageId).toBe(messageId);
    expect(parsed.attachments[0]?.content.toString()).toBe('Private notes');
  });
  test('duplicate and concurrent send requests reach the transport once', async () => {
    const f = fixture(), value = draft(), id = crypto.randomUUID(); f.rows.set('owner:' + value.id, value);
    const results = await Promise.all([f.service.send(actor, 'support', value.id, 1, id), f.service.send(actor, 'support', value.id, 1, id)]);
    expect(results.some(result => result.status === 'sent')).toBe(true); expect(f.sent()).toBe(1);
    expect((await f.service.send(actor, 'support', value.id, 1, id)).status).toBe('sent'); expect(f.sent()).toBe(1);
  });
  test('unknown SMTP outcomes preserve draft and never silently resend', async () => {
    const f = fixture(), value = draft(), id = crypto.randomUUID(); f.rows.set('owner:' + value.id, value); f.fail();
    expect((await f.service.send(actor, 'support', value.id, 1, id)).status).toBe('unknown');
    expect(f.rows.has('owner:' + value.id)).toBe(true);
    expect((await f.service.send(actor, 'support', value.id, 1, id)).status).toBe('unknown'); expect(f.sent()).toBe(1);
  });
  test('routes enforce auth, origin, strict schemas and non-cacheable downloads', async () => {
    const f = fixture(); let authenticated = true;
    const app = new Elysia().use(createMailRoute(f.service, async (_cookie, set) => { if (!authenticated) { set.status = 401; return null; } return { ...actor, email: 'admin@example.test' }; }));
    const request = (path: string, method = 'GET', body?: unknown, origin = 'https://dashboard.fluentxverse.com') => app.handle(new Request('http://localhost/admin/mail' + path, { method, headers: { 'Content-Type': 'application/json', origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    const status = await request('/status'); expect(status.status).toBe(200); expect(status.headers.get('cache-control')).toBe('private, no-store');
    expect((await request('/support/verify', 'POST', {}, 'https://evil.test')).status).toBe(403);
    expect((await request('/support/messages/1')).status).toBe(400);
    expect((await request('/support/actions', 'POST', { folder: 'INBOX', uidValidity: '10', uids: [1], action: 'delete-permanently' })).status).toBe(400);
    const file = await request('/support/messages/1/attachments/0?folder=INBOX&uidValidity=10'); expect(file.status).toBe(200); expect(file.headers.get('content-disposition')).toContain('attachment'); expect(file.headers.get('content-type')).toBe('application/octet-stream'); expect(file.headers.get('cache-control')).toBe('private, no-store');
    authenticated = false; expect((await request('/status')).status).toBe(401);
  });
});
