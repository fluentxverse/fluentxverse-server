import Elysia, { t } from 'elysia';
import { createAdminGuard } from '../middleware/auth.middleware';
import { isAllowedAdminMutationOrigin } from '../config/cors';
import { bookingSettingsService } from '../services/bookingSettings.service';
import { BookingSettingsError } from '../services/bookingSettings.policy';

export function createBookingSettingsRoutes(
  service: typeof bookingSettingsService = bookingSettingsService,
  guard: (cookie: any, set: any) => Promise<{ userId: string; role?: string } | null> = createAdminGuard,
) {
  const authorize = async (c: any, mutation = false) => {
    c.set.headers['Cache-Control'] = 'no-store';
    const admin = await guard(c.cookie, c.set);
    if (!admin) { c.set.status = Number(c.set.status) === 403 ? 403 : 401; return null; }
    if (admin.role !== 'superadmin' || (mutation && !isAllowedAdminMutationOrigin(c.request.headers.get('origin')))) {
      c.set.status = 403; return null;
    }
    return admin;
  };
  const failure = (c: any, error: unknown) => {
    c.set.status = error instanceof BookingSettingsError ? error.status : 503;
    return { success: false, error: error instanceof BookingSettingsError ? error.message : 'Booking settings are unavailable. Please try again.' };
  };
  return new Elysia()
    .get('/booking-settings', async c => {
      if (!await authorize(c)) return { success: false, error: 'Superadmin access required.' };
      try { return { success: true, data: await service.get() }; } catch (error) { return failure(c, error); }
    })
    .put('/booking-settings', async c => {
      const admin = await authorize(c, true);
      if (!admin) return { success: false, error: 'Superadmin access from the administration app is required.' };
      try { return { success: true, data: await service.update(c.body, c.body.revision, admin.userId) }; }
      catch (error) { return failure(c, error); }
    }, { body: t.Object({
      mode: t.Union([t.Literal('trial'), t.Literal('paid')]),
      trialLessonLimit: t.Integer({ minimum: 1, maximum: 999 }),
      revision: t.Integer({ minimum: 0, maximum: 2147483646 }),
    }, { additionalProperties: false }) });
}
