import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const QA_CHUNK_BYTES = 1024 * 1024;
const OVERHEAD = 28;
const MAX_BYTES = 512 * 1024 * 1024;

function rootKey() {
  const hex = process.env.QA_RECORDING_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error('QA recording encryption key is missing');
  return Buffer.from(hex, 'hex');
}

export function recordingKey(id: string, root = rootKey()) {
  return Buffer.from(hkdfSync('sha256', root, id, 'fxv-qa-recording-v1', 32));
}

export function encryptRecordingChunk(bytes: Uint8Array, id: string, index: number, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${id}:${index}`));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

export function decryptRecordingChunk(bytes: Uint8Array, id: string, index: number, key: Buffer) {
  const input = Buffer.from(bytes);
  const decipher = createDecipheriv('aes-256-gcm', key, input.subarray(0, 12));
  decipher.setAAD(Buffer.from(`${id}:${index}`));
  decipher.setAuthTag(input.subarray(12, 28));
  return Buffer.concat([decipher.update(input.subarray(28)), decipher.final()]);
}

export function recordingDownloadUrl(raw: string) {
  const url = new URL(raw);
  const allowed = ['.r2.cloudflarestorage.com', '.amazonaws.com', '.dyte.io'];
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || !allowed.some(suffix => url.hostname.endsWith(suffix))) throw new Error('Untrusted recording download host');
  return url.toString();
}

export function recordingRange(range: string | null, size: number) {
  if (!range) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) throw new Error('Invalid range');
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size)
    throw new Error('Invalid range');
  return { start, end, partial: true };
}

function readable(generator: AsyncGenerator<Uint8Array>) {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try { const next = await generator.next(); if (next.done) controller.close(); else controller.enqueue(next.value); }
      catch (error) { controller.error(error); }
    },
    async cancel() { await generator.return(undefined); },
  });
}

export class QaRecordingStorage {
  constructor(private filer = () => process.env.SEAWEED_FILER_URL || 'http://localhost:8888',
    private request: (input: string, init?: RequestInit) => Promise<Response> = fetch) {}
  configured() { rootKey(); }
  private url(id: string) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid recording storage ID');
    return `${this.filer()}/private-qa/${id}.bin`;
  }
  async remove(id: string) {
    const result = await this.request(this.url(id), { method: 'DELETE', signal: AbortSignal.timeout(15000) });
    if (!result.ok && result.status !== 404) throw new Error('Recording deletion failed');
  }
  async archive(id: string, downloadUrl: string, expectedBytes?: number) {
    const key = recordingKey(id);
    const signal = AbortSignal.timeout(15 * 60_000);
    const source = await this.request(recordingDownloadUrl(downloadUrl), { redirect: 'error', signal });
    if (!source.ok || !source.body) throw new Error('Recording download failed');
    const reader = source.body.getReader();
    const hash = createHash('sha256');
    let size = 0, chunks = 0;
    async function* encrypted() {
      let buffer = Buffer.alloc(QA_CHUNK_BYTES), used = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_BYTES) throw new Error('Recording exceeds archive limit');
          hash.update(value);
          for (let offset = 0; offset < value.length;) {
            const count = Math.min(QA_CHUNK_BYTES - used, value.length - offset);
            buffer.set(value.subarray(offset, offset + count), used); used += count; offset += count;
            if (used === QA_CHUNK_BYTES) { yield encryptRecordingChunk(buffer, id, chunks++, key); buffer = Buffer.alloc(QA_CHUNK_BYTES); used = 0; }
          }
        }
        if (used) yield encryptRecordingChunk(buffer.subarray(0, used), id, chunks++, key);
        if (!size || (expectedBytes && expectedBytes !== size)) throw new Error('Incomplete recording download');
      } finally { await reader.cancel().catch(() => {}); }
    }
    const directory = await mkdtemp(join(tmpdir(), 'fxv-qa-'));
    try {
      // Seaweed's filer requires multipart uploads. Spool ciphertext only, then use its structured upload API.
      const path = join(directory, 'recording.bin');
      await Bun.write(path, new Response(readable(encrypted())));
      await chmod(path, 0o600);
      const form = new FormData();
      form.append('file', Bun.file(path), `${id}.bin`);
      const result = await this.request(this.url(id), { method: 'POST', body: form, signal });
      if (!result.ok) throw new Error('Recording archive upload failed');
      const head = await this.request(this.url(id), { method: 'HEAD', signal });
      if (!head.ok || Number(head.headers.get('content-length')) !== size + chunks * OVERHEAD)
        throw new Error('Recording archive verification failed');
      // Authenticate the stored bytes, not just the upload response, before making playback available.
      const verified = createHash('sha256');
      const stream = this.playback(id, size, 0, size - 1).getReader();
      while (true) { const result = await stream.read(); if (result.done) break; verified.update(result.value); }
      const digest = hash.digest('hex');
      if (verified.digest('hex') !== digest) throw new Error('Recording archive checksum mismatch');
      return { size, sha256: digest };
    } catch { await this.remove(id).catch(() => {}); throw new Error('Recording archive failed; retry required'); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
  playback(id: string, size: number, start: number, end: number) {
    const key = recordingKey(id), url = this.url(id), request = this.request;
    async function* decrypted() {
      for (let index = Math.floor(start / QA_CHUNK_BYTES); index <= Math.floor(end / QA_CHUNK_BYTES); index++) {
        const offset = index * (QA_CHUNK_BYTES + OVERHEAD);
        const plainLength = Math.min(QA_CHUNK_BYTES, size - index * QA_CHUNK_BYTES);
        const result = await request(url, { headers: { Range: `bytes=${offset}-${offset + plainLength + OVERHEAD - 1}` }, signal: AbortSignal.timeout(15000) });
        const entireObject = index === 0 && size <= QA_CHUNK_BYTES;
        if (result.status !== 206 && !(entireObject && result.status === 200)) throw new Error('Recording chunk unavailable');
        const encrypted = new Uint8Array(await result.arrayBuffer());
        if (encrypted.length !== plainLength + OVERHEAD) throw new Error('Incomplete recording chunk');
        const chunk = decryptRecordingChunk(encrypted, id, index, key);
        yield chunk.subarray(Math.max(0, start - index * QA_CHUNK_BYTES), Math.min(chunk.length, end - index * QA_CHUNK_BYTES + 1));
      }
    }
    return readable(decrypted());
  }
}
