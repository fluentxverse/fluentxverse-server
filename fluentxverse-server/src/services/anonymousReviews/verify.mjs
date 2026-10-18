import { verifyProof } from '@semaphore-protocol/proof';
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 8192) process.exit(1);
}
let valid = false;
try { valid = await verifyProof(JSON.parse(input)); } catch { /* Invalid proofs are rejected without logging their contents. */ }
process.stdout.write(valid ? 'true\n' : 'false\n', () => process.exit(0));
