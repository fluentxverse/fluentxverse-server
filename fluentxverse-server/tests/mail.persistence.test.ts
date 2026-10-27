import { afterAll, describe, expect, test } from 'bun:test';
import { mailRepository as repository } from '../src/services/mail/mailRepository';
import { db } from '../src/db/postgres';
import type { MailDraft } from '../../shared/mail';
const uri = process.env.MAIL_TEST_DATABASE_URL;
const isolated = uri && uri === process.env.DATABASE_URL && new URL(uri).hostname === '127.0.0.1' && new URL(uri).port === '15439' && new URL(uri).pathname === '/fxv_mail_test';
const suite = isolated ? describe : describe.skip;
const owner = `mail-test-${crypto.randomUUID()}`;
const draft = (): MailDraft => ({ id: crypto.randomUUID(), accountId: 'support', to: 'test@example.test', cc: '', bcc: '', subject: 'Test', html: '<p>Test</p>', text: 'Test', attachments: [], inReplyTo: '', references: [], revision: 0, updatedAt: '' });
suite('mail persistence (disposable PostgreSQL only)', () => {
  afterAll(async () => {
    await db`DELETE FROM admin_mail_sends WHERE owner_id=${owner}`;
    await db`DELETE FROM admin_mail_drafts WHERE owner_id=${owner}`;
    await db`DELETE FROM admin_mail_preferences WHERE owner_id=${owner}`;
    await db.close();
  });
  test('real JSON persistence, ownership, contacts and optimistic draft versions', async () => {
    const input = draft(), value = await repository.saveDraft(owner, input);
    expect(value.revision).toBe(1); expect(value.subject).toBe('Test');
    expect((await repository.getDraft(owner, 'support', input.id)).id).toBe(input.id);
    expect(await repository.listDrafts('different-owner', 'support')).toEqual([]);
    await expect(repository.getDraft(owner, 'other-box', input.id)).rejects.toThrow('Draft not found');
    await expect(repository.saveDraft(owner, input)).rejects.toThrow('changed');
    expect((await repository.saveDraft(owner, { ...value, subject: 'Saved again' })).revision).toBe(2);
    const preferences = { signature: 'FluentXVerse', contacts: [{ name: 'Example', email: 'example@example.test' }] };
    await repository.savePreferences(owner, preferences); expect(await repository.preferences(owner)).toEqual(preferences);
    await repository.deleteDraft(owner, 'support', input.id);
    await expect(repository.saveDraft(owner, value)).rejects.toThrow('changed');
  });
  test('concurrent sends and different request IDs reserve the draft exactly once', async () => {
    const value = await repository.saveDraft(owner, draft()), request = crypto.randomUUID();
    const attempts = await Promise.all(Array.from({ length: 6 }, () => repository.reserveSend(owner, 'support', value.id, value.revision, request)));
    expect(attempts.filter(item => item === null)).toHaveLength(1);
    expect((await repository.reserveSend(owner, 'support', value.id, value.revision, crypto.randomUUID()))?.status).toBe('sending');
    await repository.finishSend(owner, request, { status: 'unknown', warning: 'Check provider' });
    expect((await repository.sendResult(owner, 'support', value.id, crypto.randomUUID()))?.status).toBe('unknown');
    expect((await repository.getDraft(owner, 'support', value.id)).id).toBe(value.id);
  });
  test('accepted sends do not delete edits made by another tab after reservation', async () => {
    const value = await repository.saveDraft(owner, draft()), request = crypto.randomUUID();
    await repository.reserveSend(owner, 'support', value.id, value.revision, request);
    const edited = await repository.saveDraft(owner, { ...value, text: 'Newer edit' });
    await repository.finishSend(owner, request, { status: 'sent', messageId: '<test@example.test>' });
    expect((await repository.getDraft(owner, 'support', value.id)).revision).toBe(edited.revision);
    expect((await repository.sendResult(owner, 'support', value.id, request))?.status).toBe('sent');
  });
  test('accepted unchanged drafts are removed and duplicate results survive restart', async () => {
    const value = await repository.saveDraft(owner, draft()), request = crypto.randomUUID();
    await repository.reserveSend(owner, 'support', value.id, value.revision, request);
    await repository.finishSend(owner, request, { status: 'sent', messageId: '<test@example.test>' });
    await expect(repository.getDraft(owner, 'support', value.id)).rejects.toThrow('not found');
    expect((await repository.sendResult(owner, 'support', value.id, request))?.messageId).toBe('<test@example.test>');
  });
});
