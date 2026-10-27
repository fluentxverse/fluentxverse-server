import Elysia, { t } from 'elysia';
import { createAdminGuard } from '../middleware/auth.middleware';
import { alertMonitorRequest, collectAlertTelemetry, monitorAuthorized } from '../services/admin.services/operationalAlerts.service';

export function createOperationalAlertsRoute(ports = { monitor: alertMonitorRequest, collect: collectAlertTelemetry, guard: createAdminGuard, authorized: monitorAuthorized }) {
  return new Elysia({ name: 'operational-alerts' })
    .get('/internal/operational-alerts/telemetry', async ({ request, set }) => {
      set.headers['cache-control'] = 'no-store';
      if (!ports.authorized(request.headers.get('x-fxv-monitor-key'))) { set.status = 401; return { error: 'Unauthorized' }; }
      return ports.collect();
    })
    .get('/admin/alerts', async ({ cookie, set }) => {
      set.headers['cache-control'] = 'private, no-store';
      if (!await ports.guard(cookie, set, 'operations')) return { success: false, error: 'Operations permission required.' };
      try { return { success: true, data: await ports.monitor('/snapshot') }; }
      catch { set.status = 503; return { success: false, error: 'Alert monitor unavailable.' }; }
    })
    .post('/admin/alerts/:id/acknowledge', async ({ cookie, set, params, request }) => {
      set.headers['cache-control'] = 'private, no-store';
      const admin = await ports.guard(cookie, set, 'operations');
      if (!admin) return { success: false, error: 'Operations permission required.' };
      const origin = request.headers.get('origin') || '';
      if (origin !== 'https://dashboard.fluentxverse.com' && !(process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) {
        set.status = 403; return { success: false, error: 'Dashboard origin required.' };
      }
      try { return { success: true, data: await ports.monitor('/acknowledge', { id: params.id, actor: admin.userId }) }; }
      catch { set.status = 503; return { success: false, error: 'Acknowledgement could not be saved. Refresh and try again.' }; }
    }, { params: t.Object({ id: t.String({ pattern: '^[a-f0-9-]{36}$' }) }) });
}
export const operationalAlertsRoute = createOperationalAlertsRoute();
