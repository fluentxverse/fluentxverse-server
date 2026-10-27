import Elysia from 'elysia';
import { createAdminGuard } from '../middleware/auth.middleware';
import { readContainerStats } from '../services/admin.services/containerStats.service';

export function createContainerStatsRoute(read = readContainerStats, guard = createAdminGuard) {
  return new Elysia({ prefix: '/admin/container-stats', name: 'admin-container-stats' })
    .onBeforeHandle(async ({ cookie, set }) => {
      set.headers['cache-control'] = 'private, no-store';
      if (!await guard(cookie, set, 'operations')) return { success: false, error: 'Operations permission required.' };
    })
    .get('/', async ({ set }) => {
      try { return { success: true, data: await read() }; }
      catch { set.status = 503; return { success: false, error: 'Container monitoring is unavailable.' }; }
    });
}
export const containerStatsRoute = createContainerStatsRoute();
