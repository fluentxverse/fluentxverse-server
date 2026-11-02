import { describe, expect, test } from 'bun:test';
import { lessonMaterialRoutes } from '../src/routes/lessonMaterial.route';
import { youngLearnersRoute } from '../src/routes/youngLearners.route';

describe('lesson material access', () => {
  for (const [app, path] of [
    [lessonMaterialRoutes, '/lesson-materials/public/test'],
    [lessonMaterialRoutes, '/lesson-materials/published/business-english'],
    [youngLearnersRoute, '/young-learners/public/test'],
    [youngLearnersRoute, '/young-learners/published'],
  ] as const) {
    test(`${path} rejects anonymous requests`, async () => {
      const response = await app.handle(new Request(`http://localhost${path}`));
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    });
  }
});
