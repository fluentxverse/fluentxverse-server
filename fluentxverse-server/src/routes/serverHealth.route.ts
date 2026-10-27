import Elysia from 'elysia';
import { createAdminGuard } from '../middleware/auth.middleware';
import { readServerHealth } from '../services/admin.services/serverHealth.service';

export function createServerHealthRoute(read = readServerHealth, guard = createAdminGuard) {
  return new Elysia({ prefix: '/admin/server-health', name: 'admin-server-health' })
    .onBeforeHandle(async ({ cookie, set }) => {
      set.headers['cache-control'] = 'private, no-store';
      if (!await guard(cookie, set, 'operations')) return { success: false, error: 'Operations permission required.' };
    })
    .get('/', async ({ set }) => {
      try { return { success: true, data: await read() }; }
      catch { set.status = 503; return { success: false, error: 'Host monitoring is unavailable.' }; }
    });
}

export const serverHealthRoute = createServerHealthRoute();
