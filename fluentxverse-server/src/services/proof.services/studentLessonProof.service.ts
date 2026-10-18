import { createHash, randomBytes } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildEddsa, buildPoseidon } from 'circomlibjs';
import { TransactionStatus } from 'zkverifyjs';
import { gmrEngine } from '../web3.services/gmrEngine.service';
import { getDriver } from '../../db/memgraph';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const circuitDir = join(root, 'circuits/student-lesson');
const buildDir = join(circuitDir, 'build');
const artifactsDir = join(root, 'zk-artifacts/student-lesson');
const circuitName = 'lesson_attendance';
const circuitPath = join(circuitDir, `${circuitName}.circom`);
const wasmPath = join(buildDir, `${circuitName}_js/${circuitName}.wasm`);
const witnessScript = join(buildDir, `${circuitName}_js/generate_witness.js`);
const r1csPath = join(buildDir, `${circuitName}.r1cs`);
const ptauPath = join(buildDir, 'pot14_final.ptau');
const zkeyPath = join(buildDir, `${circuitName}.zkey`);
const vkPath = join(buildDir, 'verification_key.json');
const exec = promisify(execFile);
const modulus = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
const credentialType = 'fluentxverse.student.lesson-attendance.v1';
const provingJobs = new Map<string, Promise<LessonProof>>();
let setupJob: Promise<void> | undefined;

export type LessonProofStatus = 'ready' | 'local_proof_generated' | 'submitted' | 'verified' | 'failed';
export interface LessonProof {
  bookingId: string;
  status: LessonProofStatus;
  eligible?: boolean;
  submissionAvailable?: boolean;
  commitment?: string;
  txHash?: string;
  aggregationId?: number;
  error?: string;
}

function field(value: string): string {
  return (BigInt(`0x${createHash('sha256').update(value).digest('hex')}`) % modulus).toString();
}

function issuerSecret(): string {
  const secret = process.env.STUDENT_LESSON_ISSUER_SECRET;
  if (secret && secret !== 'CHANGE_ME_STUDENT_LESSON_ISSUER_SECRET') return secret;
  if (process.env.NODE_ENV === 'production') throw new Error('STUDENT_LESSON_ISSUER_SECRET is required');
  return 'dev-only-student-lesson-issuer';
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function run(binary: string, args: string[]): Promise<void> {
  await exec(binary, args, { cwd: root, maxBuffer: 20 * 1024 * 1024 });
}

async function setup(): Promise<void> {
  if (await exists(vkPath) && await exists(wasmPath) && await exists(zkeyPath)) return;
  await mkdir(buildDir, { recursive: true });
  if (!(await exists(wasmPath))) {
    await run('circom', [circuitPath, '--r1cs', '--wasm', '-o', buildDir,
      '-l', join(root, 'node_modules'), '-l', join(root, '../node_modules'),
      '-l', join(root, 'node_modules/circomlib/circuits'), '-l', join(root, '../node_modules/circomlib/circuits')]);
    await writeFile(join(buildDir, `${circuitName}_js/package.json`), '{"type":"commonjs"}\n');
  }
  if (!(await exists(ptauPath))) {
    const initial = join(buildDir, 'pot14_0000.ptau');
    const contributed = join(buildDir, 'pot14_0001.ptau');
    if (!(await exists(initial))) await run('snarkjs', ['powersoftau', 'new', 'bn128', '14', initial]);
    if (!(await exists(contributed))) await run('snarkjs', ['powersoftau', 'contribute', initial, contributed,
      '--name=FluentXVerse student lesson local setup', `-e=${randomBytes(32).toString('hex')}`]);
    await run('snarkjs', ['powersoftau', 'prepare', 'phase2', contributed, ptauPath]);
  }
  await run('snarkjs', ['groth16', 'setup', r1csPath, ptauPath, zkeyPath]);
  await run('snarkjs', ['zkey', 'export', 'verificationkey', zkeyPath, vkPath]);
}

async function ensureSetup(): Promise<void> {
  setupJob ??= setup().catch(error => { setupJob = undefined; throw error; });
  await setupJob;
}

function lessonEnd(booking: Record<string, any>, slot: Record<string, any>): number {
  const stored = booking.slotDateTime;
  let start = stored?.toStandardDate?.().getTime() ?? Date.parse(String(stored || ''));
  if (!Number.isFinite(start)) {
    const match = String(slot.slotTime || '').match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!match) return NaN;
    let hour = Number(match[1]) % 12;
    if (match[3]?.toUpperCase() === 'PM') hour += 12;
    if (!match[3]) hour = Number(match[1]);
    start = Date.parse(`${slot.slotDate}T${String(hour).padStart(2, '0')}:${match[2]}:00+08:00`);
  }
  const minutes = Number(booking.durationMinutes?.toNumber?.() ?? booking.durationMinutes ?? slot.durationMinutes?.toNumber?.() ?? slot.durationMinutes ?? 25);
  return start + minutes * 60_000;
}

async function loadBooking(studentId: string, bookingId: string) {
  const session = getDriver().session();
  try {
    const result = await session.run(
      `MATCH (b:Booking {bookingId: $bookingId})-[:BOOKED_BY]->(s:Student {id: $studentId})
       MATCH (b)-[:BOOKS]->(slot:TimeSlot)
       OPTIONAL MATCH (b)-[:HAS_LESSON_PROOF]->(p:StudentLessonProof)
       RETURN b, slot, p LIMIT 1`, { studentId, bookingId });
    const record = result.records[0];
    if (!record) throw new Error('Booking not found');
    return { booking: record.get('b').properties as Record<string, any>, slot: record.get('slot').properties as Record<string, any>,
      proof: record.get('p')?.properties as Record<string, any> | undefined };
  } finally { await session.close(); }
}

function eligible(booking: Record<string, any>, slot: Record<string, any>): boolean {
  return ['confirmed', 'completed'].includes(booking.status) && booking.attendanceStudent === 'present' &&
    Number.isFinite(lessonEnd(booking, slot)) && Date.now() >= lessonEnd(booking, slot);
}

export async function listStudentLessonProofs(studentId: string): Promise<LessonProof[]> {
  const session = getDriver().session();
  try {
    const result = await session.run(
      `MATCH (b:Booking)-[:BOOKED_BY]->(:Student {id: $studentId})
       MATCH (b)-[:BOOKS]->(slot:TimeSlot)
       OPTIONAL MATCH (b)-[:HAS_LESSON_PROOF]->(p:StudentLessonProof)
       RETURN b, slot, p ORDER BY slot.slotDate DESC LIMIT 100`, { studentId });
    return result.records.map(record => {
      const booking = record.get('b').properties;
      const proof = record.get('p')?.properties;
      return {
        bookingId: String(booking.bookingId),
        status: (proof?.status || 'ready') as LessonProofStatus,
        ...(proof?.commitment ? { commitment: String(proof.commitment) } : {}),
        ...(proof?.txHash ? { txHash: String(proof.txHash) } : {}),
        ...(proof?.aggregationId != null ? { aggregationId: Number(proof.aggregationId?.toNumber?.() ?? proof.aggregationId) } : {}),
        ...(proof?.status === 'failed' && proof?.lastError ? { error: String(proof.lastError) } : {}),
        eligible: eligible(booking, record.get('slot').properties),
        submissionAvailable: Boolean(process.env.ZKVERIFY_SEED_PHRASE) && process.env.ZKVERIFY_ENABLED !== 'false',
      };
    });
  } finally { await session.close(); }
}

export async function getPublicStudentLessonProof(commitment: string) {
  const session = getDriver().session();
  try {
    const result = await session.run(
      `MATCH (p:StudentLessonProof {commitment: $commitment}) RETURN p LIMIT 1`, { commitment });
    const p = result.records[0]?.get('p')?.properties;
    if (!p) return null;
    return { commitment: p.commitment, status: p.status, proofSystem: 'groth16',
      credentialType, issuerAx: p.issuerAx, issuerAy: p.issuerAy,
      localProofVerified: p.localProofVerified === true,
      txHash: p.txHash || null, aggregationId: p.aggregationId ?? null,
      statement: p.statement || null, domainId: p.domainId ?? null };
  } finally { await session.close(); }
}

async function persist(bookingId: string, changes: Record<string, unknown>): Promise<void> {
  const session = getDriver().session();
  try {
    const fields = ['status', 'commitment', 'issuerAx', 'issuerAy', 'localProofVerified',
      'lastError', 'txHash', 'aggregationId', 'statement', 'domainId'];
    const assignments = fields.filter(key => Object.hasOwn(changes, key)).map(key => `p.${key} = $changes.${key}`);
    await session.run(
      `MATCH (b:Booking {bookingId: $bookingId})
       MERGE (p:StudentLessonProof {bookingId: $bookingId})
       MERGE (b)-[:HAS_LESSON_PROOF]->(p)
       SET ${assignments.join(', ')}, p.updatedAt = $now`, { bookingId, changes, now: new Date().toISOString() });
  } finally { await session.close(); }
}

async function generate(studentId: string, bookingId: string): Promise<LessonProof> {
  const { booking, slot, proof: current } = await loadBooking(studentId, bookingId);
  if (!eligible(booking, slot)) throw new Error('Tutor-confirmed attendance and an ended lesson are required');
  if (current?.status === 'verified' || current?.status === 'submitted') {
    return { bookingId, status: current.status, commitment: current.commitment,
      txHash: current.txHash, aggregationId: current.aggregationId?.toNumber?.() ?? current.aggregationId };
  }

  const poseidon = await buildPoseidon();
  const eddsa = await buildEddsa();
  const F = poseidon.F;
  const secret = createHash('sha256').update(issuerSecret()).digest();
  const publicKey = eddsa.prv2pub(secret);
  const bookingHash = field(`student-lesson:booking:${bookingId}`);
  const studentHash = field(`student-lesson:student:${studentId}`);
  const nonce = field(`student-lesson:nonce:${issuerSecret()}:${bookingId}:${studentId}`);
  const commitment = F.toString(poseidon([studentHash, bookingHash, nonce]));
  const typeHash = field(credentialType);
  const message = poseidon([bookingHash, 1, 1, commitment]);
  const signature = eddsa.signPoseidon(secret, poseidon([message, typeHash]));
  const input = {
    bookingHash, studentHash, nonce, attended: '1', lessonEnded: '1',
    signatureR8x: F.toString(signature.R8[0]), signatureR8y: F.toString(signature.R8[1]),
    signatureS: signature.S.toString(), commitment, credentialType: typeHash,
    issuerAx: F.toString(publicKey[0]), issuerAy: F.toString(publicKey[1]),
  };
  const proofFolder = join(artifactsDir, createHash('sha256').update(bookingId).digest('hex'));
  await mkdir(proofFolder, { recursive: true });
  try {
    await ensureSetup();
    const inputPath = join(proofFolder, 'input.json');
    const witnessPath = join(proofFolder, 'witness.wtns');
    const proofPath = join(proofFolder, 'proof.json');
    const publicPath = join(proofFolder, 'public.json');
    await writeFile(inputPath, JSON.stringify(input));
    await run('node', [witnessScript, wasmPath, inputPath, witnessPath]);
    await run('snarkjs', ['groth16', 'prove', zkeyPath, witnessPath, proofPath, publicPath]);
    await run('snarkjs', ['groth16', 'verify', vkPath, publicPath, proofPath]);
    await persist(bookingId, { status: 'local_proof_generated', commitment,
      issuerAx: input.issuerAx, issuerAy: input.issuerAy, localProofVerified: true, lastError: null });

    if (!gmrEngine.configured() || process.env.ZKVERIFY_ENABLED === 'false') {
      return { bookingId, status: 'local_proof_generated', commitment, submissionAvailable: false };
    }
    const domainId = Number(process.env.ZKVERIFY_DOMAIN_ID || '0');
    if (!Number.isInteger(domainId) || domainId < 0) throw new Error('Invalid ZKVERIFY_DOMAIN_ID');
    const tx = await gmrEngine.submitProof({ vk: JSON.parse(await readFile(vkPath, 'utf8')),
      proof: JSON.parse(await readFile(proofPath, 'utf8')),
      publicSignals: JSON.parse(await readFile(publicPath, 'utf8')), domainId });
    const status = tx.status === TransactionStatus.Finalized ? 'verified' : 'submitted';
    await persist(bookingId, { status, txHash: tx.txHash || null, aggregationId: tx.aggregationId ?? null,
      statement: tx.statement || null, domainId, lastError: null });
    return { bookingId, status, commitment, txHash: tx.txHash || undefined, aggregationId: tx.aggregationId };
  } catch (error) {
    await persist(bookingId, { status: 'failed', commitment, lastError: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export function claimStudentLessonProof(studentId: string, bookingId: string): Promise<LessonProof> {
  const key = `${studentId}:${bookingId}`;
  const pending = provingJobs.get(key);
  if (pending) return pending;
  const task = generate(studentId, bookingId).finally(() => provingJobs.delete(key));
  provingJobs.set(key, task);
  return task;
}
