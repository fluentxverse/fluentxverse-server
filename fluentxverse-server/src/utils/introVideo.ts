import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execute = promisify(execFile);
export class IntroVideoInvalid extends Error {}
export function validateIntroProbe(data: { format?: { duration?: string }; streams?: { codec_type?: string; duration?: string }[] }): void {
  if (!data.streams?.some(stream => stream.codec_type === 'video')) throw new IntroVideoInvalid('Please upload a valid video file.');
  const durations = [data.format?.duration, ...data.streams.map(stream => stream.duration)].filter(value => value !== undefined && value !== 'N/A').map(Number);
  if (!durations.length || durations.some(value => !Number.isFinite(value) || value <= 0)) throw new IntroVideoInvalid('Could not verify video duration. Please upload a valid video file.');
  if (Math.max(...durations) > 30) throw new IntroVideoInvalid('Introduction videos must be 30 seconds or shorter. Please trim your video before uploading.');
}
export async function validateIntroVideo(file: File): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'fxv-intro-'));
  try {
    const path = join(directory, 'upload');
    await writeFile(path, new Uint8Array(await file.arrayBuffer()));
    const { stdout } = await execute('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration:stream=codec_type,duration', '-of', 'json', path], { timeout: 10000, maxBuffer: 262144 });
    validateIntroProbe(JSON.parse(stdout));
  } catch (error) {
    if (error instanceof IntroVideoInvalid) throw error;
    throw new IntroVideoInvalid('Could not verify video duration. Please upload a valid video file.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
