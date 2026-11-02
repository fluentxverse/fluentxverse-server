import Elysia, { t } from 'elysia';
import { verifyAuthToken } from '../utils/jwt';
import { createAdminGuard } from '../middleware/auth.middleware';
import { isAllowedAdminMutationOrigin, isAllowedTutorMutationOrigin } from '../config/cors';
import { applicationFailure, ApplicationError } from '../services/exam.services/applicationPolicy';
import { tutorIdentity, identityEnabled } from '../services/tutorIdentity/service';
import { getIO } from '../socket/socket.server';
import { interviewIdentityPresence } from '../socket/handlers/interview.handler';
import { getDriver } from '../db/memgraph';
import { lockApplicant } from '../services/exam.services/applicationPolicy';

const TutorIdentity = new Elysia({ prefix: '/tutor-identity' })
  .onBeforeHandle(({ set }) => { set.headers['Cache-Control'] = 'private, no-store'; })
  .onError(({ error, set, code }) => {
    if (code === 'VALIDATION' || code === 'PARSE') { set.status = 400; return { success: false, error: 'Invalid identity request.' }; }
    const failure = applicationFailure(error);
    set.status = failure.status;
    return { success: false, error: error instanceof ApplicationError ? failure.message : 'Identity service unavailable. Please retry.' };
  })
  .derive(async ({ cookie, request, set }) => ({
    tutor: async () => {
      const token = cookie.tutorAuth?.value ? await verifyAuthToken(String(cookie.tutorAuth.value)) : null;
      if (token?.role !== 'tutor') throw new ApplicationError(401, 'Tutor authentication required.');
      if (request.method !== 'GET' && !isAllowedTutorMutationOrigin(request.headers.get('origin'))) throw new ApplicationError(403, 'Tutor origin required.');
      return token.userId;
    },
    admin: async () => {
      if (!isAllowedAdminMutationOrigin(request.headers.get('origin'))) throw new ApplicationError(403, 'Dashboard origin required.');
      const admin = await createAdminGuard(cookie, set, 'operations');
      if (!admin) throw new ApplicationError(403, 'Identity review permission required.');
      return admin.userId;
    },
  }))
  .get('/status', async ({ tutor }) => ({ success: true, data: await tutorIdentity.status(await tutor()) }))
  .post('/submit', async ({ tutor, request }) => {
    const tutorId = await tutor();
    if (!identityEnabled()) throw new ApplicationError(503, 'Identity submission is not enabled.');
    if (Number(request.headers.get('content-length') || 0) > 6 * 1024 * 1024) throw new ApplicationError(413, 'ID image exceeds 5 MB.');
    // Bound chunked bodies too, before multipart parsing or image decoding.
    const reader = request.body?.getReader();
    if (!reader) throw new ApplicationError(400, 'Upload an ID image.');
    let size = 0; const chunks: Uint8Array[] = [];
    try { while (true) { const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > 6 * 1024 * 1024) { await reader.cancel(); throw new ApplicationError(413, 'ID image exceeds 5 MB.'); } chunks.push(part.value);
    } } finally { reader.releaseLock(); }
    const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData();
    const file = form.get('image');
    if (!(file instanceof File)) throw new ApplicationError(400, 'Upload an ID image.');
    return { success: true, data: await tutorIdentity.submit(tutorId, String(form.get('idType')), String(form.get('birthDate')), form.get('consent') === 'true', file) };
  }, { parse: 'none' })
  .get('/admin', async ({ admin }) => { await admin(); return { success: true, data: await tutorIdentity.list() }; })
  .post('/admin/presentation/:interviewId', async ({ admin, params }) => {
    await admin();
    const presence = interviewIdentityPresence(params.interviewId);
    if (!presence.bothPresent || presence.recording) throw new ApplicationError(409, 'Both participants must be connected and recording must be stopped.');
    const s = getDriver().session();
    try { await s.executeWrite(async tx => {
      const found = (await tx.run(`MATCH(s:InterviewSlot {id:$id,status:'booked'}) RETURN s.tutorId AS tutorId`, { id: params.interviewId })).records[0];
      if (!found) throw new ApplicationError(409, 'Interview is not open.');
      await lockApplicant(tx, found.get('tutorId'));
      const r = await tx.run(`MATCH(s:InterviewSlot {id:$id,status:'booked'}) WHERE s.mediaClosedAt IS NULL AND s.identityPresentationEndedAt IS NULL
        SET s.identityPresentationAt=coalesce(s.identityPresentationAt,$at) RETURN s`, { id: params.interviewId, at: new Date().toISOString() });
      if (!r.records.length) throw new ApplicationError(409, 'Identity check already completed.');
    }); } finally { await s.close(); }
    return { success: true };
  })
  .get('/admin/:id/image', async ({ admin, params }) => new Response(await tutorIdentity.image(params.id, await admin()), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="identity.jpg"' },
  }))
  .post('/admin/:id/review', async ({ admin, params, body }) => {
    const adminId = await admin();
    const tutorId = await tutorIdentity.review(params.id, adminId, body.action, body.reason, body.adultConfirmed, body.interviewId);
    if (body.action === 'mismatch' || body.action === 'fraud') {
      const io = getIO();
      if (body.interviewId) io?.to(`interview-${body.interviewId}`).emit('interview:ended');
      if (body.action === 'fraud' && io) for (const socket of io.sockets.sockets.values()) {
        if (socket.data.userId === tutorId && socket.data.userType === 'tutor') {
          if (socket.data.interviewRoomId) io.to(socket.data.interviewRoomId).emit('interview:ended');
          socket.disconnect(true);
        }
      }
    }
    return { success: true };
  }, { body: t.Object({ action: t.Union(['accept', 'resubmit', 'fraud', 'match', 'mismatch', 'revoke'].map(v => t.Literal(v))), reason: t.String({ minLength: 1, maxLength: 1000 }), adultConfirmed: t.Boolean(), interviewId: t.Optional(t.String()) }) });
export default TutorIdentity;
