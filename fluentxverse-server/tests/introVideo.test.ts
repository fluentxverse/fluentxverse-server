import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateIntroProbe, validateIntroVideo } from '../src/utils/introVideo';

test('intro duration rejects unknown, absent and over-30-second media', () => {
  for (const duration of ['0', '-1', 'NaN', 'Infinity', '30.001', '31']) expect(() => validateIntroProbe({ format: { duration }, streams: [{ codec_type: 'video' }] })).toThrow();
  for (const duration of ['1', '29.9', '30']) expect(() => validateIntroProbe({ format: { duration }, streams: [{ codec_type: 'video' }] })).not.toThrow();
  expect(() => validateIntroProbe({ format: { duration: '10' }, streams: [{ codec_type: 'audio' }] })).toThrow();
  expect(() => validateIntroProbe({ streams: [{ codec_type: 'video' }] })).toThrow();
  expect(() => validateIntroProbe({ format: { duration: '20' }, streams: [{ codec_type: 'video', duration: '31' }] })).toThrow();
});

test('ffprobe checks actual uploads independently of filename and client duration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fxv-video-test-'));
  try {
    for (const seconds of [1, 30, 31]) {
      const path = join(directory, `${seconds}.mp4`);
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=128x72:r=1', '-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path]);
      const file = new File([await readFile(path)], 'claimed-short.mp4', { type: 'video/mp4' });
      if (seconds <= 30) await expect(validateIntroVideo(file)).resolves.toBeUndefined();
      else await expect(validateIntroVideo(file)).rejects.toThrow('30 seconds');
    }
    await expect(validateIntroVideo(new File(['invalid'], 'valid.mp4', { type: 'video/mp4' }))).rejects.toThrow('Could not verify');
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30000);
