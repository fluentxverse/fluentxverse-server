import { describe, expect, test } from 'bun:test';
import { publicFilePath } from '../src/utils/publicFilePath';

describe('public file proxy paths', () => {
  test('serves profile photos, intro videos and existing lesson assets', () => {
    for (const path of [
      'user/fL4ff9Z28Uhz/profile/1791548766691_profile.jpg',
      'user/student-id_1/profile/photo.png',
      'user/tutor-id/video/intro.mp4',
      'lessons/lesson-id/tutor-data.json',
      'lessons/lesson-id/images/photo%20one.png',
    ]) expect(publicFilePath(path)).toBe('/' + path);
  });

  test('does not expose private uploads, folder listings or other storage roots', () => {
    for (const path of [
      'user/tutor-id/interview/recording.webm',
      'user/tutor-id/certificates/proof.pdf',
      'recordings/lesson-id/video.webm',
      'user/tutor-id/profile/',
      'user/tutor-id/video',
      'user/tutor-id/profile/nested/file.jpg',
      'user/tutor-id/profile/photo.jpg?metadata=true',
      '',
    ]) expect(publicFilePath(path)).toBeNull();
  });

  test('rejects traversal before URL normalization and encoded control characters', () => {
    for (const path of [
      'user/tutor-id/profile/../../../private/file',
      'lessons/id/%2e%2e/private',
      'user/tutor-id/profile/%252e%252e.jpg',
      'user/tutor-id/profile/photo%2f..%2fprivate.jpg',
      'lessons/id/photo%5cprivate',
      'lessons/id/photo%00.jpg',
    ]) expect(publicFilePath(path)).toBeNull();
    expect(() => publicFilePath('user/tutor-id/profile/%ZZ.jpg')).toThrow(URIError);
  });
});
