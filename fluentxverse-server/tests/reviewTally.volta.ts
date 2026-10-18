import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { zkVerifySession } from 'zkverifyjs';
import { parseTallyProof, tallyStatement } from '../src/services/anonymousReviews/tallyPolicy';
import { tallyFixture } from './reviewTally.fixture';
import { validateReceipt } from '../src/services/anonymousReviews/chain';
import { isTallyReceiptPublication } from '../scripts/review-tally-release-policy';

// Read-only live test: validate the recorded synthetic transaction, never submit another proof.
// This archived fixture was issued under the legacy registry scope, not bridge-only.
process.env.PRIVACY_INFRA_MODE = 'legacy_contracts';
let close: (() => Promise<void>) | undefined;
try {
  const directory = new URL('../.deployment/review-tally/', import.meta.url);
  const state = JSON.parse(readFileSync(new URL('state.json', directory), 'utf8'));
  const config = parse(readFileSync(new URL('../config/anonymous-tally.env', import.meta.url), 'utf8'));
  assert.equal(state.synthetic, true);
  assert.equal(state.imageId, config.ANONYMOUS_REVIEW_TALLY_IMAGE_ID);
  const proof = parseTallyProof(JSON.parse(readFileSync(new URL('smoke-proof.json', directory), 'utf8')));
  assert.equal(createHash('sha256').update(JSON.stringify(proof)).digest('hex'), state.proofSha256);
  assert.equal(proof.vk, state.imageId);
  assert.equal(proof.publicSignals, tallyFixture().journal);
  assert.equal(tallyStatement(proof.vk, proof.publicSignals), state.statement);
  assert.ok(state.submission?.txHash && state.submission.blockHash);

  const connection = await zkVerifySession.start().Volta().readOnly();
  close = () => connection.close();
  const api = connection.api as any;
  const header = await api.rpc.chain.getHeader(state.submission.blockHash);
  const finalized = await api.rpc.chain.getHeader(await api.rpc.chain.getFinalizedHead());
  assert.ok(finalized.number.toBigInt() >= header.number.toBigInt());
  assert.equal((await api.rpc.chain.getBlockHash(header.number)).toHex(), state.submission.blockHash);
  const block = await api.rpc.chain.getBlock(state.submission.blockHash);
  const index = block.block.extrinsics.findIndex((item: any) => item.hash.toHex() === state.submission.txHash);
  assert.ok(index >= 0);
  const method = block.block.extrinsics[index].method;
  assert.equal(method.section, 'settlementRisc0Pallet'); assert.equal(method.method, 'submitProof');
  const [vk, encoded, journal, domain] = method.args.map((item: any) => item.toJSON());
  const vkEntries = Object.entries(vk), proofEntries = Object.entries(encoded);
  assert.equal(vkEntries.length, 1); assert.equal(method.args[0].type, 'Vk'); assert.equal(vkEntries[0]?.[1], proof.vk);
  assert.equal(proofEntries.length, 1); assert.equal(method.args[1].type, 'V2_3'); assert.equal(proofEntries[0]?.[1], proof.proof);
  assert.equal(journal, proof.publicSignals); assert.equal(domain, 175);

  const all = await api.query.system.events.at(state.submission.blockHash);
  const events = all.filter((item: any) => item.phase.isApplyExtrinsic && item.phase.asApplyExtrinsic.toNumber() === index)
    .map((item: any) => item.event);
  assert.ok(events.some((event: any) => event.section === 'system' && event.method === 'ExtrinsicSuccess'));
  assert.ok(!events.some((event: any) => event.section === 'system' && event.method === 'ExtrinsicFailed'));
  assert.ok(events.some((event: any) => event.section === 'settlementRisc0Pallet' && event.method === 'ProofVerified'
    && event.data[0].toString() === state.statement));
  assert.ok(events.some((event: any) => event.section === 'aggregate' && event.method === 'NewProof'
    && event.data[0].toString() === state.statement && event.data[1].toString() === '175'
    && event.data[2].toString() === String(state.submission.aggregationId)));
  const payment = events.find((event: any) => event.section === 'transactionPayment' && event.method === 'TransactionFeePaid');
  assert.ok(payment);
  let publication: { blockNumber: number; blockHash: string; root: string } | null = null;
  if (state.receiptBlockHash) {
    const publishedHeader = await api.rpc.chain.getHeader(state.receiptBlockHash);
    assert.ok(finalized.number.toBigInt() >= publishedHeader.number.toBigInt());
    assert.equal((await api.rpc.chain.getBlockHash(publishedHeader.number)).toHex(), state.receiptBlockHash);
    const publishedEvents = await api.query.system.events.at(state.receiptBlockHash);
    const published = publishedEvents.find((item: any) => isTallyReceiptPublication(item.event, state.submission.aggregationId));
    assert.ok(published);
    const path = await connection.getAggregateStatementPath(state.receiptBlockHash, 175, state.submission.aggregationId, state.statement);
    assert.equal(path.leaf, state.statement); assert.equal(path.root, published.event.data[2].toString());
    validateReceipt(state.receipt);
    assert.equal(state.receipt.aggregationId, String(state.submission.aggregationId));
    assert.equal(state.receipt.leafCount, String(path.numberOfLeaves)); assert.equal(state.receipt.index, String(path.leafIndex));
    assert.deepEqual(state.receipt.merklePath, path.proof);
    publication = { blockNumber: publishedHeader.number.toNumber(), blockHash: state.receiptBlockHash, root: path.root };
  }
  const report = { passed: true, synthetic: true, readOnlyChainTest: true, network: 'Volta', version: 'V2_3',
    txHash: state.submission.txHash, blockHash: state.submission.blockHash, blockNumber: header.number.toNumber(), extrinsicIndex: index,
    finalizedHeadAtCheck: finalized.number.toNumber(), imageId: proof.vk, statement: state.statement, domainId: 175,
    aggregationId: state.submission.aggregationId, journalBytes: (proof.publicSignals.length - 2) / 2, proofBytes: (proof.proof.length - 2) / 2,
    actualFeeBaseUnits: payment.data[1].toString(), aggregationPublication: publication, checkedAt: new Date().toISOString() };
  writeFileSync(new URL('volta-verification.json', directory), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
} catch {
  console.error('Recorded synthetic Volta transaction verification failed; no credentials or proof payload printed');
  process.exitCode = 1;
} finally {
  if (close) await close();
}
process.exit(process.exitCode || 0);
