import { verifyProof } from '@semaphore-protocol/proof';
import { writeSync } from 'node:fs';
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 8192) process.exit(1);
}
let valid = false;
try { valid = await verifyProof(JSON.parse(input)); } catch { /* Invalid proofs are rejected without logging their contents. */ }
writeSync(1, valid ? 'true\n' : 'false\n');
process.exit(0);
