import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import Elysia from 'elysia';
import { initDriver, closeDriver } from '../src/db/memgraph';
import { screeningFixture } from './screening.fixture';
import { signScreeningCredential } from '../src/services/screening/credential';
import { fieldHash } from '../src/services/screening/policy';
import { loadScreeningEvidence, screeningQuery, getScreeningCredential } from '../src/services/screening/repository';
import { issueScreeningCredential, publicScreeningSummary, shareScreeningCredential } from '../src/services/screening/service';
import { gmrScreeningEngine } from '../src/services/web3.services/gmrScreeningEngine.service';
import { encodeValidationPayload, screeningChainConfig, screeningLeaf } from '../src/services/screening/chain';
import { keccak256 } from 'viem';
import { openPrivateEvidence, savePrivateAudio } from '../src/services/screening/storage';
import { gradeExam } from '../src/services/exam.services/exam.service';
import { gradeSpeakingExam } from '../src/services/exam.services/speaking.service';
import { InterviewService } from '../src/services/interview.services/interview.service';

// Deliberately cannot target the live application database.
await initDriver('bolt://127.0.0.1:7699', '', '');
process.env.SCREENING_ENABLED = 'true';
process.env.PRIVACY_INFRA_MODE = 'legacy_contracts';
process.env.SCREENING_ISSUER_KEY_HEX = '07'.repeat(32);
process.env.SCREENING_EVIDENCE_KEY_HEX = '12'.repeat(32);
process.env.SCREENING_CHAIN_ID = '2651420';
process.env.SCREENING_AGENT_ID = '12';
process.env.SCREENING_ZKVERIFY_DOMAIN_ID = '42';
process.env.SCREENING_ZKVERIFY_VK_HASH = `0x${'a'.repeat(64)}`;
for (const [name, digit] of Object.entries({ VALIDATOR_ADDRESS: '1', IDENTITY_REGISTRY: '2', VALIDATION_REGISTRY: '3', RECEIPT_BRIDGE: '4', SIGNER_ADDRESS: '5' })) process.env[`SCREENING_${name}`] = `0x${digit.repeat(40)}`;
let verified = false;
const signed = await signScreeningCredential(screeningFixture(), { chainId: 2651420, agentId: '12', adapterAddress: process.env.SCREENING_VALIDATOR_ADDRESS! }, Buffer.alloc(32, 7));
process.env.SCREENING_ISSUER_HASH = signed.signals.issuerHash;
const originalOperation = gmrScreeningEngine.operation;
let archive: string | null = null;
gmrScreeningEngine.operation = (async (action: string, input: { publicSignals?: string[] } = {}) => {
  if (action === 'check') return { checked: true, config: screeningChainConfig() };
  if (action === 'status') return { certified: verified,
    requestHash: keccak256(encodeValidationPayload(screeningChainConfig(), input.publicSignals!)),
    statement: screeningLeaf(screeningChainConfig().vkHash, input.publicSignals!) };
  throw new Error(`Unexpected test Engine action ${action}`);
}) as typeof gmrScreeningEngine.operation;
try {
  const fixture = screeningFixture();
  const audio = Buffer.alloc(128, 42);
  archive = await savePrivateAudio(audio);
  fixture.speaking.audioEvidence[0].audioHash = createHash('sha256').update(audio).digest('hex');
  fixture.speaking.audioEvidence[0].privateAudioRef = archive;
  await screeningQuery(`CREATE (u:User {id: $tutorId, profileStatus: 'approved', profileReviewedBy: 'authorized-admin', profileScreeningDecisionId: 'profile-test'})
    CREATE (:Admin {id: 'authorized-admin', role: 'superadmin'})
    CREATE (:ProfileScreeningDecision {id: 'profile-test', tutorId: $tutorId, reviewerId: 'authorized-admin', status: 'approved', reviewedAt: $at, bio: 'PRIVATE_BIO'})
    CREATE (u)-[:TAKES]->(:Exam {id: $writtenId, type: 'written', status: 'completed', content: $writtenContent, result: $writtenResult, completedAt: $at})
    CREATE (u)-[:TAKES]->(:Exam {id: $speakingId, type: 'speaking', status: 'completed', content: $speakingContent, result: $speakingResult, screeningAudioEvidence: $audio, completedAt: $at})
    CREATE (:InterviewSlot {id: 'interview-1', tutorId: $tutorId, status: 'completed', result: 'pass', reviewedBy: 'authorized-admin', completedAt: $at, notes: 'PRIVATE_INTERVIEW_NOTES'})`,
    { tutorId: fixture.tutorId, at: fixture.written.completedAt, writtenId: fixture.written.attemptId, speakingId: fixture.speaking.attemptId,
      writtenContent: JSON.stringify(fixture.written.content), writtenResult: JSON.stringify(fixture.written.result),
      speakingContent: JSON.stringify(fixture.speaking.content), speakingResult: JSON.stringify(fixture.speaking.result), audio: JSON.stringify(fixture.speaking.audioEvidence) });
  await loadScreeningEvidence(fixture.tutorId);
  assert.equal((await gradeExam(fixture.written.attemptId, fixture.tutorId, Array(10).fill(0))).percentage, 90);
  assert.equal((await gradeSpeakingExam(fixture.speaking.attemptId, fixture.tutorId, [])).overallScore, 85);
  await assert.rejects(gradeExam(fixture.written.attemptId, 'wrong-owner', []), /not found/);
  const interviewService = new InterviewService();
  const interviewInput = { slotId: 'interview-1', tutorId: fixture.tutorId, result: 'fail' as const,
    rubricScores: { grammar: 1, fluency: 1, pronunciation: 1, vocabulary: 1, professionalism: 1 }, notes: '', timestamps: [], adminId: 'authorized-admin' };
  await assert.rejects(interviewService.saveInterviewResult(interviewInput), /finalized/);
  await assert.rejects(interviewService.saveInterviewResult({ ...interviewInput, tutorId: 'wrong-owner' }), /owned/);
  const issued = await issueScreeningCredential(fixture.tutorId, 'authorized-admin');
  assert.equal((await issueScreeningCredential(fixture.tutorId, 'authorized-admin')).commitment, issued.commitment);
  assert.equal(await publicScreeningSummary(issued.commitment), null);
  const stored = (await getScreeningCredential(issued.commitment))!;
  assert(!stored.encryptedEvidence.includes('PRIVATE_INTERVIEW_NOTES'));
  assert(JSON.parse(openPrivateEvidence(stored.encryptedEvidence, stored.id).toString()).evidence.interview.record.notes === 'PRIVATE_INTERVIEW_NOTES');
  await assert.rejects(shareScreeningCredential('different-tutor', issued.commitment, true));
  await shareScreeningCredential(fixture.tutorId, issued.commitment, true);
  const pending = (await publicScreeningSummary(issued.commitment))!;
  assert.equal(pending.status, 'pending'); assert.equal(pending.certified, false);
  assert.equal(pending.subjectHash, fieldHash({ tutorId: fixture.tutorId }));
  assert(!JSON.stringify(pending).includes('PRIVATE_BIO')); assert(!JSON.stringify(pending).includes('PRIVATE_INTERVIEW_NOTES'));
  verified = true;
  assert.equal((await publicScreeningSummary(issued.commitment))!.status, 'verified');
  await screeningQuery('MATCH (c:TutorScreeningCredential {commitment: $commitment}) SET c.revoked = true', { commitment: issued.commitment });
  assert.equal((await publicScreeningSummary(issued.commitment))!.status, 'revoked');
  await assert.rejects(issueScreeningCredential(fixture.tutorId, 'authorized-admin'), /revoked/);
  await screeningQuery("MATCH (a:Admin {id: 'authorized-admin'}) SET a.permissions = ['support'], a.role = 'admin'");
  await assert.rejects(loadScreeningEvidence(fixture.tutorId), /authorized/);
  await screeningQuery("MATCH (a:Admin {id: 'authorized-admin'}) SET a.role = 'superadmin'");
  await screeningQuery("MATCH (e:Exam {type: 'speaking'}) SET e.screeningAudioEvidence = '[]'");
  await assert.rejects(loadScreeningEvidence(fixture.tutorId), /evidence/);
  console.log('Isolated Memgraph: owned evidence, issuance idempotency, encryption, opt-in privacy, subject binding, chain status and revocation passed. RPC receipt status simulated; no live blockchain claim.');
} finally {
  gmrScreeningEngine.operation = originalOperation; await closeDriver();
  if (archive) await unlink(resolve(process.env.SCREENING_EVIDENCE_DIR || 'private-screening-evidence', archive));
}
