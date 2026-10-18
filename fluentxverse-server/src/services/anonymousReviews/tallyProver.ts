import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { AnonymousReviewError } from './policy';
import { tallyConfig, parseTallyProof, type TallyWitness, type TallyProof } from './tallyPolicy';

let active = false;
export class ReviewTallyProver {
  private async run(mode: 'metadata' | 'prove' | 'verify', input?: unknown): Promise<any> {
    const binary = process.env.ANONYMOUS_REVIEW_TALLY_PROVER || '';
    const pin = process.env.ANONYMOUS_REVIEW_TALLY_PROVER_SHA256 || '';
    const url = process.env.ANONYMOUS_REVIEW_TALLY_PROVER_URL || '';
    if (url) {
      const token = process.env.ANONYMOUS_REVIEW_TALLY_PROVER_TOKEN || '';
      if (!/^http:\/\/(review-tally-prover|127\.0\.0\.1|localhost):8092$/.test(url) || !/^[a-f0-9]{64}$/.test(token)
        || !/^[a-f0-9]{64}$/.test(pin)) throw new AnonymousReviewError('Private local tally prover is not configured', 503);
      const response = await fetch(`${url}/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tally-Prover-Key': token },
        body: input === undefined ? '{}' : JSON.stringify(input), signal: AbortSignal.timeout(mode === 'prove' ? 1_800_000 : 60_000) });
      if (!response.ok) throw new AnonymousReviewError('Private tally prover operation failed', 503);
      const result = await response.json() as any;
      if (mode === 'metadata' && result.binarySha256 !== pin) throw new AnonymousReviewError('Unapproved local tally prover binary', 503);
      return result;
    }
    if (!binary.startsWith('/') || !/^[a-f0-9]{64}$/.test(pin)
      || createHash('sha256').update(readFileSync(binary)).digest('hex') !== pin)
      throw new AnonymousReviewError('Approved local tally prover is not installed', 503);
    return new Promise((resolve, reject) => {
      // No remote prover, development receipt, private argv, inherited application secrets, or witness diagnostics.
      const child = execFile(binary, [mode], { timeout: mode === 'prove' ? 1_800_000 : 60_000, maxBuffer: 8 * 1024 * 1024,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, RISC0_DEV_MODE: '0', RAYON_NUM_THREADS: '2' } }, (error, stdout) => {
        if (error) reject(new AnonymousReviewError('Local tally proof operation failed', 503));
        else { try { resolve(JSON.parse(stdout)); } catch { reject(new AnonymousReviewError('Invalid local tally proof result', 503)); } }
      });
      child.stdin?.on('error', () => {}); child.stdin?.end(input === undefined ? '' : JSON.stringify(input));
    });
  }
  async check() {
    const config = tallyConfig(), metadata = await this.run('metadata');
    if (metadata.imageId !== config.imageId || metadata.version !== 'V2_3') throw new AnonymousReviewError('Unapproved tally program', 503);
    return config;
  }
  async prove(witness: TallyWitness): Promise<TallyProof> {
    if (witness.snapshot.accepted.length > tallyConfig().maxReviews) throw new AnonymousReviewError('Full tally exceeds the configured local prover capacity', 409);
    if (active) throw new AnonymousReviewError('Tally prover is busy', 503);
    active = true;
    try {
      const config = await this.check(), proof = parseTallyProof(await this.run('prove', witness));
      if (proof.vk !== config.imageId)
        throw new AnonymousReviewError('Invalid tally proof envelope', 503);
      await this.verify(proof); return proof;
    } finally { active = false; }
  }
  async verify(proof: TallyProof) {
    proof = parseTallyProof(proof);
    const config = await this.check();
    if (proof.vk !== config.imageId || proof.proofSystem !== 'risc0' || proof.version !== 'V2_3'
      || !/^0x[a-f0-9]+$/.test(proof.proof || '') || proof.proof.length > 3 * 1024 * 1024
      || !/^0x[a-f0-9]{1984}$/.test(proof.publicSignals || '')) throw new AnonymousReviewError('Unapproved tally proof', 409);
    if ((await this.run('verify', proof)).verified !== true) throw new AnonymousReviewError('Tally proof verification failed', 409);
  }
}
