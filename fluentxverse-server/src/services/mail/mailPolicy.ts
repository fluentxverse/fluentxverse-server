import { z } from 'zod';
import { MAX_INLINE_IMAGE_BYTES, sanitizeComposedHtml } from './mailCompose';
import type { MailDraft, MailFile } from '../../../../shared/mail';
export { safeReceivedHtml } from './mailHtml';

export class MailError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function mailFailure(error: unknown, code: string) {
  const invalid = code === 'VALIDATION' || code === 'PARSE';
  return { status: error instanceof MailError ? error.status : invalid ? 400 : 503,
    body: { success: false, error: error instanceof MailError ? error.message : invalid ? 'Invalid email request.' : 'Email is temporarily unavailable. Please try again.' } };
}
export const MAX_ATTACHMENTS = 5 * 1024 * 1024;
export const MAX_MESSAGE = 20 * 1024 * 1024;
export async function readMailJson(request: Request) {
  if (!request.body) return {};
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 10 * 1024 * 1024) { await reader.cancel(); throw new MailError(413, 'Email request exceeds the 10 MB limit.'); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new MailError(400, 'Invalid email request.'); }
  } finally { reader.releaseLock(); }
}
const header = z.string().max(998).refine(value => !/[\r\n\0]/.test(value), 'Invalid mail header');
const attachment = z.object({ name: header.min(1).max(180), type: z.string().max(120).regex(/^[\w.+-]+\/[\w.+-]+$/), data: z.string().max(7_000_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict();
export const draftSchema = z.object({
  id: z.uuid(), accountId: z.string().regex(/^[a-z0-9-]{1,50}$/), to: header, cc: header, bcc: header,
  subject: header, text: z.string().max(200_000), html: z.string().max(400_000), attachments: z.array(attachment).max(10),
  inReplyTo: header, references: z.array(header).max(30), revision: z.number().int().min(0).max(2147483646),
}).strict();
export const preferencesSchema = z.object({ signature: z.string().max(3000), contacts: z.array(z.object({ name: header.max(100), email: z.email().max(254) }).strict()).max(250) }).strict();
export const safeMailHtml = (html: string) => {
  const result = sanitizeComposedHtml(html);
  if (result.imageBytes > MAX_INLINE_IMAGE_BYTES) throw new MailError(413, 'Inline images must total 192 KB or less. Use file attachments for larger images.');
  return result.html;
};
export function validateDraft(input: unknown): Omit<MailDraft, 'updatedAt'> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) throw new MailError(400, 'Invalid draft. Check recipient fields and attachment limits.');
  if (parsed.data.attachments.reduce((sum, file) => sum + Buffer.byteLength(file.data, 'base64'), 0) > MAX_ATTACHMENTS) throw new MailError(413, 'Attachments must total 5 MB or less.');
  return { ...parsed.data, html: safeMailHtml(parsed.data.html) };
}
export function recipients(value: string): string[] {
  if (!value.trim()) return [];
  const addresses = value.split(/[;,]/).map(address => address.trim()).filter(Boolean);
  if (addresses.length > 50 || addresses.some(address => !z.email().safeParse(address).success)) throw new MailError(400, 'Enter valid email addresses separated by commas.');
  return [...new Set(addresses)];
}
export function checkSend(draft: MailDraft) {
  const to = recipients(draft.to), cc = recipients(draft.cc), bcc = recipients(draft.bcc);
  if (!to.length || to.length + cc.length + bcc.length > 50) throw new MailError(400, 'Add a To recipient; a message can have at most 50 recipients.');
  if (!draft.subject.trim()) throw new MailError(400, 'Add a subject before sending.');
  if (!draft.text.trim()) throw new MailError(400, 'Add a message before sending.');
  return { to, cc, bcc };
}
export function safeFilename(name: string) { return name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 180) || 'attachment'; }
export const decodeFiles = (files: MailFile[]) => files.map(file => ({ filename: safeFilename(file.name), contentType: file.type, content: Buffer.from(file.data, 'base64') }));
