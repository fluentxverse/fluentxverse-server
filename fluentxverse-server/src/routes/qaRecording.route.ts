import Elysia, { t } from 'elysia';
import { createAdminGuard } from '../middleware/auth.middleware';
import { qaRecordingService } from '../services/qaRecording.service';
import { AdminService } from '../services/admin.services/admin.service';
import { isAllowedAdminMutationOrigin } from '../config/cors';

const idSchema = { params: t.Object({ id: t.String({ format: 'uuid' }) }) };
export const qaRecordingRoute = new Elysia({ prefix: '/admin/recordings' })
  .derive(async ({ cookie, set }) => {
    const payload = await createAdminGuard(cookie,set,'qa');
    // Legacy role-less tokens must never grant access to confidential recordings.
    const admin = payload && ['admin','superadmin'].includes(payload.role || '') && await new AdminService().getById(payload.userId) ? payload : null;
    return { recordingAdmin: admin };
  })
  .onBeforeHandle(({ recordingAdmin, set }) => {
    set.headers['Cache-Control'] = 'private, no-store';
    if (!recordingAdmin) { set.status=403; return { success:false,error:'Administrator authentication required' }; }
  })
  .get('/', async ({ recordingAdmin, query }) => ({success:true,data:await qaRecordingService.list(recordingAdmin!.userId,query.page || 1,query.booking || '')}), {
    query:t.Object({page:t.Optional(t.Numeric({minimum:1,maximum:10000})),booking:t.Optional(t.String({maxLength:200}))}),
  })
  .get('/:id/playback', async ({recordingAdmin, params, request}) => qaRecordingService.playback(recordingAdmin!.userId,params.id,request.headers.get('range')), idSchema)
  .get('/:id/audit', async ({recordingAdmin,params}) => ({success:true,data:await qaRecordingService.accessLog(recordingAdmin!.userId,params.id)}), idSchema)
  .delete('/:id', async ({recordingAdmin,params,request,set}) => {
    const origin = request.headers.get('origin');
    if (!isAllowedAdminMutationOrigin(origin)) {
      set.status=403; return {success:false,error:'Untrusted origin'};
    }
    await qaRecordingService.delete(recordingAdmin!.userId,params.id);
    return {success:true};
  },idSchema)
  .onError(({set}) => {set.status=503;return {success:false,error:'Recording service unavailable. Please retry.'};});
