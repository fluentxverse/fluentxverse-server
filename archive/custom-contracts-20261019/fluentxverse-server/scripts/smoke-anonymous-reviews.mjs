import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Group } from '@semaphore-protocol/group';
import { Identity } from '@semaphore-protocol/identity';
import { generateProof } from '@semaphore-protocol/proof';
import { unpackGroth16Proof } from '@zk-kit/utils/proof-packing';
import { zkVerifySession } from 'zkverifyjs';
import { createPublicClient, http, keccak256, toHex, parseAbi, concat, sha256 } from 'viem';
import { reviewMessageJson, reviewScopeJson } from '../src/shared/anonymousReviews.ts';

// Synthetic release smoke test, never inserted as student feedback or usage metrics.
const root = new URL('../', import.meta.url);
const state = JSON.parse(readFileSync(new URL('.deployment/anonymous-reviews/state.json', root), 'utf8'));
const file = new URL('.deployment/anonymous-reviews/smoke.json', root);
let smoke;
try { smoke = JSON.parse(readFileSync(file, 'utf8')); } catch { smoke = { synthetic: true, version: 1, groupId: keccak256(toHex(`release-smoke:${randomUUID()}`)), operations: {} }; }
const save = () => writeFileSync(file, JSON.stringify(smoke, null, 2), { mode: 0o600 });
const apiURL = 'http://127.0.0.1:8090';
const client = createPublicClient({ transport: http('https://horizen-testnet.rpc.caldera.xyz/http', { timeout: 20_000, retryCount: 0 }) });
const abi = parseAbi([
  'function enabled() view returns (bool)',
  'function registerCohort(uint256 scopeHash, uint256 root, uint64 opensAt, uint64 closesAt, uint16 memberCount)',
  'function acceptReview(uint256[4] signals, uint256 aggregationId, bytes32[] merklePath, uint256 leafCount, uint256 index)',
  'function cohorts(uint256) view returns (uint256, uint64, uint64, uint16)',
  'function accepted(bytes32) view returns (bytes32)',
  'function reviewKey(uint256 scopeHash, uint256 nullifier) view returns (bytes32)',
]);
const hash = value => (BigInt(keccak256(toHex(BigInt(value), { size: 32 }))) >> 8n).toString();
const phase = process.argv[2] || 'prepare';
const apply = process.argv.includes('--apply');
async function api(path, body, timeout = 30_000) {
  const response = await fetch(`${apiURL}/v1/${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GMR-Engine-Key': state.apiKey }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const data = await response.json(); if (!response.ok) throw new Error(`Engine smoke ${path} returned HTTP ${response.status}`);
  return data;
}
async function write(name, functionName, args) {
  if (!apply) throw new Error('Smoke write requires --apply');
  if (!smoke.operations[name]) {
    smoke.operations[name] = { status: 'queuing' }; save();
    const result = await api('contracts/write', { abi, args: args.map(value => typeof value === 'object' ? JSON.stringify(value) : String(value)),
      chainId: 2651420, contractAddress: state.contract, functionName, value: '0', walletAddress: '' });
    smoke.operations[name] = { id: result.transaction.id, status: result.transaction.status }; save();
  }
  const operation = smoke.operations[name];
  if (!operation.id) throw new Error('Uncertain smoke transaction needs reconciliation');
  for (let attempt = 0; attempt < 30; attempt++) {
    const { transaction } = await api(`transactions/${operation.id}`);
    if (transaction.status === 'confirmed') {
      operation.status = 'confirmed'; operation.hash = transaction.transactionHash; save(); return;
    }
    if (transaction.status === 'failed') throw new Error('Smoke transaction failed; reconcile its recorded ID');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error('Smoke transaction still pending; rerun this phase to reconcile');
}

try {
  if (phase === 'prepare') {
    if (!smoke.proof) {
      const identities = Array.from({ length: 5 }, () => new Identity());
      const group = new Group(identities.map(identity => identity.commitment));
      const content = { rating: 5, positive: ['feedback'], improvement: [], salt: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '') };
      const scope = (BigInt(keccak256(toHex(reviewScopeJson(2651420, state.contract, smoke.groupId)))) >> 8n).toString();
      const message = BigInt(keccak256(toHex(reviewMessageJson(smoke.groupId, content)))).toString();
      const assets = new URL('../../fluentxverse-student-solid-prototype/public/anonymous-reviews/', import.meta.url);
      smoke.proof = await generateProof(identities[0], group, message, scope, 8, { wasm: new Uint8Array(readFileSync(new URL('semaphore.wasm', assets))), zkey: new Uint8Array(readFileSync(new URL('semaphore.zkey', assets))) });
      smoke.signals = [smoke.proof.merkleTreeRoot, smoke.proof.nullifier, hash(smoke.proof.message), hash(smoke.proof.scope)];
      smoke.opensAt = Math.floor(Date.now() / 1000) - 60; smoke.closesAt = smoke.opensAt + 7 * 86400;
      const encoded = smoke.signals.map(value => `0x${BigInt(value).toString(16).padStart(64, '0').match(/../g).reverse().join('')}`);
      smoke.statement = keccak256(concat([keccak256(toHex('groth16')), state.pins.nativeVk, sha256(toHex('')), keccak256(concat(encoded))]));
      save();
    }
    console.log(JSON.stringify({ synthetic: true, prepared: true, groupId: smoke.groupId, statement: smoke.statement }));
  } else if (phase === 'activate') {
    await write('activate', 'registerCohort', [smoke.signals[3], smoke.signals[0], smoke.opensAt, smoke.closesAt, 5]);
    console.log(JSON.stringify({ synthetic: true, activation: smoke.operations.activate }));
  } else if (phase === 'submit') {
    if (!apply) throw new Error('Smoke proof submission requires --apply');
    if (!smoke.submission) {
      if (smoke.submitting) throw new Error('Uncertain proof submission needs Engine reconciliation');
      smoke.submitting = true; save();
      const assets = new URL('../../fluentxverse-student-solid-prototype/public/anonymous-reviews/semaphore.vk.json', import.meta.url);
      const { submission } = await api('zkverify/proofs', { proof: unpackGroth16Proof(smoke.proof.points), publicSignals: smoke.signals,
        vk: JSON.parse(readFileSync(assets, 'utf8')), domainId: 175, curve: 'bn128', proofSystem: 'groth16', expectedNetwork: 'Volta' }, 300_000);
      const result = JSON.parse(submission.transactionResult);
      if (submission.zkVerifyNetwork !== 'Volta' || result.statement?.toLowerCase() !== smoke.statement.toLowerCase()) throw new Error('Smoke proof statement/network differs');
      smoke.submission = { id: submission.id, txHash: result.txHash, aggregationId: result.aggregationId, domainId: result.domainId, blockHash: result.blockHash }; save();
    }
    console.log(JSON.stringify({ synthetic: true, submission: smoke.submission }));
  } else if (phase === 'receipt') {
    const session = await zkVerifySession.start().Volta().readOnly();
    try {
      for (let attempt = 0; attempt < 60; attempt++) {
        if (!smoke.receiptBlockHash) {
          const head = await session.api.rpc.chain.getHeader(await session.api.rpc.chain.getFinalizedHead());
          const start = smoke.scanNext ?? (await session.api.rpc.chain.getHeader(smoke.submission.blockHash)).number.toNumber();
          // Receipt paths exist only at the publication block. Backfill finalized events so restarts cannot miss it.
          for (let height = start; height <= head.number.toNumber(); height++) {
            const blockHash = (await session.api.rpc.chain.getBlockHash(height)).toString();
            const events = await session.api.query.system.events.at(blockHash);
            if (events.some(({ event }) => event.section === 'aggregate' && event.method === 'NewAggregationReceipt'
              && event.data[0].toString() === '175' && event.data[1].toString() === String(smoke.submission.aggregationId))) {
              smoke.receiptBlockHash = blockHash; smoke.receiptBlockNumber = height; save(); break;
            }
            smoke.scanNext = height + 1;
          }
          save();
        }
        if (smoke.receiptBlockHash) {
          const path = await session.getAggregateStatementPath(smoke.receiptBlockHash, 175, smoke.submission.aggregationId, smoke.statement);
          if (path.leaf.toLowerCase() !== smoke.statement.toLowerCase()) throw new Error('Unexpected smoke receipt leaf');
          const bridgeABI = parseAbi(['function verifyProofAggregation(uint256, uint256, bytes32, bytes32[], uint256, uint256) view returns (bool)']);
          const valid = await client.readContract({ address: '0x3098A6974649478f0133046e44105AA84e868C21', abi: bridgeABI, functionName: 'verifyProofAggregation',
            args: [175n, BigInt(smoke.submission.aggregationId), smoke.statement, path.proof, BigInt(path.numberOfLeaves), BigInt(path.leafIndex)] });
          if (valid) { smoke.receipt = path; save(); break; }
        }
        await new Promise(resolve => setTimeout(resolve, 10_000));
      }
      if (!smoke.receipt) throw new Error('Receipt relay is pending; rerun receipt phase later');
      console.log(JSON.stringify({ synthetic: true, receiptAvailable: true, aggregationId: smoke.submission.aggregationId, leafCount: smoke.receipt.numberOfLeaves }));
    } finally { await session.close(); }
  } else if (phase === 'certify') {
    if (!smoke.receipt) throw new Error('Obtain the live bridge receipt first');
    await write('certify', 'acceptReview', [smoke.signals, smoke.submission.aggregationId, smoke.receipt.proof, smoke.receipt.numberOfLeaves, smoke.receipt.leafIndex]);
    console.log(JSON.stringify({ synthetic: true, certification: smoke.operations.certify }));
  } else if (phase === 'verify') {
    const key = await client.readContract({ address: state.contract, abi, functionName: 'reviewKey', args: [BigInt(smoke.signals[3]), BigInt(smoke.signals[1])] });
    const statement = await client.readContract({ address: state.contract, abi, functionName: 'accepted', args: [key], blockTag: 'finalized' });
    if (statement.toLowerCase() !== smoke.statement.toLowerCase()) throw new Error('Finalized smoke acceptance is not available yet');
    smoke.finalizedVerified = true; save();
    console.log(JSON.stringify({ synthetic: true, finalizedVerified: true, registry: state.contract, statement }));
  } else throw new Error('Unsupported smoke phase');
} catch (error) {
  console.error(/^(Engine smoke|Smoke |Uncertain |Unexpected |Receipt |Obtain |Finalized |Unsupported)/.test(error.message) ? error.message : 'Smoke test could not complete; inspect its private journal and services');
  process.exitCode = 1;
}
process.exit(process.exitCode || 0);
