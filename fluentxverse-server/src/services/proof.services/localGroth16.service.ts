import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { getDriver } from '../../db/memgraph';
import {
  buildTutorCertificationCircuitInput,
  maybeIssueTutorCertificationProof,
} from './tutorCertificationProof.service';

const execFileAsync = promisify(execFile);
const serviceDir = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(serviceDir, '../../..');
const circuitDir = join(serverRoot, 'circuits/tutor-certification');
const circuitFile = join(circuitDir, 'tutor_certification.circom');
const buildDir = join(circuitDir, 'build');
const artifactsRoot = join(serverRoot, 'zk-artifacts/tutor-certification');
const hostWorkspaceNodeModules = join(serverRoot, '../node_modules');
const localNodeModules = join(serverRoot, 'node_modules');
const hostCircomlibCircuits = join(hostWorkspaceNodeModules, 'circomlib/circuits');
const localCircomlibCircuits = join(localNodeModules, 'circomlib/circuits');

const circuitName = 'tutor_certification';
const powersOfTauSize = '14';
const r1csPath = join(buildDir, `${circuitName}.r1cs`);
const wasmPath = join(buildDir, `${circuitName}_js/${circuitName}.wasm`);
const witnessGeneratorPath = join(buildDir, `${circuitName}_js/generate_witness.js`);
const witnessPackageJsonPath = join(buildDir, `${circuitName}_js/package.json`);
const potInitialPath = join(buildDir, `pot${powersOfTauSize}_0000.ptau`);
const potContributedPath = join(buildDir, `pot${powersOfTauSize}_0001.ptau`);
const potPreparedPath = join(buildDir, `pot${powersOfTauSize}_final.ptau`);
const zkeyPath = join(buildDir, `${circuitName}.zkey`);
const verificationKeyPath = join(buildDir, 'verification_key.json');

interface CommandResult {
  command: string;
  stdout: string;
  stderr: string;
}

export interface LocalGroth16ProofResult {
  credentialId: string;
  artifactDir: string;
  inputPath: string;
  witnessPath: string;
  proofPath: string;
  publicPath: string;
  verificationKeyPath: string;
  proofHash: string;
  publicHash: string;
  verificationKeyHash: string;
  verified: boolean;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureExecutable(binary: string): Promise<void> {
  try {
    await execFileAsync(binary, ['--version']);
  } catch (error: any) {
    const output = `${error?.stdout || ''}\n${error?.stderr || ''}`;
    if (binary === 'snarkjs' && output.includes('snarkjs@')) {
      return;
    }

    throw new Error(`Missing local proving binary "${binary}". Install ${binary} and retry local tutor certification proof generation.`);
  }
}

async function runCommand(binary: string, args: string[], cwd = serverRoot): Promise<CommandResult> {
  const { stdout, stderr } = await execFileAsync(binary, args, {
    cwd,
    maxBuffer: 1024 * 1024 * 20,
  });

  return {
    command: `${binary} ${args.join(' ')}`,
    stdout,
    stderr,
  };
}

async function hashFile(path: string): Promise<string> {
  const file = await readFile(path);
  return `sha256:${createHash('sha256').update(file).digest('hex')}`;
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

async function ensureCompiledCircuit(): Promise<void> {
  await mkdir(buildDir, { recursive: true });

  if (await pathExists(r1csPath) && await pathExists(wasmPath) && await pathExists(witnessGeneratorPath)) {
    return;
  }

  await runCommand('circom', [
    circuitFile,
    '--r1cs',
    '--wasm',
    '--sym',
    '-o',
    buildDir,
    '-l',
    localNodeModules,
    '-l',
    hostWorkspaceNodeModules,
    '-l',
    localCircomlibCircuits,
    '-l',
    hostCircomlibCircuits,
  ]);
  await writeFile(witnessPackageJsonPath, JSON.stringify({ type: 'commonjs' }, null, 2));
}

async function ensureGroth16Setup(): Promise<void> {
  if (await pathExists(zkeyPath) && await pathExists(verificationKeyPath)) {
    return;
  }

  if (!(await pathExists(potPreparedPath))) {
    if (!(await pathExists(potInitialPath))) {
      await runCommand('snarkjs', ['powersoftau', 'new', 'bn128', powersOfTauSize, potInitialPath, '-v']);
    }

    if (!(await pathExists(potContributedPath))) {
      await runCommand('snarkjs', [
        'powersoftau',
        'contribute',
        potInitialPath,
        potContributedPath,
        '--name=FluentXverse local tutor certification setup',
        '-v',
        '-e=fluentxverse-local-dev-entropy',
      ]);
    }

    await runCommand('snarkjs', ['powersoftau', 'prepare', 'phase2', potContributedPath, potPreparedPath, '-v']);
  }

  await runCommand('snarkjs', ['groth16', 'setup', r1csPath, potPreparedPath, zkeyPath]);
  await runCommand('snarkjs', ['zkey', 'export', 'verificationkey', zkeyPath, verificationKeyPath]);
}

async function persistLocalProofResult(tutorId: string, result: LocalGroth16ProofResult): Promise<void> {
  const driver = getDriver();
  const session = driver.session();
  const now = new Date().toISOString();

  try {
    await session.run(
      `MATCH (u:User {id: $tutorId})-[:HAS_CERTIFICATION_CREDENTIAL]->(c:TutorCertificationCredential {id: $credentialId})
       SET c.status = 'local_proof_generated',
           c.localProofGeneratedAt = $now,
           c.localProofVerified = $verified,
           c.localProofArtifactDir = $artifactDir,
           c.localProofHash = $proofHash,
           c.localPublicSignalsHash = $publicHash,
           c.localVerificationKeyHash = $verificationKeyHash,
           c.localProofPath = $proofPath,
           c.localPublicPath = $publicPath,
           c.localVerificationKeyPath = $verificationKeyPathValue,
           c.updatedAt = $now,
           u.tutorCertificationProofStatus = 'local_proof_generated'
       RETURN c`,
      {
        tutorId,
        credentialId: result.credentialId,
        now,
        verified: result.verified,
        artifactDir: result.artifactDir,
        proofHash: result.proofHash,
        publicHash: result.publicHash,
        verificationKeyHash: result.verificationKeyHash,
        proofPath: result.proofPath,
        publicPath: result.publicPath,
        verificationKeyPathValue: result.verificationKeyPath,
      }
    );
  } finally {
    await session.close();
  }
}

export async function generateLocalTutorCertificationProof(tutorId: string): Promise<LocalGroth16ProofResult> {
  await ensureExecutable('circom');
  await ensureExecutable('snarkjs');
  await ensureExecutable('node');

  const { snapshot, credential } = await maybeIssueTutorCertificationProof(tutorId, 'local_groth16_generation');
  if (snapshot.missingRequirements.length > 0) {
    throw new Error(`Tutor certification requirements are incomplete: ${snapshot.missingRequirements.join(', ')}`);
  }

  if (!['ready_for_proving', 'local_proof_generated'].includes(credential.status)) {
    throw new Error(`Credential is not ready for local proving. Current status: ${credential.status}`);
  }

  await ensureCompiledCircuit();
  await ensureGroth16Setup();

  const artifactDir = join(artifactsRoot, safePathSegment(tutorId));
  await mkdir(artifactDir, { recursive: true });

  const inputPath = join(artifactDir, 'input.json');
  const witnessPath = join(artifactDir, 'witness.wtns');
  const proofPath = join(artifactDir, 'proof.json');
  const publicPath = join(artifactDir, 'public.json');
  const circuitInput = await buildTutorCertificationCircuitInput(snapshot, credential);

  await writeFile(inputPath, `${JSON.stringify(circuitInput, null, 2)}\n`);
  await runCommand('node', [witnessGeneratorPath, wasmPath, inputPath, witnessPath]);
  await runCommand('snarkjs', ['groth16', 'prove', zkeyPath, witnessPath, proofPath, publicPath]);
  await runCommand('snarkjs', ['groth16', 'verify', verificationKeyPath, publicPath, proofPath]);

  const result: LocalGroth16ProofResult = {
    credentialId: credential.id,
    artifactDir: relative(serverRoot, artifactDir),
    inputPath: relative(serverRoot, inputPath),
    witnessPath: relative(serverRoot, witnessPath),
    proofPath: relative(serverRoot, proofPath),
    publicPath: relative(serverRoot, publicPath),
    verificationKeyPath: relative(serverRoot, verificationKeyPath),
    proofHash: await hashFile(proofPath),
    publicHash: await hashFile(publicPath),
    verificationKeyHash: await hashFile(verificationKeyPath),
    verified: true,
  };

  await persistLocalProofResult(tutorId, result);
  return result;
}

export async function assertLocalProvingToolchain(): Promise<void> {
  await access(circuitFile, constants.R_OK);
  await ensureExecutable('circom');
  await ensureExecutable('snarkjs');
  await ensureExecutable('node');
}
