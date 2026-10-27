import { constants } from 'node:fs';
import { mkdir, open, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { mailConfigs } from '../src/services/mail/mailConfig';

export function spacemailEnvironment(address: string, password: string, adminId?: string) {
  if (!password || password.includes('\0')) throw new Error('A non-empty mailbox password is required.');
  const account = {
    id: 'spacemail', label: 'FluentXVerse', address, adminIds: adminId ? [adminId] : [], shared: false,
    imap: { host: 'mail.spacemail.com', port: 993, user: address, passwordEnv: 'MAIL_SPACEMAIL_PASSWORD' },
    smtp: { host: 'mail.spacemail.com', port: 465, secure: true, user: address, passwordEnv: 'MAIL_SPACEMAIL_PASSWORD' },
  };
  const environment = { MAIL_ACCOUNTS_JSON: JSON.stringify([account]), MAIL_SPACEMAIL_PASSWORD: password };
  mailConfigs(environment);
  return environment;
}

export async function readMailboxPassword(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) {
      throw new Error('Password file must be owned by the current user, private (mode 600), and at most 16 KB.');
    }
    return (await file.readFile('utf8')).replace(/\r?\n$/, '');
  } finally { await file.close(); }
}

async function main() {
  const { values } = parseArgs({ options: {
    address: { type: 'string' }, 'admin-id': { type: 'string' }, 'password-file': { type: 'string' }, 'stage-only': { type: 'boolean', default: false },
  } });
  if (!values.address || !values['password-file'] || !values['admin-id']) {
    throw new Error('Usage: bun scripts/configure-spacemail.ts --address MAILBOX --admin-id ADMIN_ID --password-file PRIVATE_FILE [--stage-only]');
  }
  const environment = spacemailEnvironment(values.address, await readMailboxPassword(values['password-file']), values['admin-id']);
  if (!values['stage-only']) {
    const { mailProvider } = await import('../src/services/mail/mailProvider');
    const account = mailConfigs(environment)[0];
    if (!account) throw new Error('Mailbox configuration is missing.');
    await mailProvider.verify(account);
    console.log('IMAP and SMTP authentication verified. No message was sent.');
  }
  const directory = join(homedir(), '.local/state/fluentxverse/spacemail');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = join(directory, `environment-${crypto.randomUUID()}.json`);
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(environment)); } finally { await file.close(); }
  console.log(`Private environment fragment staged at ${path}`);
  console.log('Not activated. Merge into the API runtime environment, preserving other mailboxes and settings, before restarting.');
}

if (import.meta.main) main().catch(() => {
  console.error('Spacemail setup failed. Check the mailbox address, private password file, provider access and TLS connectivity. No live settings were changed.');
  process.exitCode = 1;
});
