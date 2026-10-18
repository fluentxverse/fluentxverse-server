import { readFileSync, statSync } from 'node:fs';
import { ReviewTallySnapshotSource } from '../src/services/anonymousReviews/tallySnapshot';
import { parseTallyProof, tallyConfig, tallyJournal, tallyManifestHash, tallyStatement } from '../src/services/anonymousReviews/tallyPolicy';
import { validateReceipt } from '../src/services/anonymousReviews/chain';

// Read-only verifier. Trust pins come from the verifier's configuration, never from the downloaded artifact.
try {
  const file = process.argv[2];
  if (!file || statSync(file).size > 8 * 1024 * 1024) throw new Error('Provide a bounded public evidence JSON file');
  const evidence = JSON.parse(readFileSync(file, 'utf8')), config = tallyConfig();
  if (evidence.protocol !== 'fluentxverse.review-tally.v1' || evidence.imageId !== config.imageId) throw new Error('Unapproved program');
  const proof = parseTallyProof(evidence.proof);
  if (proof.vk !== config.imageId || tallyJournal(evidence.manifest, evidence.totals) !== evidence.journal
    || proof.publicSignals !== evidence.journal || tallyManifestHash(evidence.manifest) !== evidence.manifestHash
    || tallyStatement(config.imageId, evidence.journal) !== evidence.statement) throw new Error('Evidence binding differs');
  validateReceipt(evidence.receipt);
  const source = new ReviewTallySnapshotSource();
  await source.complete(evidence.cohort, evidence.manifest);
  if (!await source.receipt(evidence.statement, evidence.receipt)) throw new Error('Receipt is not verified');
  console.log(JSON.stringify({ verified: true, groupId: evidence.manifest.groupId, manifestHash: evidence.manifestHash,
    snapshotBlock: evidence.manifest.blockNumber, total: evidence.totals.total, imageId: config.imageId }));
} catch { console.error('Tally evidence verification failed; no proof or private data printed'); process.exitCode = 1; }
