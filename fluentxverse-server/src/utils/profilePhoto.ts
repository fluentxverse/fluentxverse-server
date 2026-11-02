import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePhotoFile, validatePhotoDimensions } from '../../../shared/profileGuidelines';
const execute = promisify(execFile);
export class ProfilePhotoInvalid extends Error {}
export async function validateProfilePhoto(file: File): Promise<void> {
  let directory: string | undefined;
  try {
    validatePhotoFile(file.type, file.size);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error('Use a valid JPG or JPEG photo.');
    directory = await mkdtemp(join(tmpdir(), 'fxv-photo-'));
    const path = join(directory, 'photo.jpg');
    await writeFile(path, bytes);
    const { stdout } = await execute('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', path], { timeout: 10000, maxBuffer: 262144 });
    const data = JSON.parse(stdout);
    const image = data.streams?.[0];
    if (!image || image.codec_name !== 'mjpeg' || data.streams.length !== 1) throw new Error('Use a valid JPG or JPEG photo.');
    validatePhotoDimensions(image.width, image.height);
  } catch (error) {
    throw new ProfilePhotoInvalid(error instanceof Error && /^(Use |Your profile photo)/.test(error.message) ? error.message : 'This photo could not be read. Choose a valid JPG or JPEG file.');
  } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}
