import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import solc from 'solc';
import ganache from 'ganache';
import { concat, createPublicClient, createWalletClient, custom, keccak256, sha256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const mocks = `pragma solidity ^0.8.30; contract Bridge {
 bytes32 public leaf; bool public accept;
 function configure(bytes32 l,bool a) external {leaf=l;accept=a;}
 function verifyProofAggregation(uint d,uint g,bytes32 l,bytes32[] calldata p,uint count,uint index) external view returns(bool) {
 return accept && d==175 && g==7 && l==leaf && p.length==0 && count==1 && index==0; }
}`;
const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: {
  'Registry.sol': { content: readFileSync(new URL('./AnonymousReviewRegistry.sol', import.meta.url), 'utf8') },
  'Mocks.sol': { content: mocks },
}, settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
assert.equal(compiled.errors?.filter(error => error.severity === 'error').length || 0, 0, JSON.stringify(compiled.errors));
const provider = ganache.provider({ chain: { chainId: 2651420, hardfork: 'shanghai' }, logging: { quiet: true } });
const accounts = Object.values(provider.getInitialAccounts());
const account = privateKeyToAccount(accounts[0].secretKey), stranger = privateKeyToAccount(accounts[1].secretKey);
const client = createPublicClient({ transport: custom(provider) }), wallet = createWalletClient({ account, transport: custom(provider) });
const vkHash = `0x${'a'.repeat(64)}`;
const deploy = async (file, name, args = []) => {
  const a = compiled.contracts[file][name];
  const receipt = await client.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: a.abi, bytecode: `0x${a.evm.bytecode.object}`, args }) });
  return { address: receipt.contractAddress, abi: a.abi };
};
const read = (contract, functionName, args = []) => client.readContract({ ...contract, functionName, args });
const write = async (contract, functionName, args, who = account) => {
  const { request } = await client.simulateContract({ ...contract, functionName, args, account: who });
  return client.waitForTransactionReceipt({ hash: await wallet.writeContract(request) });
};

test('immutable cohort, exact Semaphore public inputs, receipt verification and nullifier consumption', async () => {
  try {
    const bridge = await deploy('Mocks.sol', 'Bridge');
    const registry = await deploy('Registry.sol', 'AnonymousReviewRegistry', [account.address, bridge.address, 175n, vkHash]);
    const fixture = JSON.parse(execFileSync('node', [new URL('./fixture.mjs', import.meta.url).pathname, registry.address], { encoding: 'utf8', timeout: 120_000 }));
    const signals = fixture.signals.map(BigInt);
    const leaf = keccak256(concat([keccak256(toHex('groth16')), vkHash, sha256(toHex('')), keccak256(concat(signals.map(value =>
      `0x${value.toString(16).padStart(64, '0').match(/../g).reverse().join('')}`)))]));
    assert.equal(await read(registry, 'statementLeaf', [signals]), leaf);
    const now = (await client.getBlock()).timestamp, closes = now + 7n * 86400n;
    await assert.rejects(write(registry, 'registerCohort', [signals[3], signals[0], now, closes, 5], stranger), /Governance only/);
    await assert.rejects(write(registry, 'registerCohort', [signals[3], signals[0], now, closes, 4]), /cohort size/);
    await assert.rejects(write(registry, 'registerCohort', [signals[3], signals[0], now, closes, 257]), /cohort size/);
    await write(registry, 'registerCohort', [signals[3], signals[0], now, closes, 5]);
    await assert.rejects(write(registry, 'registerCohort', [signals[3], signals[0] + 1n, now, closes, 5]), /Immutable cohort/);
    await assert.rejects(write(registry, 'acceptReview', [signals, 7n, [], 1n, 0n]), /Inactive cohort/);
    await assert.rejects(write(registry, 'setEnabled', [true], stranger), /Governance only/);
    await write(registry, 'setEnabled', [true]);
    await write(bridge, 'configure', [leaf, false]);
    await assert.rejects(write(registry, 'acceptReview', [signals, 7n, [], 1n, 0n]), /Invalid zkVerify receipt/);
    const key = await read(registry, 'reviewKey', [signals[3], signals[1]]);
    assert.equal(await read(registry, 'accepted', [key]), `0x${'0'.repeat(64)}`);
    await write(bridge, 'configure', [leaf, true]);
    for (const index of [0, 2, 3]) {
      const changed = [...signals]; changed[index] += 1n;
      await assert.rejects(write(registry, 'acceptReview', [changed, 7n, [], 1n, 0n]));
    }
    const field = [...signals]; field[2] = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    await assert.rejects(read(registry, 'statementLeaf', [field]), /Noncanonical field/);
    await assert.rejects(write(registry, 'acceptReview', [signals, 7n, [], 0n, 0n]), /Invalid claim/);
    await write(registry, 'acceptReview', [signals, 7n, [], 1n, 0n], stranger);
    assert.equal(await read(registry, 'accepted', [key]), leaf);
    await assert.rejects(write(registry, 'acceptReview', [signals, 7n, [], 1n, 0n]), /Already reviewed/);
    await provider.request({ method: 'evm_increaseTime', params: [8 * 86400] }); await provider.request({ method: 'evm_mine', params: [] });
    const next = [...signals]; next[1] += 1n;
    await assert.rejects(write(registry, 'acceptReview', [next, 7n, [], 1n, 0n]), /Review window closed/);
  } finally { await provider.disconnect(); }
});
