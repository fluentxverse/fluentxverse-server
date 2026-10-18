import { parseTallyProof, tallyJournal, tallyManifestHash, tallyStatement } from '../src/services/anonymousReviews/tallyPolicy';
import { validateReceipt } from '../src/services/anonymousReviews/chain';

export function validateTallyReleaseEvidence(evidence: any, imageId: string) {
  if (evidence?.protocol !== 'fluentxverse.review-tally.v1' || evidence.imageId !== imageId
    || evidence.cohort?.id !== evidence.manifest?.groupId
    || evidence.manifestHash !== tallyManifestHash(evidence.manifest)
    || evidence.journal !== tallyJournal(evidence.manifest, evidence.totals)
    || evidence.statement !== tallyStatement(imageId as `0x${string}`, evidence.journal))
    throw new Error('Completed cohort evidence differs');
  const proof = parseTallyProof(evidence.proof);
  if (proof.vk !== imageId || proof.publicSignals !== evidence.journal) throw new Error('Completed cohort proof differs');
  validateReceipt(evidence.receipt);
  return proof;
}

export function isTallyReceiptPublication(event: any, aggregationId: number) {
  return event.section === 'aggregate' && event.method === 'NewAggregationReceipt'
    && event.data[0].toString() === '175' && event.data[1].toString() === String(aggregationId);
}
