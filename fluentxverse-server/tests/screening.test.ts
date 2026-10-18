import { describe, test, expect } from 'bun:test';
import { assertScreeningEvidence, decodeSubmittedAudio, transcribeBoundRecording } from '../src/services/screening/evidence';
import { assertCredentialCurrent, signScreeningCredential } from '../src/services/screening/credential';
import { canonicalJson, digest, policyHash, decodeScreeningSignals, publicSignalNames } from '../src/services/screening/policy';
import { screeningFixture } from './screening.fixture';

const binding = { chainId: 2651420, agentId: '12', adapterAddress: `0x${'1'.repeat(40)}` };
const seed = Buffer.alloc(32, 7); // Test-only issuer; never a deployed trust key.
const now = 1791676800;

describe('privately verifiable screening evidence', () => {
  test('accepts the exact policy boundary', () => expect(() => assertScreeningEvidence(screeningFixture())).not.toThrow());
  test('canonical policy hash does not depend on insertion order', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(policyHash).toMatch(/^\d+$/);
  });
  for (const score of [-1, 89, 101, 256, NaN, 90.5]) test(`rejects written score ${score}`, () => {
    const evidence = screeningFixture(); evidence.written.score = score;
    expect(() => assertScreeningEvidence(evidence)).toThrow();
  });
  test('does not trust cached pass flags or mismatched answer evidence', () => {
    const evidence = screeningFixture(); evidence.written.result.answers[0].selectedAnswer = 2;
    expect(() => assertScreeningEvidence(evidence)).toThrow('stored answers');
  });
  test('rejects another tutor, attempt, injected transcript and missing approvals', () => {
    const changes = [
      (e: any) => e.written.result.tutorId = 'someone-else',
      (e: any) => e.written.result.examId = 'different-attempt',
      (e: any) => e.speaking.result.taskScores[0].transcription = 'Client forged response',
      (e: any) => e.speaking.audioEvidence[0].source = 'client-transcription',
      (e: any) => e.profile.reviewerId = '',
      (e: any) => e.interview.passed = false,
    ];
    for (const change of changes) { const evidence = screeningFixture(); change(evidence); expect(() => assertScreeningEvidence(evidence)).toThrow(); }
  });
  test('transcribes actual bytes and binds transcript to the authenticated attempt', async () => {
    const bytes = Buffer.alloc(128, 42);
    const result = await transcribeBoundRecording('tutor', 'attempt', 3, `data:audio/webm;base64,${bytes.toString('base64')}`, async audio => {
      expect(audio).toEqual(bytes); return 'Server response';
    });
    expect(result.evidence.transcriptHash).toBe(digest('Server response'));
    expect(result.evidence.examId).toBe('attempt');
    expect(() => decodeSubmittedAudio('https://internal.example/audio')).toThrow();
    expect(() => decodeSubmittedAudio('data:audio/webm;base64,invalid')).toThrow();
  });
});

describe('screening credential bindings and lifecycle', () => {
  test('random commitments protect repeated evidence and public signals exclude scores/identity', async () => {
    const first = await signScreeningCredential(screeningFixture(), binding, seed, now);
    const second = await signScreeningCredential(screeningFixture(), binding, seed, now);
    expect(first.signals.credentialCommitment).not.toBe(second.signals.credentialCommitment);
    expect(first.signals.evidenceRoot).not.toBe(second.signals.evidenceRoot);
    expect(Object.keys(first.signals).sort()).toEqual([...publicSignalNames].sort());
    expect(JSON.stringify(first.signals)).not.toContain('screening-test-tutor');
    expect(assertCredentialCurrent(first.publicSignals, binding, first.signals.issuerHash, now)).toEqual(first.signals);
    expect(() => assertCredentialCurrent(first.publicSignals, binding, first.signals.issuerHash, Number(first.signals.expiresAt))).toThrow('lifetime');
    expect(() => assertCredentialCurrent(first.publicSignals, binding, first.signals.issuerHash, now - 1)).toThrow('lifetime');
    expect(() => assertCredentialCurrent(first.publicSignals, { ...binding, chainId: 84532 }, first.signals.issuerHash, now)).toThrow('destination');
    expect(() => assertCredentialCurrent(first.publicSignals, binding, '123', now)).toThrow('issuer');
    const tampered = [...first.publicSignals]; tampered[2] = '123';
    expect(() => decodeScreeningSignals(tampered)).toThrow('policy');
    expect(() => decodeScreeningSignals(['1'])).toThrow('count');
  }, 30000);
});
