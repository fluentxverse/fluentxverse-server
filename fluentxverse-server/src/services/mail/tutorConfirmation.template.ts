import { readFileSync } from 'node:fs';

export const TUTOR_CONFIRMATION_SUBJECT = 'Confirm your FluentXVerse tutor application email';
export const TUTOR_LOGO_CID = 'fluentxverse-logo@inline';
let logo: Buffer | undefined;
export const tutorConfirmationLogo = () => logo ??= readFileSync(new URL('./assets/fluentxverse-icon.png', import.meta.url));
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export function renderTutorConfirmationEmail(confirmationURL: string) {
  const url = new URL(confirmationURL);
  const local = process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((!local && url.origin !== 'https://tutor.fluentxverse.com') || url.username || url.password ||
    url.pathname !== '/confirm-email' || url.search || !/^#token=[a-zA-Z0-9_-]{43}$/.test(url.hash))
    throw Error('Invalid tutor confirmation URL');
  const link = escapeHtml(url.href);
  const text = `Welcome to FluentXVerse.\n\nConfirm your email address to continue your tutor application and start the written exam:\n${url.href}\n\nThis link expires in 30 minutes and can be used once. Open the link and choose Confirm email.\n\nIf you did not create this application, you can ignore this email.\n\nFluentXVerse Tutor Applications\ntutor@fluentxverse.com`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background-color:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#202636;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Confirm your email to continue your FluentXVerse tutor application. Your link is valid for 30 minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f4f6fa;border-collapse:collapse;">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;">
<tr><td style="padding:0 12px 24px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="44" valign="middle" style="width:44px;"><img src="cid:${TUTOR_LOGO_CID}" width="36" height="41" alt="FluentXVerse icon" style="display:block;width:36px;height:41px;border:0;"></td>
<td valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:32px;font-weight:700;color:#15315b;">Fluent<span style="color:#0876e8;">X</span>Verse</td>
</tr></table></td></tr>
<tr><td style="padding:32px 24px;background-color:#ffffff;border:1px solid #dfe5ed;border-radius:8px;">
<p style="margin:0 0 12px;font-size:11px;line-height:18px;font-weight:700;color:#2460ab;">TUTOR APPLICATION</p>
<h1 style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:36px;font-weight:700;color:#202636;">Confirm your email</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:25px;color:#536175;">Welcome to FluentXVerse. Confirm your email address to continue your tutor application and start the written exam.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#0755c9" style="background-color:#0755c9;border-radius:6px;text-align:center;">
<a href="${link}" style="display:inline-block;padding:14px 24px;border:1px solid #0755c9;border-radius:6px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;font-weight:700;text-decoration:none;color:#ffffff;">Confirm email address</a>
</td></tr></table>
<p style="margin:18px 0 28px;font-size:12px;line-height:20px;color:#647184;">Valid for 30 minutes. This link can be used once.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-top:1px solid #e4e9f0;"><tr><td style="padding-top:24px;">
<p style="margin:0 0 8px;font-size:12px;line-height:20px;color:#647184;">Button not working? Open this link in your browser, then choose Confirm email:</p>
<p style="margin:0;font-size:12px;line-height:21px;word-break:break-all;overflow-wrap:anywhere;"><a href="${link}" style="color:#0755c9;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${link}</a></p>
</td></tr></table>
</td></tr>
<tr><td style="padding:24px 12px 0;">
<p style="margin:0 0 10px;font-size:12px;line-height:20px;color:#647184;">If you did not create this application, you can ignore this email.</p>
<p style="margin:0;font-size:12px;line-height:20px;color:#647184;"><strong style="color:#37465b;">FluentXVerse Tutor Applications</strong><br><a href="mailto:tutor@fluentxverse.com" style="color:#536175;text-decoration:none;">tutor@fluentxverse.com</a></p>
</td></tr></table>
</td></tr></table>
</body></html>`;
  return { html, text };
}
