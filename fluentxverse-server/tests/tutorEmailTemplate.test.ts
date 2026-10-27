import { expect, test } from 'bun:test';
import { simpleParser } from 'mailparser';
import { parseDocument } from 'htmlparser2';
import { buildTutorConfirmationMessage } from '../src/services/mail/mailProvider';
import { renderTutorConfirmationEmail, tutorConfirmationLogo, TUTOR_LOGO_CID } from '../src/services/mail/tutorConfirmation.template';
import { safeReceivedHtml } from '../src/services/mail/mailHtml';
import { mailConfigs } from '../src/services/mail/mailConfig';

const url = 'https://tutor.fluentxverse.com/confirm-email#token=' + 'a'.repeat(43);
const account = mailConfigs({ TUTOR: 'synthetic-not-a-real-password' })[0]!;

function elements(html: string, tag: string) {
  const nodes = [...parseDocument(html).children], found: any[] = [];
  while (nodes.length) {
    const node = nodes.pop()!;
    if ('children' in node) nodes.push(...node.children);
    if ('name' in node && node.name === tag) found.push(node);
  }
  return found;
}

test('confirmation email has branded HTML, clickable button and backup link, plus a plain-text alternative', () => {
  const result = renderTutorConfirmationEmail(url);
  const links = elements(result.html, 'a').filter(a => a.attribs.href === url);
  expect(links).toHaveLength(2);
  expect(result.html).toContain('Confirm email address');
  expect(result.html).toContain('Fluent<span');
  expect(result.html).toContain('cid:' + TUTOR_LOGO_CID);
  expect(result.html).not.toMatch(/<script|<form|<iframe|src="https?:|javascript:|url\(/);
  expect(result.text).toContain(url);
  expect(result.text).toContain('30 minutes');
  expect(result.text).toContain('can be used once');
});

test('confirmation template rejects foreign origins, query tokens, injection and malformed fragments', () => {
  for (const invalid of [
    url.replace('tutor.fluentxverse.com', 'attacker.example'),
    url.replace('/confirm-email#', '/redirect#'),
    url.replace('#token=', '?token='),
    url + '&next=https://attacker.example',
    url.replace('a'.repeat(43), '<img src=x onerror=alert(1)>'),
    url.replace('https://', 'https://attacker@'),
  ]) expect(() => renderTutorConfirmationEmail(invalid)).toThrow('Invalid tutor confirmation URL');
});

test('real MIME embeds the PNG logo and retains HTML styles and exact clickable fragment links', async () => {
  const message = await buildTutorConfirmationMessage(account, 'applicant@example.test', url);
  const parsed = await simpleParser(message.raw, { keepCidLinks: true });
  expect(message.envelope).toEqual({ from: 'tutor@fluentxverse.com', to: ['applicant@example.test'] });
  expect(parsed.from?.value[0]?.address).toBe('tutor@fluentxverse.com');
  expect(parsed.text).toContain(url);
  expect(parsed.html).toContain('background-color:#0755c9');
  expect(elements(String(parsed.html), 'a').filter(a => a.attribs.href === url)).toHaveLength(2);
  expect(parsed.attachments).toHaveLength(1);
  expect(parsed.attachments[0]!.contentId).toBe('<' + TUTOR_LOGO_CID + '>');
  expect(parsed.attachments[0]!.contentType).toBe('image/png');
  expect(parsed.attachments[0]!.content).toEqual(tutorConfirmationLogo());
  const received = safeReceivedHtml(String(parsed.html), parsed.attachments);
  expect(received).toContain('src="data:image/png;base64,');
  expect(received).not.toContain('data-mail-src');
  expect(elements(received, 'a').filter(a => a.attribs.href === url)).toHaveLength(2);
  expect(received).toContain('padding:14px 24px');
  expect(received).not.toContain('Confirm your email | FluentXVerse');
  if (process.env.EMAIL_TEMPLATE_PREVIEW_FILE)
    await Bun.write(process.env.EMAIL_TEMPLATE_PREVIEW_FILE, JSON.stringify({ html: received, url }));
});

test('server-owned template cannot send as another mailbox or to a recipient list', async () => {
  await expect(buildTutorConfirmationMessage({ ...account, address: 'other@example.test' }, 'applicant@example.test', url)).rejects.toThrow('sender');
  await expect(buildTutorConfirmationMessage(account, 'one@example.test,two@example.test', url)).rejects.toThrow('One confirmation recipient');
  await expect(buildTutorConfirmationMessage(account, 'bad\r\nBcc:other@example.test', url)).rejects.toThrow();
});
