export interface MailAddress { name: string; address: string }
export interface MailAccount { id: string; label: string; address: string }
export interface MailFolder { path: string; name: string; role: string; total: number; unread: number }
export interface MailAttachment { name: string; type: string; size: number; index: number }
export interface MailSummary {
  uid: number; subject: string; from: MailAddress[]; to: MailAddress[]; date: string;
  seen: boolean; starred: boolean; hasAttachments: boolean; messageId: string;
}
export interface MailMessage extends MailSummary {
  cc: MailAddress[]; text: string; attachments: MailAttachment[]; references: string[];
  replyTo?: MailAddress[];
  html?: string;
}
export interface MailPage { messages: MailSummary[]; total: number; page: number; pages: number; uidValidity: string }
export interface MailFile { name: string; type: string; data: string }
export interface MailDraft {
  id: string; accountId: string; to: string; cc: string; bcc: string; subject: string;
  text: string; html: string; attachments: MailFile[]; inReplyTo: string; references: string[];
  revision: number; updatedAt: string;
}
export interface MailContact { name: string; email: string }
export interface MailPreferences { signature: string; contacts: MailContact[] }
export interface MailStatus { accounts: MailAccount[]; configured: boolean }
export interface MailSendResult { status: 'sending' | 'sent' | 'unknown'; messageId?: string; warning?: string }
export type MailAction = 'read' | 'unread' | 'star' | 'unstar' | 'archive' | 'trash' | 'spam' | 'move';
