import { expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMailboxPassword, spacemailEnvironment } from '../scripts/configure-spacemail';
import { mailConfigs } from '../src/services/mail/mailConfig';

test('Spacemail uses authenticated implicit TLS and the full mailbox username', () => {
  const environment = spacemailEnvironment('office@example.com', 'private-mailbox-password');
  const account = mailConfigs(environment)[0];
  if (!account) throw new Error('Expected a Spacemail account.');
  expect(account.imap).toEqual({ host: 'mail.spacemail.com', port: 993, user: 'office@example.com', passwordEnv: 'MAIL_SPACEMAIL_PASSWORD' });
  expect(account.smtp).toEqual({ ...account.imap, port: 465, secure: true });
  expect(account.imapPassword).toBe('private-mailbox-password');
  expect(account.smtpPassword).toBe(account.imapPassword);
  expect(environment.MAIL_ACCOUNTS_JSON).not.toContain('private-mailbox-password');
  expect(account.adminIds).toEqual([]);
});

test('Spacemail setup rejects missing secrets and invalid mailbox addresses', () => {
  expect(() => spacemailEnvironment('not-an-address', 'password')).toThrow();
  expect(() => spacemailEnvironment('office@example.com', '')).toThrow();
  expect(() => spacemailEnvironment('office@example.com', 'password\0')).toThrow();
});

test('password files must be private regular files and never symlinks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fxv-spacemail-'));
  const path = join(directory, 'password');
  try {
    await writeFile(path, ' password with spaces \n', { mode: 0o600 });
    expect(await readMailboxPassword(path)).toBe(' password with spaces ');
    await chmod(path, 0o644);
    await expect(readMailboxPassword(path)).rejects.toThrow('private');
    await chmod(path, 0o600);
    await symlink(path, join(directory, 'link'));
    await expect(readMailboxPassword(join(directory, 'link'))).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
