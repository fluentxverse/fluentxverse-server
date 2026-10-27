import { readFileSync, mkdtempSync, chmodSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groth16 } from 'snarkjs';

let directory;
try {
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Witness too large');
    chunks.push(chunk);
  }
  const { input, expectedSignals } = JSON.parse(Buffer.concat(chunks).toString());
  directory = process.env.SCREENING_WORK_DIR || mkdtempSync(join(tmpdir(), 'fxv-screening-')); chmodSync(directory, 0o700);
  const witness = join(directory, 'input.json');
  writeFileSync(witness, JSON.stringify(input), { mode: 0o600 });
  const { proof, publicSignals } = await groth16.fullProve(JSON.parse(readFileSync(witness)), process.env.SCREENING_WASM_PATH, process.env.SCREENING_ZKEY_PATH);
  const vk = JSON.parse(readFileSync(process.env.SCREENING_VK_PATH));
  if (JSON.stringify(publicSignals) !== JSON.stringify(expectedSignals) || !await groth16.verify(vk, publicSignals, proof)) throw new Error('Invalid proof');
  process.stdout.write(JSON.stringify({ proof, publicSignals }));
} catch { process.exitCode = 1; }
finally { if (directory) rmSync(directory, { recursive: true, force: true }); }
process.exit(process.exitCode || 0);
