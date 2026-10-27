import { readFile } from 'node:fs/promises';
import { Group } from '@semaphore-protocol/group';
import { Identity } from '@semaphore-protocol/identity';
import { generateProof } from '@semaphore-protocol/proof';
import { keccak256, toHex } from 'viem';
import { reviewMessageJson, reviewScopeJson } from '../../src/shared/anonymousReviews.ts';

const identities = Array.from({ length: 5 }, (_, i) => new Identity(`bridge-review-test-only-${i}`));
const group = new Group(identities.map(identity => identity.commitment.toString()).sort().map(BigInt));
const groupId = `0x${'b'.repeat(64)}`;
const bridge = '0x3098A6974649478f0133046e44105AA84e868C21';
const content = { rating: 5, positive: ['feedback'], improvement: ['connection'], salt: 'ab'.repeat(32) };
const message = BigInt(keccak256(toHex(reviewMessageJson(groupId, content)))).toString();
const scope = (BigInt(keccak256(toHex(reviewScopeJson(2651420, bridge, groupId)))) >> 8n).toString();
const assets = new URL('../../../fluentxverse-student-solid-prototype/public/anonymous-reviews/', import.meta.url);
const wasm = new Uint8Array(await readFile(new URL('semaphore.wasm', assets)));
const zkey = new Uint8Array(await readFile(new URL('semaphore.zkey', assets)));
const proof = await generateProof(identities[0], group, message, scope, 8, { wasm, zkey });
const hash = value => (BigInt(keccak256(toHex(BigInt(value), { size: 32 }))) >> 8n).toString();
process.stdout.write(JSON.stringify({ groupId, content, proof, members: group.members.map(String),
  signals: [proof.merkleTreeRoot, proof.nullifier, hash(proof.message), hash(proof.scope)] }), () => process.exit(0));
