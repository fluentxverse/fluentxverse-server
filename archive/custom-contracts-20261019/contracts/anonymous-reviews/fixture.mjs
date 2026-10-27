import { readFile } from 'node:fs/promises';
import { Group } from '@semaphore-protocol/group';
import { Identity } from '@semaphore-protocol/identity';
import { generateProof } from '@semaphore-protocol/proof';
import { keccak256, toHex } from 'viem';
import { reviewMessageJson, reviewScopeJson } from '../../fluentxverse-server/src/shared/anonymousReviews.ts';

// Deterministic private test keys only; never use these for real enrollments.
const identities = Array.from({ length: 5 }, (_, index) => new Identity(`anonymous-review-test-only-${index}`));
const group = new Group(identities.map(identity => identity.commitment.toString()).sort().map(BigInt));
const groupId = process.argv[3] || `0x${'b'.repeat(64)}`;
const contract = process.argv[2] || `0x${'1'.repeat(40)}`;
const content = { rating: 5, positive: ['feedback'], improvement: ['connection'], salt: 'ab'.repeat(32) };
const message = BigInt(keccak256(toHex(reviewMessageJson(groupId, content)))).toString();
const scope = (BigInt(keccak256(toHex(reviewScopeJson(2651420, contract, groupId)))) >> 8n).toString();
const assets = new URL('../../fluentxverse-student-solid-prototype/public/anonymous-reviews/', import.meta.url);
const wasm = new Uint8Array(await readFile(new URL('semaphore.wasm', assets))), zkey = new Uint8Array(await readFile(new URL('semaphore.zkey', assets)));
const proof = await generateProof(identities[0], group, message, scope, 8, { wasm, zkey });
const hash = value => (BigInt(keccak256(toHex(BigInt(value), { size: 32 }))) >> 8n).toString();
process.stdout.write(JSON.stringify({ groupId, contract, content, proof, members: group.members.map(String),
  signals: [proof.merkleTreeRoot, proof.nullifier, hash(proof.message), hash(proof.scope)],
  privateKey: identities[0].export() }), () => process.exit(0));
