import type { MailAction, MailDraft, MailSendResult } from '../../../../shared/mail';
import { mailConfigs, mayUseMailbox, type MailActor, type MailboxConfig } from './mailConfig';
import { MailError, checkSend, preferencesSchema, validateDraft } from './mailPolicy';
import { mailProvider, type MailProvider } from './mailProvider';
import { mailRepository, type MailRepository } from './mailRepository';

export class MailService {
  constructor(readonly repository: MailRepository = mailRepository, readonly provider: MailProvider = mailProvider, readonly config: () => MailboxConfig[] = mailConfigs) {}
  access(actor: MailActor) {
    const accounts = this.config();
    if (accounts.length && !accounts.some(account => mayUseMailbox(actor, account))) throw new MailError(403, 'Email access has not been granted to your account.');
    return accounts.filter(account => mayUseMailbox(actor, account));
  }
  account(actor: MailActor, id: string) {
    const account = this.access(actor).find(account => account.id === id);
    if (!account) throw new MailError(404, 'Mailbox is unavailable.');
    return account;
  }
  status(actor: MailActor) { const accounts = this.access(actor); return { configured: Boolean(accounts.length), accounts: accounts.map(({ id, label, address }) => ({ id, label, address })) }; }
  folders(actor: MailActor, accountId: string) { return this.provider.folders(this.account(actor, accountId)); }
  list(actor: MailActor, accountId: string, folder: string, page: number, search: string, filter: string) { return this.provider.list(this.account(actor, accountId), folder, page, search, filter); }
  message(actor: MailActor, accountId: string, folder: string, uid: number, validity: string) { return this.provider.message(this.account(actor, accountId), folder, uid, validity); }
  attachment(actor: MailActor, accountId: string, folder: string, uid: number, validity: string, index: number) { return this.provider.attachment(this.account(actor, accountId), folder, uid, validity, index); }
  action(actor: MailActor, accountId: string, folder: string, validity: string, uids: number[], action: MailAction, destination?: string) { return this.provider.action(this.account(actor, accountId), folder, validity, uids, action, destination); }
  createFolder(actor: MailActor, accountId: string, name: string) { return this.provider.createFolder(this.account(actor, accountId), name); }
  verify(actor: MailActor, accountId: string) { return this.provider.verify(this.account(actor, accountId)); }
  listDrafts(actor: MailActor, accountId: string) { this.account(actor, accountId); return this.repository.listDrafts(actor.userId, accountId); }
  saveDraft(actor: MailActor, accountId: string, input: unknown) {
    this.account(actor, accountId); const draft = validateDraft(input);
    if (draft.accountId !== accountId) throw new MailError(400, 'Draft mailbox does not match.');
    return this.repository.saveDraft(actor.userId, draft);
  }
  deleteDraft(actor: MailActor, accountId: string, id: string) { this.account(actor, accountId); return this.repository.deleteDraft(actor.userId, accountId, id); }
  preferences(actor: MailActor) { this.access(actor); return this.repository.preferences(actor.userId); }
  savePreferences(actor: MailActor, input: unknown) {
    this.access(actor); const parsed = preferencesSchema.safeParse(input);
    if (!parsed.success) throw new MailError(400, 'Check contact addresses and signature length.');
    const contacts = [...new Map(parsed.data.contacts.map(contact => [contact.email.toLowerCase(), contact])).values()];
    return this.repository.savePreferences(actor.userId, { ...parsed.data, contacts });
  }
  async send(actor: MailActor, accountId: string, draftId: string, revision: number, requestId: string): Promise<MailSendResult> {
    const account = this.account(actor, accountId);
    const previous = await this.repository.sendResult(actor.userId, accountId, draftId, requestId);
    if (previous) return previous;
    const draft: MailDraft = await this.repository.getDraft(actor.userId, accountId, draftId);
    if (revision !== draft.revision) throw new MailError(409, 'Save the latest draft before sending.');
    checkSend(draft);
    const reserved = await this.repository.reserveSend(actor.userId, accountId, draftId, revision, requestId);
    if (reserved) return reserved;
    let result: MailSendResult;
    try { result = { status: 'sent', ...await this.provider.send(account, draft, requestId) }; }
    catch { result = { status: 'unknown', warning: 'The send outcome could not be confirmed. Check the provider Sent folder before sending a new copy. This request will not be sent again automatically.' }; }
    try { await this.repository.finishSend(actor.userId, requestId, result); }
    catch { return { ...result, warning: `${result.warning || ''} Delivery tracking could not be saved. Do not resend this message.`.trim() }; }
    return result;
  }
}
export const mailService = new MailService();
