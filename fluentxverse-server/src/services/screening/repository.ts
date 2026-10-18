import { getDriver } from '../../db/memgraph';
import { createHash } from 'node:crypto';
import { adminCapabilities, plainNode } from '../../utils/adminOperations';
import { assertScreeningEvidence, type ScreeningEvidence } from './evidence';
import { loadPrivateAudio } from './storage';

export async function screeningQuery(query: string, params: Record<string, any> = {}) {
  const session = getDriver().session();
  try { return await session.run(query, params); } finally { await session.close(); }
}
let schemaReady: Promise<void> | undefined;
export function ensureScreeningSchema(): Promise<void> {
  return schemaReady ||= (async () => {
    for (const property of ['id', 'commitment']) {
      const exists = async () => (await screeningQuery('SHOW CONSTRAINT INFO')).records.some(record => record.get('constraint type') === 'unique'
        && record.get('label') === 'TutorScreeningCredential' && record.get('properties').length === 1 && record.get('properties')[0] === property);
      if (await exists()) continue;
      try { await screeningQuery(`CREATE CONSTRAINT ON (c:TutorScreeningCredential) ASSERT c.${property} IS UNIQUE`); }
      catch { if (!await exists()) throw new Error('Screening credential uniqueness constraint required'); }
    }
  })().catch(error => { schemaReady = undefined; throw error; });
}
const node = (record: any, key: string) => plainNode(record?.get(key)?.properties);
const json = (value: string | undefined) => value ? JSON.parse(value) : null;

export async function loadScreeningEvidence(tutorId: string): Promise<ScreeningEvidence> {
  const user = node((await screeningQuery('MATCH (u:User {id: $tutorId}) RETURN u', { tutorId })).records[0], 'u');
  if (!user || user.profileStatus !== 'approved') throw new Error('Approved tutor profile required');
  const profile = node((await screeningQuery('MATCH (p:ProfileScreeningDecision {id: $id, tutorId: $tutorId, status: \'approved\'}) RETURN p',
    { id: user.profileScreeningDecisionId || '', tutorId })).records[0], 'p');
  if (!profile || profile.reviewerId !== user.profileReviewedBy) throw new Error('Immutable authorized profile approval required');
  const exam = async (type: string) => node((await screeningQuery(
    "MATCH (:User {id: $tutorId})-[:TAKES]->(e:Exam {type: $type, status: 'completed'}) RETURN e ORDER BY e.completedAt DESC LIMIT 1", { tutorId, type })).records[0], 'e');
  const written = await exam('written');
  const speaking = await exam('speaking');
  const interview = node((await screeningQuery(
    "MATCH (s:InterviewSlot {tutorId: $tutorId, status: 'completed'}) RETURN s ORDER BY s.completedAt DESC LIMIT 1", { tutorId })).records[0], 's');
  if (!written || !speaking || !interview || interview.result !== 'pass') throw new Error('Completed screening attempts required');
  const reviewers = [user.profileReviewedBy, interview.reviewedBy];
  if (profile.itemStatuses) {
    const items = json(profile.itemStatuses);
    for (const item of Object.values(items) as any[]) {
      if (item.status !== 'approved' || !item.reviewedBy) throw new Error('Each profile item approval needs an authorized reviewer');
      reviewers.push(item.reviewedBy);
    }
  }
  for (const reviewerId of new Set(reviewers)) {
    if (!reviewerId) throw new Error('Screening approval lacks an authorized reviewer');
    const admin = node((await screeningQuery('MATCH (a:Admin {id: $reviewerId}) RETURN a', { reviewerId })).records[0], 'a');
    const permissions = admin && typeof admin.permissions === 'string' ? json(admin.permissions) : admin?.permissions;
    if (!admin || !['admin', 'superadmin'].includes(admin.role) || !adminCapabilities({ ...admin, permissions }).includes('operations')) throw new Error('Screening reviewer is not authorized');
  }
  const wr = json(written.result), sr = json(speaking.result);
  const evidence: ScreeningEvidence = {
    tutorId,
    written: { attemptId: written.id, tutorId, score: wr?.percentage, completedAt: written.completedAt, content: json(written.content), result: wr },
    speaking: { attemptId: speaking.id, tutorId, score: sr?.overallScore, completedAt: speaking.completedAt, content: json(speaking.content), result: sr, audioEvidence: json(speaking.screeningAudioEvidence) || [] },
    profile: { approved: true, reviewerId: profile.reviewerId, reviewedAt: String(profile.reviewedAt), record: profile },
    interview: { passed: true, reviewerId: interview.reviewedBy, completedAt: String(interview.completedAt), attemptId: interview.id,
      record: { result: interview.result, rubricScores: interview.rubricScores, notes: interview.notes, recordingUrl: interview.recordingUrl } },
  };
  assertScreeningEvidence(evidence);
  for (const audio of evidence.speaking.audioEvidence) {
    if (!audio.privateAudioRef) throw new Error('Authenticated private audio archive required');
    const bytes = await loadPrivateAudio(audio.privateAudioRef);
    if (createHash('sha256').update(bytes).digest('hex') !== audio.audioHash) throw new Error('Audio archive does not match signed screening evidence');
  }
  return evidence;
}

export interface StoredScreeningCredential {
  id: string;
  tutorId: string;
  commitment: string;
  publicSignals: string;
  encryptedEvidence: string;
  proof?: string;
  status: string;
  shared: boolean;
  revoked: boolean;
  issuedAt: string;
  expiresAt: string;
  zkVerifyTx?: string;
  receiptJson?: string;
}

export async function getScreeningCredential(commitment: string): Promise<StoredScreeningCredential | null> {
  const records = (await screeningQuery('MATCH (c:TutorScreeningCredential {commitment: $commitment}) RETURN c', { commitment })).records;
  return node(records[0], 'c') || null;
}
export async function getScreeningCredentialById(id: string): Promise<StoredScreeningCredential | null> {
  return node((await screeningQuery('MATCH (c:TutorScreeningCredential {id: $id}) RETURN c', { id })).records[0], 'c') || null;
}
export async function listScreeningCredentials(tutorId: string): Promise<StoredScreeningCredential[]> {
  return (await screeningQuery('MATCH (:User {id: $tutorId})-[:HAS_SCREENING_CREDENTIAL]->(c:TutorScreeningCredential) RETURN c ORDER BY c.issuedAt DESC LIMIT 20', { tutorId })).records.map(record => node(record, 'c'));
}
export async function screeningAudit(actor: string, action: string, commitment: string) {
  await screeningQuery('CREATE (:ScreeningAudit {actor: $actor, action: $action, commitment: $commitment, at: $at})', { actor, action, commitment, at: new Date().toISOString() });
}
