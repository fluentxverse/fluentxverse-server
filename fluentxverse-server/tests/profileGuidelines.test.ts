import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePhotoFile, validatePhotoDimensions, validateProfileInterests } from '../../shared/profileGuidelines';
import { validateProfilePhoto } from '../src/utils/profilePhoto';

test('profile policy enforces JPEG, 3 MB, minimum dimensions and five distinct interests', () => {
  expect(() => validatePhotoFile('image/jpeg', 3 * 1024 * 1024)).not.toThrow();
  for (const [type, size] of [['image/png', 100], ['image/jpeg', 0], ['image/jpeg', 3 * 1024 * 1024 + 1]] as const) expect(() => validatePhotoFile(type, size)).toThrow();
  expect(() => validatePhotoDimensions(480, 480)).not.toThrow();
  for (const dimensions of [[479, 600], [600, 479], [NaN, 600]]) expect(() => validatePhotoDimensions(dimensions[0]!, dimensions[1]!)).toThrow();
  expect(validateProfileInterests([' Reading ', 'Cooking'])).toEqual(['Reading', 'Cooking']);
  expect(validateProfileInterests([])).toEqual([]);
  for (const interests of [['a','b','c','d','e','f'], ['Reading','reading'], [''], [5], 'Reading', ['x'.repeat(31)]]) expect(() => validateProfileInterests(interests)).toThrow();
});

test('actual photo bytes are verified independently of extension or MIME claims', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fxv-photo-test-'));
  try {
    for (const [name, size, codec] of [['valid.jpg', '480x480', 'mjpeg'], ['small.jpg', '478x480', 'mjpeg'], ['fake.jpg', '600x600', 'png']] as const) {
      const path = join(directory, name);
      execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',`color=c=gray:s=${size}`,'-frames:v','1','-c:v',codec,'-f','image2','-update','1',path]);
      const file = new File([await readFile(path)], name, { type: 'image/jpeg' });
      if (name === 'valid.jpg') await expect(validateProfilePhoto(file)).resolves.toBeUndefined();
      else await expect(validateProfilePhoto(file)).rejects.toThrow();
    }
    await expect(validateProfilePhoto(new File(['not jpeg'], 'photo.jpg', { type: 'image/jpeg' }))).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 20000);
