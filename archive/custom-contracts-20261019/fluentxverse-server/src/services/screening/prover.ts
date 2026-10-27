import { canonicalJson, decodeScreeningSignals } from './policy';
import { gmrScreeningEngine } from '../web3.services/gmrScreeningEngine.service';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { privacyInfrastructure } from '../proof.services/horizenReceipt';

export function approvedScreeningArtifacts() {
  if (process.env.SCREENING_ARTIFACTS_APPROVED !== 'true') throw new Error('Screening artifacts require explicit production approval');
  for (const kind of ['WASM', 'ZKEY', 'VK']) {
    const path = process.env[`SCREENING_${kind}_PATH`] || '', pin = process.env[`SCREENING_${kind}_SHA256`] || '';
    if (!path || /test-only/.test(path) || !/^[a-f0-9]{64}$/.test(pin)
      || createHash('sha256').update(readFileSync(path)).digest('hex') !== pin) throw new Error('Unapproved screening proving artifacts');
  }
}
let active = false;

export async function proveScreeningCredential(input: unknown, expectedSignals: string[]) {
  decodeScreeningSignals(expectedSignals);
  if (privacyInfrastructure() === 'bridge_only') {
    approvedScreeningArtifacts();
    if (active) throw new Error('Screening prover is busy');
    active = true;
    let directory: string | undefined;
    try {
      directory = mkdtempSync(join(tmpdir(), 'fxv-screening-')); chmodSync(directory, 0o700);
      const result = await new Promise<{ proof: unknown; publicSignals: string[] }>((resolve, reject) => {
        const child = execFile('node', [fileURLToPath(new URL('./prove.mjs', import.meta.url))], { timeout: 240_000, maxBuffer: 64_000,
          env: { PATH: process.env.PATH, SCREENING_WASM_PATH: process.env.SCREENING_WASM_PATH,
            SCREENING_ZKEY_PATH: process.env.SCREENING_ZKEY_PATH, SCREENING_VK_PATH: process.env.SCREENING_VK_PATH,
            SCREENING_WORK_DIR: directory } }, (error, stdout) => {
          if (error) reject(new Error('Approved screening prover unavailable'));
          else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Invalid screening prover result')); } }
        });
        child.stdin?.on('error', () => {}); child.stdin?.end(JSON.stringify({ input, expectedSignals }));
      });
      decodeScreeningSignals(result.publicSignals);
      if (canonicalJson(result.publicSignals) !== canonicalJson(expectedSignals)) throw new Error('Screening proof statement changed');
      return result.proof;
    } finally { if (directory) rmSync(directory, { recursive: true, force: true }); active = false; }
  }
  const result = await gmrScreeningEngine.operation<{ proof: unknown; publicSignals: string[] }>('prove', { input, publicSignals: expectedSignals });
  decodeScreeningSignals(result.publicSignals);
  if (canonicalJson(result.publicSignals) !== canonicalJson(expectedSignals)) throw new Error('Engine prover statement does not match issued credential');
  if (!result.proof || typeof result.proof !== 'object') throw new Error('Engine did not return a screening proof');
  return result.proof;
}
