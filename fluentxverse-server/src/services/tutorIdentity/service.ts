import type { ManagedTransaction } from 'neo4j-driver';
import { getDriver } from '../../db/memgraph';
import { ApplicationError, lockApplicant, repairPassedFlag } from '../exam.services/applicationPolicy';
import { acceptedTutorIds, ID_BOOKING_WINDOW_MS, isAdult, nextManilaMidnight, identityCanBook, type TutorIdentityRecord } from '../../../../shared/tutorIdentity';
import { sanitizeIssueImage } from '../lessonIssueImages';
import { identityStorage } from './storage';
import { interviewStart } from '../interview.services/interviewTime';
import { logger } from '../../utils/logger';

export const identityEnabled = () => process.env.TUTOR_IDENTITY_ENABLED === 'true';
let processingUploads = 0;
const publicRecord = (p: any): TutorIdentityRecord | null => p ? Object.fromEntries(
  ['id', 'tutorId', 'idType', 'status', 'createdAt', 'acceptedAt', 'bookingDeadline', 'interviewId', 'reason',
    'deleteAt', 'deletedAt', 'verifiedAt', 'credentialStatus', 'name'].map(k => [k, p[k]])) as unknown as TutorIdentityRecord : null;
export async function currentIdentity(tx: ManagedTransaction, tutorId: string) {
  return (await tx.run(`MATCH(u:User {id:$tutorId}) MATCH(i:TutorIdentity {id:u.identitySubmissionId}) RETURN i`, { tutorId }))
    .records[0]?.get('i').properties;
}
async function notice(tx: ManagedTransaction, id: string, tutorId: string, text: string) {
  await tx.run(`MERGE(n:TutorIdentityNotice {id:$id}) ON CREATE SET n.tutorId=$tutorId,n.text=$text,n.status='pending',n.nextAttempt=$now`,
    { id, tutorId, text, now: new Date().toISOString() });
}
export async function requireIdentityBooking(tx: ManagedTransaction, tutorId: string) {
  if (!identityEnabled()) return null;
  const record = await currentIdentity(tx, tutorId);
  if (!identityCanBook(record)) throw new ApplicationError(409, 'Submit an ID and obtain staff acceptance before booking. Acceptance is valid for 84 hours.');
  return record;
}
export async function invalidateIdentity(tx: ManagedTransaction, tutorId: string, reason: string, now = Date.now()) {
  const record = await currentIdentity(tx, tutorId);
  if (!record || !['accepted', 'booked', 'pending_review', 'verified'].includes(record.status)) return;
  await tx.run(`MATCH(i:TutorIdentity {id:$id}) SET i.status='resubmit',i.reason=$reason,i.deleteAt=$at`,
    { id: record.id, reason, at: new Date(now).toISOString() });
  if (record.status === 'verified') {
    await tx.run(`MATCH(u:User {id:$tutorId}) SET u.identityVerified=false`, { tutorId });
    await tx.run(`MATCH(j:TutorIdentityCredential {id:$id}) SET j.revoked=true,j.status='revoked'`, { id: record.id });
  }
  await notice(tx, `${record.id}:resubmit`, tutorId, 'Please submit your ID again to continue your tutor application. ' + reason);
}
export class TutorIdentityService {
  async recoverMissingImages() {
    const s = getDriver().session();
    try {
      const rows = await s.run(`MATCH(i:TutorIdentity) WHERE i.deletedAt IS NULL AND i.status IN ['pending_review','accepted','booked'] RETURN i`);
      for (const row of rows.records) {
        const i = row.get('i').properties;
        if (await identityStorage.has(i.id)) continue;
        await s.executeWrite(async tx => {
          await lockApplicant(tx, i.tutorId, true);
          const current = await currentIdentity(tx, i.tutorId);
          if (current?.id !== i.id || !['pending_review','accepted','booked'].includes(current.status)) return;
          await invalidateIdentity(tx, i.tutorId, 'Private ID image is no longer available after a service restart. Please resubmit.');
          if (current.interviewId) await tx.run(`MATCH(s:InterviewSlot {id:$id,status:'booked'}) SET s.status='cancelled',s.mediaClosedAt=$now`, { id: current.interviewId, now: new Date().toISOString() });
        });
      }
    } finally { await s.close(); }
  }
  async status(tutorId: string) {
    const s = getDriver().session();
    try {
      const row = (await s.run(`MATCH(u:User {id:$tutorId}) OPTIONAL MATCH(i:TutorIdentity {id:u.identitySubmissionId}) RETURN i`, { tutorId })).records[0];
      return { enabled: identityEnabled(), record: publicRecord(row?.get('i')?.properties) };
    } finally { await s.close(); }
  }
  async submit(tutorId: string, idType: string, birthDate: string, consent: boolean, file: File) {
    if (!identityEnabled()) throw new ApplicationError(503, 'Identity submission is not enabled.');
    if (!acceptedTutorIds.some(i => i[0] === idType) || !consent || !isAdult(birthDate))
      throw new ApplicationError(400, 'Select an accepted ID, confirm the privacy notice, and confirm that you are at least 18.');
    // Decode, re-encode and strip metadata before encrypting. No original or thumbnail is retained.
    if (processingUploads >= 2) throw new ApplicationError(429, 'ID processing is busy. Please retry shortly.');
    processingUploads++;
    let bytes: Buffer;
    try { bytes = await sanitizeIssueImage(file, true); }
    finally { processingUploads--; }
    const id = crypto.randomUUID(), now = new Date().toISOString();
    await identityStorage.put(id, bytes);
    const s = getDriver().session();
    try {
      // Leave uncertain commits for the DB-aware orphan sweeper, rather than deleting an
      // image which might already belong to a successfully committed submission.
      const replacedId = await s.executeWrite(async tx => {
        const u = await lockApplicant(tx, tutorId, false, true);
        const old = await currentIdentity(tx, tutorId);
        if (!old || !['resubmit', 'expired'].includes(old.status)) {
          if (Date.parse(u.identitySubmittedAt || '') > Date.now() - 60000) throw new ApplicationError(429, 'Please wait a minute before another ID submission.');
        }
        const written = u.writtenExamPassed === true || await repairPassedFlag(tx, tutorId, 'written');
        const oral = u.speakingExamPassed === true || await repairPassedFlag(tx, tutorId, 'speaking');
        if (!written || !oral) throw new ApplicationError(409, 'Complete both assessments before submitting an ID.');
        if (old && ['pending_review', 'accepted', 'booked', 'verified', 'fraud'].includes(old.status))
          throw new ApplicationError(409, 'Your existing identity submission must be resolved first.');
        if (old && !old.deletedAt) await tx.run('MATCH(i:TutorIdentity {id:$id}) SET i.deleteAt=$now', { id: old.id, now });
        await tx.run(`MATCH(u:User {id:$tutorId}) CREATE(i:TutorIdentity {id:$id,tutorId:$tutorId,idType:$idType,
          status:'pending_review',createdAt:$now,consentVersion:'tutor-identity.v1',adultDeclared:true})
          SET u.identitySubmissionId=$id,u.identitySubmittedAt=$now,u.identityRequired=true,u.identityVerified=false MERGE(u)-[:SUBMITTED_IDENTITY]->(i)`, { id, tutorId, idType, now });
        return old && !old.deletedAt ? old.id as string : null;
      });
      if (replacedId) {
        try {
          await identityStorage.remove(replacedId);
          await s.run('MATCH(i:TutorIdentity {id:$id}) SET i.deletedAt=$at', { id: replacedId, at: new Date().toISOString() });
        } catch { logger.warn('Replaced identity image deletion pending retry'); }
      }
    } finally { bytes.fill(0); await s.close(); }
    return this.status(tutorId);
  }
  async list() {
    const s = getDriver().session();
    try { return (await s.run(`MATCH(u:User) MATCH(i:TutorIdentity {id:u.identitySubmissionId})
      RETURN i,u.firstName AS first,u.lastName AS last ORDER BY i.createdAt DESC LIMIT 200`)).records.map(r =>
      publicRecord({ ...r.get('i').properties, name: `${r.get('first') || ''} ${r.get('last') || ''}`.trim() }));
    } finally { await s.close(); }
  }
  async image(id: string, adminId: string) {
    const s = getDriver().session();
    try {
      const i = (await s.run('MATCH(i:TutorIdentity {id:$id}) RETURN i', { id })).records[0]?.get('i').properties;
      if (!i || i.deletedAt || (i.deleteAt && i.deleteAt <= new Date().toISOString())) throw new ApplicationError(404, 'ID image is no longer available.');
      const bytes = await identityStorage.get(id);
      await s.run(`CREATE(:TutorIdentityAccess {id:$event,submissionId:$id,adminId:$adminId,at:$now})`,
        { id, event: crypto.randomUUID(), adminId, now: new Date().toISOString() });
      return bytes;
    } finally { await s.close(); }
  }
  async review(id: string, adminId: string, action: 'accept' | 'resubmit' | 'fraud' | 'match' | 'mismatch' | 'revoke', reason: string, adultConfirmed: boolean, interviewId?: string) {
    if (!reason.trim() || reason.length > 1000) throw new ApplicationError(400, 'Add a review reason (up to 1,000 characters). Do not include ID numbers.');
    const s = getDriver().session();
    try {
      return await s.executeWrite(async tx => {
        const found = (await tx.run('MATCH(i:TutorIdentity {id:$id}) RETURN i.tutorId AS tutorId', { id })).records[0];
        if (!found) throw new ApplicationError(404, 'Submission not found.');
        const tutorId = found.get('tutorId');
        await lockApplicant(tx, tutorId, true);
        const i = await currentIdentity(tx, tutorId), now = Date.now(), at = new Date(now).toISOString();
        if (i?.id !== id) throw new ApplicationError(409, 'Submission has been superseded.');
        if (action === 'accept' || action === 'resubmit') {
          if (i.status !== 'pending_review' || i.deletedAt) throw new ApplicationError(409, 'This submission has already been reviewed.');
          if (action === 'accept' && !adultConfirmed) throw new ApplicationError(400, 'Confirm the applicant is 18 or older from the document.');
          await tx.run(`MATCH(i:TutorIdentity {id:$id}) SET i.status=$status,i.reason=$reason,i.acceptedAt=$accepted,
            i.bookingDeadline=$deadline,i.deleteAt=$deleteAt,i.adultConfirmed=$adultConfirmed`, {
            id, reason, status: action === 'accept' ? 'accepted' : 'resubmit', accepted: action === 'accept' ? at : null,
            deadline: action === 'accept' ? new Date(now + ID_BOOKING_WINDOW_MS).toISOString() : null,
            deleteAt: action === 'accept' ? null : nextManilaMidnight(now), adultConfirmed,
          });
          await notice(tx, `${id}:${action}`, tutorId, action === 'accept'
            ? `Your ID review is complete: accepted. Book your interview by ${new Date(now + ID_BOOKING_WINDOW_MS).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} (Asia/Manila). You have 84 hours from acceptance, with no extension. Interview slots are opened three days ahead. Bring the same ID to your interview.`
            : 'Your ID review is complete: resubmission required. ' + reason + ' You can upload a replacement now. After it is saved, your rejected image will be deleted. If you do not resubmit, it is scheduled for deletion at the next Manila midnight.');
        } else if (action === 'match' || action === 'mismatch') {
          const slot = (await tx.run(`MATCH(s:InterviewSlot {id:$interviewId,tutorId:$tutorId,status:'booked'}) RETURN s`,
            { interviewId: interviewId || '', tutorId })).records[0]?.get('s').properties;
          if (i.status !== 'booked' || i.interviewId !== interviewId || !slot || slot.mediaClosedAt || !slot.tutorEnteredAt || !slot.adminEnteredAt || slot.identityPresentationAt == null || slot.identityPresentationEndedAt != null)
            throw new ApplicationError(409, 'Open the booked interview and start the unrecorded ID check first.');
          if (action === 'match' && !adultConfirmed) throw new ApplicationError(400, 'Confirm that the same ID, live face and adult age match.');
          await tx.run(`MATCH(i:TutorIdentity {id:$id}),(u:User {id:$tutorId}),(s:InterviewSlot {id:$interviewId})
            SET i.status=$status,i.reason=$reason,i.verifiedAt=$verifiedAt,i.credentialStatus=$credentialStatus,
            i.deleteAt=$deleteAt,u.identityVerified=$verified,s.identityPresentationEndedAt=$at`, {
            id, tutorId, interviewId, at, reason, status: action === 'match' ? 'verified' : 'resubmit',
            verifiedAt: action === 'match' ? at : null, credentialStatus: action === 'match' ? 'awaiting_credential_configuration' : null,
            deleteAt: action === 'match' ? null : at, verified: action === 'match',
          });
          if (action === 'match') {
            await notice(tx, `${id}:match`, tutorId, 'Your live identity check is complete: verified. Your teaching/interview decision is recorded separately. This email does not confirm a teaching approval or wallet credential issuance.');
            // Unique under the applicant lock. This is a durable issuance request, not a ZK proof.
            await tx.run(`MERGE(j:TutorIdentityCredential {id:$id}) ON CREATE SET j.tutorId=$tutorId,j.status='awaiting_configuration',
              j.createdAt=$at,j.expiresAt=0,j.revoked=false,j.policy='tutor-identity.v1'`, { id, tutorId, at });
          } else {
            await tx.run(`MATCH(s:InterviewSlot {id:$interviewId}) SET s.status='cancelled',s.mediaClosedAt=$at`, { interviewId, at });
            await notice(tx, `${id}:mismatch`, tutorId, 'Your interview stopped because the identity check did not match. Submit an ID again and present that same document at your new interview.');
          }
        } else {
          if (action === 'revoke' && i.status !== 'verified') throw new ApplicationError(409, 'Only a verified identity can be revoked.');
          await tx.run(`MATCH(i:TutorIdentity {id:$id}),(u:User {id:$tutorId})
            SET i.status=$status,i.reason=$reason,i.deleteAt=$at,i.credentialStatus='revoked',u.identityVerified=false,
              u.identityBanned=$banned,u.identityBanReason=$banReason`, {
            id, tutorId, reason, at, status: action === 'fraud' ? 'fraud' : 'resubmit', banned: action === 'fraud', banReason: action === 'fraud' ? reason : null,
          });
          await tx.run(`MATCH(j:TutorIdentityCredential {tutorId:$tutorId}) SET j.revoked=true,j.status='revoked',j.revokedAt=$at`, { tutorId, at });
          await tx.run(`MATCH(s:InterviewSlot {tutorId:$tutorId,status:'booked'}) SET s.status='cancelled',s.mediaClosedAt=$at`, { tutorId, at });
          await notice(tx, `${id}:${action}`, tutorId, action === 'fraud'
            ? 'Your ID review is complete. Your tutor application has been declined and your account has been banned following an identity review finding. If you believe this is a mistake, contact tutor@fluentxverse.com. Do not send your ID by email.'
            : 'Your identity verification has been revoked. Contact tutor@fluentxverse.com for the next steps before proceeding. Do not send your ID by email.');
        }
        await tx.run(`CREATE(:TutorIdentityReview {id:$event,submissionId:$id,adminId:$adminId,action:$action,reason:$reason,at:$at})`,
          { event: crypto.randomUUID(), id, adminId, action, reason, at });
        return tutorId as string;
      });
    } finally { await s.close(); }
  }
  async maintenance(now = Date.now()) {
    const at = new Date(now).toISOString(), s = getDriver().session();
    try {
      const records = (await s.run(`MATCH(i:TutorIdentity) WHERE i.deletedAt IS NULL AND
        ((i.status='accepted' AND i.bookingDeadline <= $at) OR (i.status='booked' AND i.noShowAt <= $at AND i.noShowCheckedAt IS NULL))
        RETURN i ORDER BY i.createdAt LIMIT 100`, { at })).records;
      for (const row of records) {
        const item = row.get('i').properties;
        await s.executeWrite(async tx => {
          await lockApplicant(tx, item.tutorId, true);
          const i = (await tx.run('MATCH(i:TutorIdentity {id:$id}) RETURN i', { id: item.id })).records[0]?.get('i').properties;
          if (!i || i.deletedAt) return;
          if (i.status === 'accepted' && i.bookingDeadline <= at) {
            await tx.run(`MATCH(i:TutorIdentity {id:$id}) SET i.status='expired',i.deleteAt=$at,i.reason='Booking deadline expired'`, { id: i.id, at });
            await notice(tx, `${i.id}:expired`, i.tutorId, 'Your 84-hour interview booking window expired. Your ID image is being deleted. Please submit your ID again if you wish to continue.');
          }
          if (i.status === 'booked') {
            const slot = (await tx.run('MATCH(s:InterviewSlot {id:$id}) RETURN s', { id: i.interviewId })).records[0]?.get('s').properties;
            if (slot && !slot.tutorEnteredAt && interviewStart(slot.date, slot.time) + 30 * 60000 <= now) {
              await invalidateIdentity(tx, i.tutorId, 'Interview no-show. Please resubmit your ID.', now);
              await tx.run(`MATCH(s:InterviewSlot {id:$id,status:'booked'}) SET s.status='cancelled',s.mediaClosedAt=$at`, { id: slot.id, at });
            }
            await tx.run('MATCH(i:TutorIdentity {id:$id}) SET i.noShowCheckedAt=$at', { id: i.id, at });
          }
        });
      }
      const due = (await s.run(`MATCH(i:TutorIdentity) WHERE i.deletedAt IS NULL AND i.deleteAt <= $at RETURN i.id AS id LIMIT 100`, { at })).records;
      for (const row of due) {
        const id = row.get('id');
        await identityStorage.remove(id);
        await s.run(`MATCH(i:TutorIdentity {id:$id}) SET i.deletedAt=$at`, { id, at });
      }
      for (const id of await identityStorage.orphanCandidates(now)) {
        const exists = (await s.run('MATCH(i:TutorIdentity {id:$id}) RETURN i.id AS id', { id })).records.length;
        if (!exists) await identityStorage.remove(id);
      }
    } finally { await s.close(); }
  }
}
export const tutorIdentity = new TutorIdentityService();
