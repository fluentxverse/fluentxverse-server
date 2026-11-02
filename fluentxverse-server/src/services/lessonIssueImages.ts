import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordingKey, encryptRecordingChunk, decryptRecordingChunk } from './qaRecordingStorage';
const run = promisify(execFile);
export const ISSUE_IMAGE_LIMIT = 5 * 1024 * 1024;
export async function sanitizeIssueImage(file: File, memoryOnly = false): Promise<Buffer> {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size < 1 || file.size > ISSUE_IMAGE_LIMIT)
    throw Error('Images must be PNG, JPEG or WebP, up to 5 MB each.');
  const bytes = Buffer.from(await file.arrayBuffer());
  const valid = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
    bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ||
    bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
  if (!valid) throw Error('Invalid image file.');
  if (memoryOnly && (await statfs('/dev/shm')).type !== 0x01021994) throw Error('Memory-only image processing is unavailable.');
  const directory = await mkdtemp(join(memoryOnly ? '/dev/shm' : tmpdir(), memoryOnly ? 'fxv-identity-image-' : 'fxv-issue-image-'));
  try {
    const input = join(directory,'input'), output = join(directory,'output.jpg');
    await writeFile(input, bytes, { mode: 0o600 });
    const probe = await run('ffprobe', ['-v','error','-protocol_whitelist','file,pipe','-show_entries','stream=width,height,codec_name','-of','json',input], { timeout: 10000, maxBuffer: 16384 });
    const streams = JSON.parse(probe.stdout).streams;
    if (streams.length !== 1 || !['png','mjpeg','webp'].includes(streams[0].codec_name) || !Number.isSafeInteger(streams[0].width) || !Number.isSafeInteger(streams[0].height) || streams[0].width < 1 || streams[0].height < 1 || streams[0].width * streams[0].height > 16000000)
      throw Error('Invalid image dimensions.');
    await run('ffmpeg', ['-v','error','-threads','1','-max_alloc','67108864','-protocol_whitelist','file,pipe','-i',input,'-frames:v','1',
      '-vf','scale=w=min(2048\\,iw):h=min(2048\\,ih):force_original_aspect_ratio=decrease','-map_metadata','-1','-threads','1',output], { timeout: 15000, maxBuffer: 16384 });
    return await readFile(output);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export class LessonIssueImageStorage {
  constructor(private readonly request: typeof fetch = fetch, private readonly filer = () => process.env.SEAWEED_FILER_URL || 'http://localhost:8888') {}
  private url(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid image reference');
    return this.filer().replace(/\/$/,'') + '/private-lesson-issues/' + id + '.bin';
  }
  async put(id: string, bytes: Buffer) {
    const key = recordingKey('lesson-issue:' + id);
    const encrypted = encryptRecordingChunk(bytes, 'issue-image:' + id, 0, key);
    const r = await this.request(this.url(id), { method: 'PUT', body: encrypted, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!r.ok) throw Error('Private image storage unavailable');
  }
  async get(id: string) {
    const r = await this.request(this.url(id), { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!r.ok || Number(r.headers.get('content-length') || 0) > ISSUE_IMAGE_LIMIT + 28) throw Error('Private image unavailable');
    const reader = r.body!.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try { while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > ISSUE_IMAGE_LIMIT + 28) { await reader.cancel(); throw Error('Private image too large'); } chunks.push(value); } }
    finally { reader.releaseLock(); }
    return decryptRecordingChunk(Buffer.concat(chunks), 'issue-image:' + id, 0, recordingKey('lesson-issue:' + id));
  }
  async remove(id: string) {
    const r = await this.request(this.url(id), { method: 'DELETE', signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!r.ok && r.status !== 404) throw Error('Private image cleanup unavailable');
  }
}
export const lessonIssueImageStorage = new LessonIssueImageStorage();
