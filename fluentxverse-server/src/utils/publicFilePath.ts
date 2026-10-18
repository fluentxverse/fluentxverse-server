export function publicFilePath(wildcard: string): string | null {
  const path = '/' + wildcard;
  const decoded = decodeURIComponent(path);
  if (decoded.includes('..') || /[\\\u0000-\u001f\u007f]/.test(decoded)) return null;

  // Only profile photos and introduction videos are public user uploads.
  const publicUserMedia = /^\/user\/[A-Za-z0-9_-]+\/(profile|video)\/[A-Za-z0-9._-]+$/.test(decoded);
  if (!decoded.startsWith('/lessons/') && !publicUserMedia) return null;
  return new URL(path, 'http://seaweed.internal').pathname;
}
