import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEddsa, buildPoseidon } from 'circomlibjs';

const build = join(import.meta.dir, 'build');
const circuit = 'lesson_attendance';
const modulus = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
const hash = (value: string) => (BigInt(`0x${createHash('sha256').update(value).digest('hex')}`) % modulus).toString();
const run = (binary: string, args: string[]) => execFileSync(binary, args, { stdio: 'pipe' });
const folder = mkdtempSync(join(tmpdir(), 'student-lesson-proof-'));

try {
  const poseidon = await buildPoseidon();
  const eddsa = await buildEddsa();
  const F = poseidon.F;
  const secret = createHash('sha256').update('fixture-only-secret').digest();
  const pub = eddsa.prv2pub(secret);
  const bookingHash = hash('student-lesson:booking:fixture-booking');
  const studentHash = hash('student-lesson:student:fixture-student');
  const nonce = hash('student-lesson:nonce:fixture-only-secret:fixture-booking:fixture-student');
  const commitment = F.toString(poseidon([studentHash, bookingHash, nonce]));
  const credentialType = hash('fluentxverse.student.lesson-attendance.v1');
  const signed = poseidon([poseidon([bookingHash, 1, 1, commitment]), credentialType]);
  const signature = eddsa.signPoseidon(secret, signed);
  const input = {
    bookingHash, studentHash, nonce, attended: '1', lessonEnded: '1', commitment, credentialType,
    signatureR8x: F.toString(signature.R8[0]), signatureR8y: F.toString(signature.R8[1]),
    signatureS: signature.S.toString(), issuerAx: F.toString(pub[0]), issuerAy: F.toString(pub[1]),
  };
  const inputPath = join(folder, 'input.json');
  const witnessPath = join(folder, 'witness.wtns');
  const script = join(build, `${circuit}_js/generate_witness.js`);
  const wasm = join(build, `${circuit}_js/${circuit}.wasm`);
  writeFileSync(inputPath, JSON.stringify(input));
  run('node', [script, wasm, inputPath, witnessPath]);
  for (const invalid of [{ ...input, attended: '0' }, { ...input, signatureS: '3' }]) {
    writeFileSync(inputPath, JSON.stringify(invalid));
    try {
      run('node', [script, wasm, inputPath, join(folder, 'invalid.wtns')]);
      throw new Error('Invalid witness unexpectedly succeeded');
    } catch (error) {
      if ((error as Error).message === 'Invalid witness unexpectedly succeeded') throw error;
    }
  }
  const zkey = join(build, `${circuit}.zkey`);
  if (process.argv.includes('--prove')) {
    const proofPath = join(folder, 'proof.json');
    const publicPath = join(folder, 'public.json');
    run('snarkjs', ['groth16', 'prove', zkey, witnessPath, proofPath, publicPath]);
    run('snarkjs', ['groth16', 'verify', join(build, 'verification_key.json'), publicPath, proofPath]);
    const publicSignals = JSON.parse(readFileSync(publicPath, 'utf8')) as string[];
    if (publicSignals[0] !== commitment) throw new Error('Public commitment mismatch');
  }
  console.log('Student lesson witness validated; invalid attendance and signature rejected');
} finally {
  rmSync(folder, { recursive: true, force: true });
}
