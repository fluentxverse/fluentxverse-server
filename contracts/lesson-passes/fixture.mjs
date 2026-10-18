import { readFile } from 'node:fs/promises';
import { Identity } from '@semaphore-protocol/identity';
import { Group } from '@semaphore-protocol/group';
import { generateProof, verifyProof } from '@semaphore-protocol/proof';
import { passMessage, passScope } from '../../fluentxverse-server/src/shared/lessonPasses.ts';
import { keccak256, toHex } from 'viem';

// Deterministic synthetic keys, never valid for real purchases.
const identities = Array.from({ length: 8 }, (_, i) => new Identity(`lesson-pass-test-only-${i}`));
const group = new Group(identities.map(n => n.commitment).sort((a,b) => a < b ? -1 : 1));
const contract = process.argv[2] || `0x${'1'.repeat(40)}`;
const deadline = Number(process.argv[3]) || Math.floor(Date.now() / 1000) + 172800;
const assets = new URL('../../fluentxverse-student-solid-prototype/public/anonymous-reviews/', import.meta.url);
const wasm = new Uint8Array(await readFile(new URL('semaphore.wasm', assets))), zkey = new Uint8Array(await readFile(new URL('semaphore.zkey', assets)));
const scope = passScope(2651420, contract);
const authorization = { id: `0x${'a'.repeat(64)}`, root: group.root.toString(), refundCommitment: new Identity('lesson-pass-test-refund').commitment.toString(), deadline };
const proof = await generateProof(identities[0], group, passMessage(authorization), scope, 8, { wasm, zkey });
const secondAuthorization = { ...authorization, id: `0x${'b'.repeat(64)}` };
const secondProof = await generateProof(identities[0], group, passMessage(secondAuthorization), scope, 8, { wasm, zkey });
const otherProof = await generateProof(identities[1], group, passMessage(secondAuthorization), scope, 8, { wasm, zkey });
const singleGroup = new Group([identities[0].commitment]);
const singleProof = await generateProof(identities[0], singleGroup, passMessage({ ...secondAuthorization, root: singleGroup.root.toString() }), scope, 8, { wasm, zkey });
const hash = n => (BigInt(keccak256(toHex(BigInt(n), { size: 32 }))) >> 8n).toString();
const signals = p => [p.merkleTreeRoot,p.nullifier,hash(p.message),hash(p.scope)];
process.stdout.write(JSON.stringify({ contract, authorization, secondAuthorization, proof, secondProof, otherProof, singleProof, members: group.members.map(String),
  privateKey: identities[0].export(), signals: signals(proof), secondSignals: signals(secondProof), otherSignals: signals(otherProof), singleSignals: signals(singleProof),
  verified: await verifyProof(proof) && await verifyProof(secondProof) && await verifyProof(otherProof) && await verifyProof(singleProof),
  tamperedValid: await verifyProof({ ...proof, message: (BigInt(proof.message) + 1n).toString() }) }), () => process.exit(0));
