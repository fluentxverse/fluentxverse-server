export const PROFILE_PHOTO_MAX_BYTES = 3 * 1024 * 1024;
export const PROFILE_PHOTO_MIN_PIXELS = 480;
export const PROFILE_PHOTO_BACKGROUND = '#C8C8C8';
export const PROFILE_INTERESTS_MAX = 5;

export function validatePhotoFile(type: string, size: number): void {
  if (type !== 'image/jpeg') throw new Error('Use a JPG or JPEG photo.');
  if (size <= 0 || size > PROFILE_PHOTO_MAX_BYTES) throw new Error('Your profile photo must be no larger than 3 MB.');
}
export function validatePhotoDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < PROFILE_PHOTO_MIN_PIXELS || height < PROFILE_PHOTO_MIN_PIXELS) throw new Error('Your profile photo must be at least 480 x 480 pixels.');
}
export function validateProfileInterests(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > PROFILE_INTERESTS_MAX || value.some(item => typeof item !== 'string' || !item.trim() || item.trim().length > 30)) throw new Error('Add up to five interests, each between 1 and 30 characters.');
  const items = value.map(item => item.trim());
  if (new Set(items.map(item => item.toLocaleLowerCase())).size !== items.length) throw new Error('List each interest only once.');
  return items;
}
