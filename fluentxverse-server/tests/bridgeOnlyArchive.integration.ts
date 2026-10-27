import assert from 'node:assert/strict';
import { Group } from '@semaphore-protocol/group';
import { initDriver, closeDriver, getDriver } from '../src/db/memgraph';
import { AnonymousReviewRepository } from '../src/services/anonymousReviews/repository';
import { AnonymousReviewChain } from '../src/services/anonymousReviews/chain';
import { AnonymousReviewService } from '../src/services/anonymousReviews/service';
import { reviewGroupId, reviewScope } from '../src/services/anonymousReviews/policy';
import { HORIZEN_TESTNET_BRIDGE } from '../src/services/proof.services/horizenReceipt';

// Store/lifecycle test only: chain receipts are explicitly mocked, never broadcast.
const uri = process.env.FXV_ARCHIVE_QA_URI || 'bolt://127.0.0.1:7714';
const endpoint = new URL(uri);
if (endpoint.hostname !== '127.0.0.1' || endpoint.port !== '7714') throw Error('Requires the disposable archive QA database on 127.0.0.1:7714');
Object.assign(process.env, { PRIVACY_INFRA_MODE: 'bridge_only', ANONYMOUS_REVIEWS_ENABLED: 'true',
  ANONYMOUS_REVIEWS_CHAIN_ID: '2651420', ANONYMOUS_REVIEWS_BRIDGE: HORIZEN_TESTNET_BRIDGE,
  ANONYMOUS_REVIEWS_DOMAIN_ID: '175', ANONYMOUS_REVIEWS_RPC_URL: 'http://127.0.0.1:1',
  ANONYMOUS_REVIEWS_ZKVERIFY_VK_HASH: `0x${'ab'.repeat(32)}`,
  ANONYMOUS_REVIEWS_WASM_SHA256: 'a'.repeat(64), ANONYMOUS_REVIEWS_ZKEY_SHA256: 'b'.repeat(64) });
await initDriver(uri, '', '', 10, 250);
const session = getDriver().session(), repo = new AnonymousReviewRepository(), chain = new AnonymousReviewChain();
const service = new AnonymousReviewService(repo, chain), groupId = reviewGroupId('synthetic-tutor', '2026-10');
const members = ['111', '222', '333', '444', '555'];
const cfg = { chainId: 2651420, contract: HORIZEN_TESTNET_BRIDGE, bridge: HORIZEN_TESTNET_BRIDGE,
  domainId: 175, infrastructure: 'bridge_only', network: 'Volta', vkHash: process.env.ANONYMOUS_REVIEWS_ZKVERIFY_VK_HASH,
  rpcUrl: 'http://127.0.0.1:1' } as any;
chain.check = async () => cfg;
let receiptAccepted = false;
chain.receipt = async () => receiptAccepted;
chain.accepted = async (_proof, receipt) => Boolean(receipt) && receiptAccepted;
const count = async (label: string) => Number((await session.run(`MATCH(n${label ? `:${label}` : ''}) RETURN count(n) AS n`)).records[0]!.get('n').toString());
let assertions = 0;
try {
  assert.equal(await count(''), 0, 'Requires an empty disposable database');
  const cohort = { id: groupId, tutorId: 'synthetic-tutor', period: '2026-10', chainId: 2651420,
    contract: HORIZEN_TESTNET_BRIDGE.toLowerCase(), scope: reviewScope(2651420, HORIZEN_TESTNET_BRIDGE, groupId),
    opensAt: new Date(Date.now() + 3600000).toISOString(), closesAt: new Date(Date.now() + 8 * 86400000).toISOString() };
  await repo.ready();
  await Promise.all(Array.from({ length: 12 }, () => repo.enroll(cohort, 'student-0-enrollment', 'synthetic-student-0', members[0]!)));
  assert.equal(await count('AnonymousReviewEnrollment'), 1); assertions++;
  await assert.rejects(repo.enroll(cohort, 'student-0-enrollment', 'synthetic-student-0', '999'), /cannot be replaced/); assertions++;
  for (let i = 1; i < members.length; i++) await repo.enroll(cohort, `student-${i}-enrollment`, `synthetic-student-${i}`, members[i]!);
  assert.equal(await repo.memberCount(groupId), 5); assertions++;
  cohort.opensAt = new Date(Date.now() - 60000).toISOString();
  cohort.closesAt = new Date(Date.now() + 3600000).toISOString();
  await session.run('MATCH(g:AnonymousReviewCohort {id:$id}) SET g.opensAt=$opens,g.closesAt=$closes', {
    id: groupId, opens: cohort.opensAt, closes: cohort.closesAt });
  assert.equal((await service.activate(groupId)).enforcement, 'application'); assertions++;
  const frozen = await repo.cohort(groupId);
  assert.equal(frozen!.root, new Group(members.map(BigInt).sort((a, b) => a < b ? -1 : 1)).root.toString()); assertions++;
  await assert.rejects(repo.enroll(cohort, 'late-enrollment', 'late-synthetic-student', '666'), /closed/); assertions++;
  const proof = { merkleTreeDepth: 8, merkleTreeRoot: frozen!.root, scope: frozen!.scope, nullifier: '42', message: '99', points: Array(8).fill('0') };
  const item = { id: 'synthetic-review', groupId, nullifier: '42', proofJson: JSON.stringify(proof), encryptedContent: 'synthetic-ciphertext', status: 'queued' };
  await Promise.all(Array.from({ length: 12 }, () => repo.saveSubmission(item)));
  assert.equal(await count('AnonymousReviewSubmission'), 1); assertions++;
  await assert.rejects(repo.saveSubmission({ ...item, proofJson: JSON.stringify({ ...proof, message: '100' }) }), /already been used/); assertions++;
  await repo.patch(item.id, { status: 'awaiting_horizen', zkVerifyTx: `0x${'c'.repeat(64)}` });
  const receipt = { aggregationId: '123', leafCount: '1', index: '0', merklePath: [] };
  await assert.rejects(service.certify(item.id, receipt), /not finalized/); assertions++;
  assert.equal((await repo.submission(item.id))!.status, 'awaiting_horizen'); assertions++;
  receiptAccepted = true;
  await Promise.all(Array.from({ length: 12 }, () => service.certify(item.id, receipt)));
  const accepted = (await repo.submission(item.id))!;
  assert.equal(accepted.status, 'verified'); assertions++;
  assert.ok(accepted.acceptedAt); assertions++;
  await service.certify(item.id, receipt);
  assert.equal((await repo.submission(item.id))!.acceptedAt, accepted.acceptedAt); assertions++;
  await assert.rejects(repo.acceptBridge(item.id, JSON.stringify({ ...receipt, aggregationId: '124' })), /immutable/); assertions++;
  assert.equal((await repo.submission(item.id))!.receiptJson, JSON.stringify(receipt)); assertions++;
  const legacy = { ...cohort, id: `0x${'d'.repeat(64)}`, contract: `0x${'1'.repeat(40)}` };
  await session.run('CREATE(g:AnonymousReviewCohort) SET g += $cohort', { cohort: legacy });
  await assert.rejects(service.activate(legacy.id), /archived/); assertions++;
  assert.equal((await repo.cohort(legacy.id))!.root, undefined); assertions++;
  console.log(JSON.stringify({ passed: true, assertions, concurrentRetries: 12, database: 'disposable:7714', receipts: 'mocked', chainTransactions: 0 }));
} finally {
  await session.close(); await closeDriver();
}
