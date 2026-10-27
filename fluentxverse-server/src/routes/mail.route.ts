import Elysia, { t } from 'elysia';
import { createAdminGuard } from '../middleware/auth.middleware';
import { isAllowedAdminMutationOrigin } from '../config/cors';
import { MailError, readMailJson } from '../services/mail/mailPolicy';
import { mailService } from '../services/mail/mailService';
const folder = t.String({ minLength: 1, maxLength: 255, pattern: '^[^\\r\\n\\u0000]+$' });
const validity = t.String({ pattern: '^[0-9]{1,30}$' });
const query = t.Object({ folder, uidValidity: validity });
const uid = t.String({ pattern: '^[1-9][0-9]{0,9}$' });
const account = t.String({ pattern: '^[a-z0-9-]{1,50}$' });
const uuid = t.String({ format: 'uuid' });

export function createMailRoute(service = mailService, guard = createAdminGuard) {
  return new Elysia({ prefix: '/admin/mail', name: 'admin-mail', normalize: false })
    .onParse(async ({ request, contentType }) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
      if (!request.body) return {};
      if (contentType !== 'application/json') throw new MailError(415, 'Email requests must use JSON.');
      return readMailJson(request);
    })
    .derive(async ({ cookie, set }) => ({ mailActor: await guard(cookie, set) }))
    .onBeforeHandle(({ mailActor, request, set }) => {
      set.headers['Cache-Control'] = 'private, no-store'; set.headers['X-Content-Type-Options'] = 'nosniff';
      if (!mailActor) return { success: false, error: 'Administrator authentication required.' };
      service.access(mailActor);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !isAllowedAdminMutationOrigin(request.headers.get('origin'))) {
        set.status = 403; return { success: false, error: 'Untrusted origin.' };
      }
    })
    .onError(({ error, code, set }) => {
      set.status = error instanceof MailError ? error.status : code === 'VALIDATION' || code === 'PARSE' ? 400 : 503;
      return { success: false, error: error instanceof MailError ? error.message : code === 'VALIDATION' || code === 'PARSE' ? 'Invalid email request.' : 'Email is temporarily unavailable. Please try again.' };
    })
    .get('/status', ({ mailActor }) => ({ success: true, data: service.status(mailActor!) }))
    .get('/preferences', async ({ mailActor }) => ({ success: true, data: await service.preferences(mailActor!) }))
    .put('/preferences', async ({ mailActor, body }) => { await service.savePreferences(mailActor!, body); return { success: true }; }, { body: t.Any() })
    .get('/:account/folders', async ({ mailActor, params }) => ({ success: true, data: await service.folders(mailActor!, params.account) }), { params: t.Object({ account }) })
    .post('/:account/folders', async ({ mailActor, params, body }) => { await service.createFolder(mailActor!, params.account, body.name); return { success: true }; }, { params: t.Object({ account }), body: t.Object({ name: t.String({ minLength: 1, maxLength: 80, pattern: '^[^\\r\\n\\u0000/\\\\]+$' }) }, { additionalProperties: false }) })
    .post('/:account/verify', async ({ mailActor, params }) => { await service.verify(mailActor!, params.account); return { success: true }; }, { params: t.Object({ account }) })
    .get('/:account/messages', async ({ mailActor, params, query }) => ({ success: true, data: await service.list(mailActor!, params.account, query.folder, Number(query.page || 1), query.search || '', query.filter || 'all') }), {
      params: t.Object({ account }), query: t.Object({ folder, page: t.Optional(t.String({ pattern: '^[1-9][0-9]{0,5}$' })), search: t.Optional(t.String({ maxLength: 200 })), filter: t.Optional(t.Union([t.Literal('all'), t.Literal('unread'), t.Literal('starred')])) }) })
    .get('/:account/messages/:uid', async ({ mailActor, params, query }) => ({ success: true, data: await service.message(mailActor!, params.account, query.folder, Number(params.uid), query.uidValidity) }), { params: t.Object({ account, uid }), query })
    .get('/:account/messages/:uid/attachments/:index', async ({ mailActor, params, query }) => {
      const file = await service.attachment(mailActor!, params.account, query.folder, Number(params.uid), query.uidValidity, Number(params.index));
      return new Response(file.content, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox' } });
    }, { params: t.Object({ account, uid, index: t.String({ pattern: '^[0-9]{1,3}$' }) }), query })
    .post('/:account/actions', async ({ mailActor, params, body }) => { await service.action(mailActor!, params.account, body.folder, body.uidValidity, body.uids, body.action, body.destination); return { success: true }; }, {
      params: t.Object({ account }), body: t.Object({ folder, uidValidity: validity, uids: t.Array(t.Integer({ minimum: 1, maximum: 4294967295 }), { minItems: 1, maxItems: 100 }),
        action: t.Union((['read', 'unread', 'star', 'unstar', 'archive', 'trash', 'spam', 'move'] as const).map(value => t.Literal(value))), destination: t.Optional(folder) }, { additionalProperties: false }) })
    .get('/:account/drafts', async ({ mailActor, params }) => ({ success: true, data: await service.listDrafts(mailActor!, params.account) }), { params: t.Object({ account }) })
    .put('/:account/drafts', async ({ mailActor, params, body }) => ({ success: true, data: await service.saveDraft(mailActor!, params.account, body) }), { params: t.Object({ account }), body: t.Any() })
    .delete('/:account/drafts/:id', async ({ mailActor, params }) => { await service.deleteDraft(mailActor!, params.account, params.id); return { success: true }; }, { params: t.Object({ account, id: uuid }) })
    .post('/:account/send', async ({ mailActor, params, body }) => ({ success: true, data: await service.send(mailActor!, params.account, body.draftId, body.revision, body.requestId) }), {
      params: t.Object({ account }), body: t.Object({ draftId: uuid, revision: t.Integer({ minimum: 1, maximum: 2147483646 }), requestId: uuid }, { additionalProperties: false }) });
}
export const mailRoute = createMailRoute();
