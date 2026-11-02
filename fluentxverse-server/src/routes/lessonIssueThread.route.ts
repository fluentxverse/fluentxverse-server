import Elysia, { t } from 'elysia';
import { verifyAuthToken, verifyAdminToken } from '../utils/jwt';
import { lessonIssueFollowupService } from '../services/lessonIssueFollowup.service';
import { lessonIssueImageStorage, sanitizeIssueImage } from '../services/lessonIssueImages';
import { getDriver } from '../db/memgraph';

async function threadActor(cookie: any, adminMode: boolean) {
  const admin = adminMode && cookie.adminAuth?.value ? await verifyAdminToken(String(cookie.adminAuth.value)) : null;
  if (admin) {
    const s = getDriver().session();
    try {
      const r = await s.run("MATCH(a:Admin {id:$id}) WHERE a.role IN ['admin','superadmin'] RETURN a", {id:admin.userId});
      return r.records.length ? { id: admin.userId, role: 'admin' as const } : null;
    } finally { await s.close(); }
  }
  const tutor = cookie.tutorAuth?.value ? await verifyAuthToken(String(cookie.tutorAuth.value)) : null;
  return tutor?.role === 'tutor' ? { id: tutor.userId, role: 'tutor' as const } : null;
}

const Threads = new Elysia({ prefix: '/lesson-issues' })
  .post('/:id/decision', async ({ cookie, query, params, body, set }) => {
    const actor = await threadActor(cookie, query.admin === 'true');
    if (actor?.role !== 'admin') { set.status = 403; return { success: false, error: 'Staff access required' }; }
    try {
      await lessonIssueFollowupService.decide(params.id, actor.id, body.decision, body.reason, body.expectedRevision);
      return { success: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      const safe = /^(Decision changed|Conversation not found|Staff access required|Write an explanation|Remove student|Cancelled lessons)/.test(message);
      set.status = message.startsWith('Decision changed') ? 409 : safe ? 400 : 503;
      return { success: false, error: safe ? message : 'Decision could not be saved. Refresh before retrying.' };
    }
  }, { body: t.Object({ decision: t.Union([t.Literal('ta301'),t.Literal('no_penalty'),t.Literal('past')]), reason: t.String({ minLength: 10, maxLength: 2000 }), expectedRevision: t.Integer({ minimum: 0 }) }) })
  .post('/:id/replies-with-images', async ({ cookie, query, params, body, set }) => {
    const actor = await threadActor(cookie, query.admin === 'true');
    if (!actor) { set.status = 401; return { success: false, error: 'Authentication required' }; }
    try { await lessonIssueFollowupService.authorize(params.id, actor); }
    catch { set.status = 404; return { success: false, error: 'Conversation not found' }; }
    const attachments: { id: string }[] = [];
    try {
      for (const file of body.images) {
        const bytes = await sanitizeIssueImage(file), id = crypto.randomUUID();
        await lessonIssueImageStorage.put(id, bytes); attachments.push({ id });
      }
      await lessonIssueFollowupService.reply(params.id, actor, body.text, attachments);
      return { success: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      const safe = /^(Images must|Invalid image|Write an explanation|Remove student|The 24-hour reply deadline)/.test(message);
      if (safe) await Promise.allSettled(attachments.map(a => lessonIssueImageStorage.remove(a.id)));
      // Do not delete files after an ambiguous database outcome: a committed reply may reference them.
      set.status = safe ? 400 : 503;
      return { success: false, error: safe ? message : 'Image reply could not be confirmed. Refresh the conversation before retrying.' };
    }
  }, { body: t.Object({ text: t.String({ minLength: 10, maxLength: 2000 }), images: t.Files({ minItems: 1, maxItems: 3, maxSize: '5m' }) }) })
  .get('/:id/images/:imageId', async ({ cookie, query, params, set }) => {
    const actor = await threadActor(cookie, query.admin === 'true');
    if (!actor) { set.status = 401; return { success: false, error: 'Authentication required' }; }
    const s = getDriver().session();
    try {
      const rows = await s.run(`MATCH(t:LessonIssueThread {id:$id})-[:HAS_REPLY]->(r:LessonIssueReply)
        WHERE $admin OR t.tutorId=$actor RETURN r.attachmentsJson AS files`, { id: params.id, admin: actor.role === 'admin', actor: actor.id });
      if (!rows.records.some(r => JSON.parse(r.get('files') || '[]').some((a: any) => a.id === params.imageId))) {
        set.status = 404; return { success: false, error: 'Image not found' };
      }
      const image = await lessonIssueImageStorage.get(params.imageId);
      await s.run(`CREATE(:LessonIssueImageAccess {id:$id,imageId:$imageId,threadId:$threadId,actorId:$actorId,actorRole:$role,createdAt:$now})`, {
        id: crypto.randomUUID(), imageId: params.imageId, threadId: params.id, actorId: actor.id, role: actor.role, now: new Date().toISOString(),
      });
      return new Response(image, { headers: {
        'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline; filename="lesson-image.jpg"', 'Content-Security-Policy': "default-src 'none'; sandbox",
      } });
    } catch { set.status = 503; return { success: false, error: 'Image temporarily unavailable' }; }
    finally { await s.close(); }
  })
  .get('/', async ({ cookie, set, query }) => {
    const actor = await threadActor(cookie, query.admin === 'true');
    if (!actor) { set.status = 401; return { success: false, error: 'Authentication required' }; }
    try { return { success: true, data: await lessonIssueFollowupService.list(actor.role === 'admin' ? undefined : actor.id) }; }
    catch { set.status = 503; return { success: false, error: 'Lesson conversations are temporarily unavailable' }; }
  })
  .post('/:id/replies', async ({ cookie, set, params, body, query }) => {
    const actor = await threadActor(cookie, query.admin === 'true');
    if (!actor) { set.status = 401; return { success: false, error: 'Authentication required' }; }
    try {
      await lessonIssueFollowupService.reply(params.id, actor, body.text);
      return { success: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      const safe = /^(Write an explanation|Remove student personal information|The 24-hour reply deadline|Conversation not found)/.test(message);
      set.status = message === 'Conversation not found' ? 404 : safe ? 400 : 503;
      return { success: false, error: safe ? message : 'Could not save your reply. Retry without changing the explanation.' };
    }
  }, { body: t.Object({ text: t.String({ minLength: 10, maxLength: 2000 }) }), params: t.Object({ id: t.String({ minLength: 1, maxLength: 128 }) }) });
export default Threads;
