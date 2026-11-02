import { test, expect, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { tutorIdentity } from '../src/services/tutorIdentity/service';
import { identityStorage } from '../src/services/tutorIdentity/storage';
import { InterviewService } from '../src/services/interview.services/interview.service';
import { nextManilaMidnight } from '../../shared/tutorIdentity';
import { ensureTutorIdentitySchema } from '../src/services/tutorIdentity/schema';
import { assertTutorApplicationApproved } from '../src/services/schedule.services/schedulingGuards';
import { mailProvider } from '../src/services/mail/mailProvider';
import { deliverIdentityNotices } from '../src/services/tutorIdentity/worker';

test('identity lifecycle persists gates, races, expiry, cancellation, no-show, mismatch, approval and deletion', async () => {
  if (process.env.IDENTITY_TEST_URI !== 'bolt://127.0.0.1:17741') throw Error('Use the dedicated empty identity QA graph.');
  const dir = await mkdtemp(join(tmpdir(), 'identity-lifecycle-'));
  process.env.TUTOR_IDENTITY_PRIVATE_DIR = dir; process.env.TUTOR_IDENTITY_ENABLED = 'true';
  const oldFiler = process.env.SEAWEED_FILER_URL;
  const objects = new Map<string, Buffer>();
  const filer = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async req => {
    const path = new URL(req.url).pathname;
    if (req.method === 'PUT') { objects.set(path, Buffer.from(await req.arrayBuffer())); return new Response('ok'); }
    if (req.method === 'DELETE') { objects.delete(path); return new Response('ok'); }
    return new Response(req.method === 'HEAD' ? null : objects.get(path), { status: objects.has(path) ? 200 : 404 });
  } });
  process.env.SEAWEED_FILER_URL = filer.url.toString().replace(/\/$/, '');
  await initDriver(process.env.IDENTITY_TEST_URI, '', '', 1);
  const db = getDriver().session(), interviews = new InterviewService();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64');
  const file = () => new File([png], 'synthetic.png', { type: 'image/png' });
  let owned = false;
  const state = async (id = 'identity-tutor') => (await tutorIdentity.status(id)).record!;
  try {
    expect((await db.run('MATCH(n) RETURN count(n) AS n')).records[0]!.get('n').toNumber()).toBe(0); owned = true;
    await ensureTutorIdentitySchema(); await ensureTutorIdentitySchema();
    await db.run(`CREATE(:User {id:'identity-tutor',role:'tutor',email:'identity@example.invalid',verifiedEmail:true,verifiedEmailAddress:'identity@example.invalid',
      writtenExamPassed:true,speakingExamPassed:true}),(:User {id:'not-ready',role:'tutor'})`);
    await expect(tutorIdentity.submit('identity-tutor', 'national', '2010-01-01', true, file())).rejects.toThrow('18');
    await expect(tutorIdentity.submit('identity-tutor', 'unsupported', '2000-01-01', true, file())).rejects.toThrow();
    await expect(tutorIdentity.submit('not-ready', 'national', '2000-01-01', true, file())).rejects.toThrow();
    const tomorrow = new Date(Date.now() + 86400_000 + 8 * 3600_000).toISOString().slice(0, 10);
    const [slot] = await interviews.createSlots([{ date: tomorrow, time: '2:00 PM' }]);
    await expect(interviews.bookSlot(slot!.id, 'identity-tutor')).rejects.toThrow('ID');
    const outcomes = await Promise.allSettled([tutorIdentity.submit('identity-tutor', 'national', '2000-01-01', true, file()), tutorIdentity.submit('identity-tutor', 'national', '2000-01-01', true, file())]);
    expect(outcomes.filter(o => o.status === 'fulfilled').length).toBe(1);
    const id = (await state()).id;
    await expect(db.executeRead(tx => assertTutorApplicationApproved(tx, 'identity-tutor'))).rejects.toThrow();
    await expect(tutorIdentity.review(id, 'staff', 'accept', 'Readable', false)).rejects.toThrow('18');
    await tutorIdentity.review(id, 'staff', 'accept', 'Readable, adult document checked', true);
    expect(Date.parse((await state()).bookingDeadline!) - Date.parse((await state()).acceptedAt!)).toBe(84 * 3600000);
    await interviews.bookSlot(slot!.id, 'identity-tutor');
    expect((await state()).status).toBe('booked');
    await interviews.cancelBooking(slot!.id, 'identity-tutor');
    expect((await state()).status).toBe('resubmit');
    await tutorIdentity.maintenance(); expect((await state()).deletedAt).toBeTruthy();
    await expect(identityStorage.get(id)).rejects.toThrow();
    await db.run(`MATCH(u:User {id:'identity-tutor'}) REMOVE u.identitySubmittedAt`);
    await tutorIdentity.submit('identity-tutor', 'school', '2000-01-01', true, file());
    let current = (await state()).id;
    await tutorIdentity.review(current, 'staff', 'resubmit', 'Blurry image', false);
    expect((await state()).deleteAt).toBe(nextManilaMidnight(Date.now()));
    expect((await db.run(`MATCH(u:User {id:'identity-tutor'}) RETURN u.identityBanned AS banned`)).records[0]!.get('banned')).not.toBe(true);
    const rejectedId = current;
    await tutorIdentity.submit('identity-tutor', 'passport', '2000-01-01', true, file());
    expect((await state()).status).toBe('pending_review');
    expect((await state()).id).not.toBe(rejectedId);
    await expect(identityStorage.get(rejectedId)).rejects.toThrow();
    expect((await db.run('MATCH(i:TutorIdentity {id:$id}) RETURN i.deletedAt AS at', { id: rejectedId })).records[0]!.get('at')).toBeTruthy();
    await tutorIdentity.review((await state()).id, 'staff', 'resubmit', 'New image still blurry', false);
    await tutorIdentity.maintenance(Date.parse((await state()).deleteAt!));
    expect((await state()).deletedAt).toBeTruthy();
    await db.run(`MATCH(u:User {id:'identity-tutor'}) REMOVE u.identitySubmittedAt`);
    await tutorIdentity.submit('identity-tutor', 'passport', '2000-01-01', true, file());
    current = (await state()).id;
    await tutorIdentity.review(current, 'staff', 'accept', 'Readable adult ID', true);
    await db.run(`MATCH(i:TutorIdentity {id:$id}) SET i.bookingDeadline=$past`, { id: current, past: new Date(Date.now() - 1).toISOString() });
    await expect(interviews.bookSlot(slot!.id, 'identity-tutor')).rejects.toThrow('84 hours');
    await tutorIdentity.maintenance(); expect((await state()).status).toBe('expired'); expect((await state()).deletedAt).toBeTruthy();
    await db.run(`MATCH(u:User {id:'identity-tutor'}) REMOVE u.identitySubmittedAt`);
    await tutorIdentity.submit('identity-tutor', 'prc', '2000-01-01', true, file()); current = (await state()).id;
    await tutorIdentity.review(current, 'staff', 'accept', 'Readable adult ID', true);
    await interviews.bookSlot(slot!.id, 'identity-tutor');
    await tutorIdentity.maintenance(Date.now() + 3 * 86400_000);
    expect((await state()).status).toBe('resubmit'); expect((await state()).deletedAt).toBeTruthy();
    await db.run(`MATCH(u:User {id:'identity-tutor'}) REMOVE u.identitySubmittedAt`);
    await tutorIdentity.submit('identity-tutor', 'prc', '2000-01-01', true, file()); current = (await state()).id;
    await tutorIdentity.review(current, 'staff', 'accept', 'Readable adult ID', true);
    await db.run(`MATCH(s:InterviewSlot {id:$slotId}) SET s.status='open' REMOVE s.tutorId,s.mediaClosedAt`, { slotId: slot!.id });
    await interviews.bookSlot(slot!.id, 'identity-tutor');
    await expect(tutorIdentity.review(current, 'staff', 'match', 'Matches', true, slot!.id)).rejects.toThrow('unrecorded');
    await db.run(`MATCH(s:InterviewSlot {id:$id}) SET s.tutorEnteredAt=$at,s.adminEnteredAt=$at,s.identityPresentationAt=$at`, { id: slot!.id, at: new Date().toISOString() });
    await tutorIdentity.review(current, 'staff', 'mismatch', 'Different document presented', false, slot!.id);
    expect((await state()).status).toBe('resubmit'); await tutorIdentity.maintenance();
    await db.run(`MATCH(u:User {id:'identity-tutor'}) REMOVE u.identitySubmittedAt`);
    await tutorIdentity.submit('identity-tutor', 'national', '2000-01-01', true, file()); current = (await state()).id;
    await tutorIdentity.review(current, 'staff', 'accept', 'Readable adult ID', true);
    await db.run(`MATCH(s:InterviewSlot {id:$id}) SET s.status='open' REMOVE s.tutorId,s.mediaClosedAt,s.identityPresentationEndedAt`, { id: slot!.id });
    await interviews.bookSlot(slot!.id, 'identity-tutor');
    await db.run(`MATCH(s:InterviewSlot {id:$id}) SET s.tutorEnteredAt=$at,s.adminEnteredAt=$at,s.identityPresentationAt=$at`, { id: slot!.id, at: new Date().toISOString() });
    await tutorIdentity.review(current, 'staff', 'match', 'Same document, face and adult age verified live', true, slot!.id);
    expect((await state()).status).toBe('verified');
    await expect(tutorIdentity.review(current, 'staff', 'match', 'Duplicate', true, slot!.id)).rejects.toThrow();
    expect((await db.run('MATCH(j:TutorIdentityCredential) RETURN count(j) AS n')).records[0]!.get('n').toNumber()).toBe(1);
    const credential = (await db.run('MATCH(j:TutorIdentityCredential) RETURN j')).records[0]!.get('j').properties;
    expect(Number(credential.expiresAt)).toBe(0); expect(credential.status).toBe('awaiting_configuration');
    await interviews.saveInterviewResult({ slotId: slot!.id, tutorId: 'identity-tutor', result: 'pass', rubricScores: { grammar: 4, fluency: 4, pronunciation: 4, vocabulary: 4, professionalism: 4 }, notes: 'Teaching pass', timestamps: [], adminId: 'staff' });
    await db.run(`MATCH(u:User {id:'identity-tutor'}) SET u.profileStatus='approved'`);
    await db.executeRead(tx => assertTutorApplicationApproved(tx, 'identity-tutor'));
    expect((await state()).deleteAt).toBe(nextManilaMidnight(Date.now()));
    await tutorIdentity.maintenance(Date.parse((await state()).deleteAt!)); expect((await state()).deletedAt).toBeTruthy();
    expect((await state()).status).toBe('verified');
    await tutorIdentity.review(current, 'staff', 'revoke', 'Verification withdrawn for test', false);
    await tutorIdentity.review(current, 'staff', 'fraud', 'Explicit confirmed fraud finding', false);
    expect((await state()).status).toBe('fraud');
    await expect(db.executeRead(tx => assertTutorApplicationApproved(tx, 'identity-tutor'))).rejects.toThrow();
    expect((await db.run('MATCH(j:TutorIdentityCredential) RETURN j.revoked AS revoked')).records[0]!.get('revoked')).toBe(true);
    const unfinished = crypto.randomUUID();
    await db.run(`CREATE(:User {id:'unmatched-tutor',role:'tutor',identitySubmissionId:$id}),
      (:TutorIdentity {id:$id,tutorId:'unmatched-tutor',status:'booked',interviewId:'unmatched-interview'}),
      (:InterviewSlot {id:'unmatched-interview',tutorId:'unmatched-tutor',status:'completed'})`, { id: unfinished });
    await interviews.saveInterviewResult({ slotId: 'unmatched-interview', tutorId: 'unmatched-tutor', result: 'fail',
      rubricScores: { grammar: 1, fluency: 1, pronunciation: 1, vocabulary: 1, professionalism: 1 }, notes: 'No completed identity check', timestamps: [], adminId: 'staff' });
    expect((await state('unmatched-tutor')).status).toBe('resubmit');
    expect((await state('unmatched-tutor')).deleteAt).toBe(nextManilaMidnight(Date.now()));
    for (const action of ['accept', 'resubmit', 'match', 'mismatch', 'revoke', 'fraud']) {
      const notices = await db.run('MATCH(n:TutorIdentityNotice) WHERE n.id ENDS WITH $suffix RETURN count(n) AS n', { suffix: ':' + action });
      expect(Number(notices.records[0]!.get('n'))).toBeGreaterThan(0);
    }
    const oldTutor = process.env.TUTOR, oldMail = process.env.MAIL_ACCOUNTS_JSON;
    process.env.TUTOR = 'synthetic-mail-password'; process.env.MAIL_ACCOUNTS_JSON = '[]';
    const sent: string[] = [];
    let failOnce = true;
    const send = spyOn(mailProvider, 'send').mockImplementation(async (account, draft, requestId) => {
      if (failOnce) { failOnce = false; throw Error('Synthetic SMTP outage'); }
      expect(account.address).toBe('tutor@fluentxverse.com'); expect(draft.attachments).toEqual([]);
      expect(draft.text).not.toContain('2000-01-01'); sent.push(requestId);
      return { messageId: requestId };
    });
    try {
      await deliverIdentityNotices(); const count = sent.length;
      expect(count).toBeGreaterThan(0); expect(new Set(sent).size).toBe(count);
      await deliverIdentityNotices(); expect(sent.length).toBe(count);
      const pending = await db.run("MATCH(n:TutorIdentityNotice) WHERE n.status <> 'sent' RETURN count(n) AS n");
      expect(Number(pending.records[0]!.get('n'))).toBe(1);
      await db.run("MATCH(n:TutorIdentityNotice) WHERE n.status <> 'sent' SET n.nextAttempt='2000-01-01T00:00:00.000Z'");
      await deliverIdentityNotices(); expect(sent.length).toBe(count + 1);
      await deliverIdentityNotices(); expect(sent.length).toBe(count + 1);
    } finally {
      send.mockRestore();
      if (oldTutor === undefined) delete process.env.TUTOR; else process.env.TUTOR = oldTutor;
      if (oldMail === undefined) delete process.env.MAIL_ACCOUNTS_JSON; else process.env.MAIL_ACCOUNTS_JSON = oldMail;
    }
  } finally {
    if (owned) await db.run('MATCH(n) DETACH DELETE n');
    await db.close(); await closeDriver(); await rm(dir, { recursive: true, force: true });
    filer.stop(true);
    if (oldFiler === undefined) delete process.env.SEAWEED_FILER_URL; else process.env.SEAWEED_FILER_URL = oldFiler;
    delete process.env.TUTOR_IDENTITY_ENABLED; delete process.env.TUTOR_IDENTITY_PRIVATE_DIR;
  }
}, 60000);
