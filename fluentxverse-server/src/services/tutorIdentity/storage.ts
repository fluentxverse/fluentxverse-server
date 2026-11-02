import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, writeFile, readFile, rm, readdir, stat, statfs } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

// Ciphertext lives in private SeaweedFS; this persistent private directory contains keys only.
export class IdentityStorage {
  constructor(private root = () => process.env.TUTOR_IDENTITY_KEY_DIR || process.env.TUTOR_IDENTITY_PRIVATE_DIR || '',
    private request: typeof fetch = fetch, private filer = () => process.env.SEAWEED_FILER_URL || 'http://localhost:8888') {}
  private paths(id: string) {
    const root = this.root();
    if (!isAbsolute(root) || !/^[a-f0-9-]{36}$/.test(id)) throw Error('Private identity storage is not configured');
    return { directory: join(root, id), key: join(root, id, 'key') };
  }
  private url(id: string) {
    this.paths(id);
    return this.filer().replace(/\/$/, '') + '/private-tutor-identity/' + id + '.bin';
  }
  private async encryptedImage(id: string) {
    const r = await this.request(this.url(id), { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!r.ok || !r.body) throw Error('Private ID image unavailable');
    const reader = r.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 6 * 1024 * 1024) { await reader.cancel(); throw Error('Private ID image too large'); }
      chunks.push(part.value);
    } } finally { reader.releaseLock(); }
    return Buffer.concat(chunks);
  }
  async put(id: string, bytes: Buffer) {
    const p = this.paths(id), key = randomBytes(32), iv = randomBytes(12);
    await mkdir(this.root(), { recursive: true, mode: 0o700 });
    await mkdir(p.directory, { mode: 0o700 });
    try {
      await writeFile(p.key, key, { flag: 'wx', mode: 0o600 });
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(`tutor-identity:v1:${id}`));
      const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
      const r = await this.request(this.url(id), { method: 'PUT', body: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]),
        headers: { 'Content-Type': 'application/octet-stream' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw Error('Private ID storage unavailable');
    } catch (error) { await this.remove(id).catch(() => {}); throw error; }
    finally { key.fill(0); }
  }
  async get(id: string) {
    const p = this.paths(id), key = await readFile(p.key);
    try {
      const bytes = await this.encryptedImage(id);
      if (bytes.length > 6 * 1024 * 1024 || bytes.length < 29) throw Error('Invalid private image');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(`tutor-identity:v1:${id}`));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
    } finally { key.fill(0); }
  }
  async has(id: string) {
    const p = this.paths(id);
    try { await stat(p.key); }
    catch (error: any) { if (error.code === 'ENOENT') return false; throw error; }
    const r = await this.request(this.url(id), { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (r.status === 404) return false;
    if (!r.ok) throw Error('Private ID storage unavailable');
    return true;
  }
  async remove(id: string) {
    const p = this.paths(id);
    await rm(p.key, { force: true });
    const r = await this.request(this.url(id), { method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!r.ok && r.status !== 404) throw Error('Private ID deletion pending');
    await rm(p.directory, { recursive: true, force: true });
  }
  async orphanCandidates(now = Date.now()) {
    const root = this.root();
    if (!isAbsolute(root)) throw Error('Private identity storage is not configured');
    await mkdir(root, { recursive: true, mode: 0o700 });
    const result: string[] = [];
    for (const item of await readdir(root, { withFileTypes: true })) {
      if (item.isDirectory() && /^[a-f0-9-]{36}$/.test(item.name) &&
        (await stat(join(root, item.name))).mtimeMs < now - 3600_000) result.push(item.name);
    }
    return result;
  }
}
export const identityStorage = new IdentityStorage();
export async function cleanupIdentityImageTemps(now = Date.now()) {
  if ((await statfs('/dev/shm')).type !== 0x01021994) throw Error('Memory-only image processing is unavailable');
  for (const item of await readdir('/dev/shm', { withFileTypes: true })) {
    if (!item.isDirectory() || !/^fxv-identity-image-[a-zA-Z0-9]+$/.test(item.name)) continue;
    const path = join('/dev/shm', item.name);
    // Decoder processes have a 25-second total timeout. Leave ample room for in-flight work.
    if ((await stat(path)).mtimeMs < now - 300000) await rm(path, { recursive: true, force: true });
  }
}
