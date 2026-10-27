import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import solc from 'solc';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, custom, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const mocks = `pragma solidity ^0.8.30;
contract Bridge {
 bytes32 public leaf; bool public accept; uint public domain; uint public aggregation;
 function configure(bytes32 l, bool a, uint d, uint g) external { leaf=l; accept=a; domain=d; aggregation=g; }
 function verifyProofAggregation(uint d,uint g,bytes32 l,bytes32[] calldata p,uint count,uint index) external view returns(bool) {
   return accept && d==domain && g==aggregation && l==leaf && p.length==0 && count==1 && index==0;
 }
}
contract Registry {
 struct Status {address validator;uint agent;uint8 response;bytes32 responseHash;string tag;uint updated;}
 mapping(bytes32=>Status) public statuses;
 function request(bytes32 h,address validator,uint agent) external {statuses[h]=Status(validator,agent,0,bytes32(0),"",0);}
 function getValidationStatus(bytes32 h) external view returns(address,uint,uint8,bytes32,string memory,uint) {
   Status memory s=statuses[h];return(s.validator,s.agent,s.response,s.responseHash,s.tag,s.updated);
 }
 function validationResponse(bytes32 h,uint8 r,string calldata,bytes32 rh,string calldata tag) external {
   require(msg.sender==statuses[h].validator);statuses[h].response=r;statuses[h].responseHash=rh;statuses[h].tag=tag;statuses[h].updated=block.timestamp;
 }
}`;
const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: {
  'Validator.sol': { content: readFileSync(new URL('./TutorScreeningValidator.sol', import.meta.url), 'utf8') },
  'Mocks.sol': { content: mocks },
}, settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
assert.equal(output.errors?.filter(error => error.severity === 'error').length || 0, 0, JSON.stringify(output.errors));
const provider = ganache.provider({ chain: { chainId: 2651420, hardfork: 'shanghai' }, logging: { quiet: true } });
const accounts = Object.values(provider.getInitialAccounts());
const account = privateKeyToAccount(accounts[0].secretKey), stranger = privateKeyToAccount(accounts[1].secretKey);
const client = createPublicClient({ transport: custom(provider) });
const wallet = createWalletClient({ account, transport: custom(provider) });
const artifact = (file, name) => output.contracts[file][name];
const deploy = async (file, name, args = []) => {
  const a = artifact(file, name);
  const receipt = await client.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: a.abi, bytecode: `0x${a.evm.bytecode.object}`, args }) });
  return { address: receipt.contractAddress, abi: a.abi };
};
const write = async (contract, functionName, args, who = account) => {
  const { request } = await client.simulateContract({ ...contract, functionName, args, account: who });
  return client.waitForTransactionReceipt({ hash: await wallet.writeContract(request) });
};
const read = (contract, functionName, args = []) => client.readContract({ ...contract, functionName, args });

test('validator binds actual v2 public signals, trust pins and receipt to the agent request', async () => {
  try {
    const bridge = await deploy('Mocks.sol', 'Bridge'), registry = await deploy('Mocks.sol', 'Registry');
    const exportFixture = adapter => JSON.parse(execFileSync('bun', ['run', 'tests/screening.export.ts', adapter, registry.address, bridge.address, account.address],
      { cwd: new URL('../../fluentxverse-server', import.meta.url), encoding: 'utf8' }));
    const initial = exportFixture('0x1111111111111111111111111111111111111111');
    const validator = await deploy('Validator.sol', 'TutorScreeningValidator', [account.address, bridge.address, registry.address, 42n, 12n, initial.vkHash,
      BigInt(initial.values[2]), BigInt(initial.values[3]), BigInt(initial.values[4])]);
    assert.equal(await read(validator, 'enabled'), false);
    await write(validator, 'setEnabled', [true]);
    const fixture = exportFixture(validator.address), values = fixture.values.map(BigInt);
    await provider.request({ method: 'evm_mine', params: [Number(values[9])] });
    const hash = await read(validator, 'requestHash', [values]);
    assert.equal(await read(validator, 'requestPayload', [values]), fixture.payload);
    assert.equal(hash, keccak256(fixture.payload));
    assert.equal(await read(validator, 'statementLeaf', [values]), fixture.leaf);
    assert.equal(await read(validator, 'isCertified', [values[1]]), false);
    await assert.rejects(write(validator, 'certify', [values, 7n, [], 1n, 0n]), /No matching agent request/);
    await write(registry, 'request', [hash, validator.address, 12n]);
    await write(bridge, 'configure', [fixture.leaf, false, 42n, 7n]);
    await assert.rejects(write(validator, 'certify', [values, 7n, [], 1n, 0n]), /Invalid zkVerify receipt/);
    assert.equal((await read(registry, 'getValidationStatus', [hash]))[2], 0);
    await write(bridge, 'configure', [fixture.leaf, true, 42n, 7n]);
    for (const index of [2, 3, 4, 11, 12, 13]) {
      const bad = [...values]; bad[index] += 1n;
      await assert.rejects(write(validator, 'certify', [bad, 7n, [], 1n, 0n]));
    }
    const future = [...values]; future[9] += 86400n; future[10] += 86400n;
    await assert.rejects(write(validator, 'certify', [future, 7n, [], 1n, 0n]), /lifetime/);
    const expired = [...values]; expired[9] -= 366n * 86400n; expired[10] -= 366n * 86400n;
    await assert.rejects(write(validator, 'certify', [expired, 7n, [], 1n, 0n]), /lifetime/);
    const noncanonical = [...values]; noncanonical[5] = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    await assert.rejects(read(validator, 'statementLeaf', [noncanonical]), /Noncanonical/);
    await assert.rejects(write(validator, 'certify', [values, 8n, [], 1n, 0n]), /receipt/);
    await assert.rejects(write(validator, 'certify', [values, 7n, [], 0n, 0n]), /aggregation path/);
    await write(validator, 'certify', [values, 7n, [], 1n, 0n]);
    assert.equal(await read(validator, 'isCertified', [values[1]]), true);
    const response = await read(registry, 'getValidationStatus', [hash]);
    assert.equal(response[2], 100); assert.equal(response[3], fixture.leaf); assert.equal(response[4], 'screening-credential-valid');
    await assert.rejects(write(validator, 'certify', [values, 7n, [], 1n, 0n]), /Already validated/);
    await assert.rejects(write(validator, 'revoke', [values[1]], stranger), /Governance only/);
    await write(validator, 'setEnabled', [false]);
    assert.equal(await read(validator, 'isCertified', [values[1]]), false);
    await write(validator, 'setEnabled', [true]);
    await provider.request({ method: 'evm_increaseTime', params: [366 * 86400] });
    await provider.request({ method: 'evm_mine', params: [] });
    assert.equal(await read(validator, 'isCertified', [values[1]]), false);
    await write(validator, 'revoke', [values[1]]);
    await write(validator, 'syncRevocation', [values[1]]);
    assert.equal((await read(registry, 'getValidationStatus', [hash]))[2], 0);
    assert.equal(await read(validator, 'isCertified', [values[1]]), false);
  } finally { await provider.disconnect(); }
});
