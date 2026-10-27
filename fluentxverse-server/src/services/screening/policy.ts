import { createHash } from 'node:crypto';

export const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const screeningPolicy = Object.freeze({
  id: 'fluentxverse.tutor-screening.v2',
  circuit: 'tutor-screening.v2',
  writtenThreshold: 90,
  speakingThreshold: 85,
  scoreRange: [0, 100],
  rubric: 'transcript-content.v2',
  writtenGrader: 'stored-answer-deterministic.v1',
  transcription: 'authenticated-audio-server-transcription.v1',
  assessmentConfiguration: { writtenAnswers: 'stored-attempt-content', speakingTasks: 'stored-attempt-content',
    writtenQuestionCount: 30, speakingTaskCount: 10,
    transcriptionModel: 'whisper-1', transcriptGraderModel: 'openai/gpt-4o', scoreAggregation: 'floor-mean-task-percentages',
    scoredDimensions: ['vocabulary', 'grammar', 'coherence', 'taskCompletion'], acousticAssessment: 'required-human-interview' },
  humanApprovals: ['profile', 'interview'],
  validitySeconds: 365 * 24 * 60 * 60,
  claim: 'Approved issuer screening results satisfy written >=90, speaking >=85, profile approval and interview pass.',
  limitations: ['Does not prove assessment accuracy, model execution, tutor identity liveness or audio-based pronunciation quality.'],
});

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}
export const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export const fieldHash = (value: unknown) => (BigInt(`0x${digest(value)}`) % FIELD_MODULUS).toString();
export const policyHash = fieldHash(screeningPolicy);
export const schemaHash = fieldHash('fluentxverse.screening-credential.v2');

export function validScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
}

export const publicSignalNames = [
  'valid', 'credentialCommitment', 'policyHash', 'schemaHash', 'issuerHash', 'issuerAx', 'issuerAy',
  'evidenceRoot', 'attemptHash', 'issuedAt', 'expiresAt', 'chainId', 'agentId', 'adapterAddress', 'subjectHash',
] as const;
export type ScreeningSignals = Record<typeof publicSignalNames[number], string>;

export function decodeScreeningSignals(values: unknown): ScreeningSignals {
  if (!Array.isArray(values) || values.length !== publicSignalNames.length) throw new Error('Invalid screening public signal count');
  for (const value of values) {
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || BigInt(value) >= FIELD_MODULUS) throw new Error('Invalid screening field element');
  }
  const signals = Object.fromEntries(publicSignalNames.map((name, i) => [name, values[i]])) as ScreeningSignals;
  if (signals.valid !== '1' || signals.policyHash !== policyHash || signals.schemaHash !== schemaHash) throw new Error('Unapproved screening policy/schema');
  return signals;
}
