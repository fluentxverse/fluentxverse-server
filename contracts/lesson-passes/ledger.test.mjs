import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { concat, createPublicClient, createWalletClient, custom, keccak256, sha256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
const require = createRequire(new URL('../anonymous-reviews/package.json', import.meta.url));
const solc = require('solc'), ganache = require('ganache');
const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: {
  'Ledger.sol': { content: readFileSync(new URL('./LessonPassLedger.sol', import.meta.url), 'utf8') },
  'Mock.sol': { content: `pragma solidity ^0.8.30; contract MockBridge {
    bytes32 public leaf; bool public accept; function configure(bytes32 l,bool a) external {leaf=l;accept=a;}
    function verifyProofAggregation(uint d,uint g,bytes32 l,bytes32[] calldata p,uint n,uint i) external view returns(bool) {
      return accept && d==175 && g==7 && l==leaf && p.length==0 && n==1 && i==0; } }` }
}, settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi','evm.bytecode.object'] } } } })));
assert.equal(compiled.errors?.filter(n => n.severity === 'error').length || 0, 0, JSON.stringify(compiled.errors));

test('real ownership proofs, receipt binding, permanent nullifiers and mutually exclusive settlement/refund', async () => {
  const provider = ganache.provider({ chain: { chainId: 2651420, hardfork: 'shanghai' }, logging: { quiet: true } });
  try {
    const accounts = Object.values(provider.getInitialAccounts());
    const owner = privateKeyToAccount(accounts[0].secretKey), stranger = privateKeyToAccount(accounts[1].secretKey);
    const client = createPublicClient({ transport: custom(provider) }), wallet = createWalletClient({ account: owner, transport: custom(provider) });
    const deploy = async (file, name, args = []) => { const artifact = compiled.contracts[file][name];
      const receipt = await client.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args }) });
      return { address: receipt.contractAddress, abi: artifact.abi }; };
    const read = (c, functionName, args = []) => client.readContract({ ...c, functionName, args });
    const write = async (c, functionName, args, account = owner) => {
      const { request } = await client.simulateContract({ ...c, functionName, args, account });
      return client.waitForTransactionReceipt({ hash: await wallet.writeContract(request) }); };
    const vkHash = '0x6cdfb2dc51747e922a72bad7aa81b21b67cb053774ee0ee6cbc4b173dddabb76';
    const bridge = await deploy('Mock.sol','MockBridge');
    const ledger = await deploy('Ledger.sol','LessonPassLedger',[owner.address,bridge.address,175n,vkHash]);
    const fixture = JSON.parse(execFileSync('node',[new URL('./fixture.mjs',import.meta.url).pathname,ledger.address],{ encoding:'utf8',timeout:180000 }));
    assert(fixture.verified); assert.equal(fixture.tamperedValid,false);
    assert.equal(fixture.proof.nullifier,fixture.secondProof.nullifier); assert.equal(fixture.proof.nullifier,fixture.singleProof.nullifier);
    assert.notEqual(fixture.proof.nullifier,fixture.otherProof.nullifier);
    const a = fixture.authorization, b = fixture.secondAuthorization, s = fixture.signals.map(BigInt), second = fixture.secondSignals.map(BigInt);
    const leaf = signals => keccak256(concat([keccak256(toHex('groth16')),vkHash,sha256(toHex('')),keccak256(concat(signals.map(n => `0x${n.toString(16).padStart(64,'0').match(/../g).reverse().join('')}`)))]));
    assert.equal(await read(ledger,'statementLeaf',[s]),leaf(s)); assert.equal(await read(ledger,'scopeHash'),s[3]);
    const batch = `0x${'c'.repeat(64)}`;
    await assert.rejects(write(ledger,'registerBatch',[batch,s[0],8],stranger),/Issuer only/);
    await write(ledger,'registerBatch',[batch,s[0],8]);
    await assert.rejects(write(ledger,'registerBatch',[batch,s[0]+1n,8]),/immutable batch/);
    const reserve = [a.id,BigInt(a.refundCommitment),BigInt(a.deadline),s,7n,[],1n,0n];
    await assert.rejects(write(ledger,'reservePass',reserve),/Inactive/);
    await write(ledger,'setEnabled',[true]);
    await assert.rejects(write(ledger,'reservePass',reserve,stranger),/Issuer only/);
    await write(bridge,'configure',[leaf(s),false]); await assert.rejects(write(ledger,'reservePass',reserve),/Unverified/);
    assert.equal(await read(ledger,'spent',[s[1]]),false);
    await write(bridge,'configure',[leaf(s),true]);
    for (const [index,value] of [[0,b.id],[1,BigInt(a.refundCommitment)+1n],[2,BigInt(a.deadline)+1n]]) {
      const changed = [...reserve]; changed[index]=value; await assert.rejects(write(ledger,'reservePass',changed),/binding differs/);
    }
    const wrongScope = [...s]; wrongScope[3]+=1n;
    await assert.rejects(write(ledger,'reservePass',[a.id,BigInt(a.refundCommitment),BigInt(a.deadline),wrongScope,7n,[],1n,0n]),/Invalid or spent/);
    await write(ledger,'reservePass',reserve); assert.equal(await read(ledger,'spent',[s[1]]),true);
    await assert.rejects(write(ledger,'reservePass',reserve),/spent/);
    await write(bridge,'configure',[leaf(second),true]);
    await assert.rejects(write(ledger,'reservePass',[b.id,BigInt(b.refundCommitment),BigInt(b.deadline),second,7n,[],1n,0n]),/spent/);
    await assert.rejects(write(ledger,'returnPass',[a.id],stranger),/Issuer only/);
    await write(ledger,'returnPass',[a.id]); assert.equal((await read(ledger,'reservations',[a.id]))[2],3);
    assert.equal(await read(ledger,'spent',[s[1]]),true,'Refund never resets the original nullifier');
    await assert.rejects(write(ledger,'returnPass',[a.id]),/already finalized/);
    await assert.rejects(write(ledger,'settlePass',[a.id]),/already finalized/);
    const other = fixture.otherSignals.map(BigInt); await write(bridge,'configure',[leaf(other),true]);
    await write(ledger,'reservePass',[b.id,BigInt(b.refundCommitment),BigInt(b.deadline),other,7n,[],1n,0n]);
    await write(ledger,'settlePass',[b.id]); await assert.rejects(write(ledger,'returnPass',[b.id]),/already finalized/);
    const noncanonical = [...s]; noncanonical[2]=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    await assert.rejects(read(ledger,'statementLeaf',[noncanonical]),/Invalid field/);
    await provider.request({ method:'evm_increaseTime',params:[3*86400] }); await provider.request({method:'evm_mine',params:[]});
    await assert.rejects(write(ledger,'reservePass',reserve),/expired/);
    console.log('Local EVM only; mock bridge receipts are not live zkVerify/Horizen certification.');
  } finally { await provider.disconnect(); }
});
