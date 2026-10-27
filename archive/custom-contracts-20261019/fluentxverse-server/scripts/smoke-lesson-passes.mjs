import { readFileSync, writeFileSync, existsSync, renameSync, chmodSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { Group } from '@semaphore-protocol/group';
import { Identity } from '@semaphore-protocol/identity';
import { generateProof, verifyProof } from '@semaphore-protocol/proof';
import { unpackGroth16Proof } from '@zk-kit/utils/proof-packing';
import { zkVerifySession } from 'zkverifyjs';
import { createPublicClient, http, parseAbi, keccak256, toHex, concat, sha256 } from 'viem';
import { passMessage, passScope } from '../src/shared/lessonPasses.ts';

// Synthetic release records only. No students, purchases, bookings or user balances.
const directory = new URL('../.deployment/lesson-passes/', import.meta.url);
const deployment = JSON.parse(readFileSync(new URL('state.json', directory), 'utf8'));
const file = new URL('smoke.json', directory), lockFile = new URL('release.lock', directory);
const [phase = 'inspect', kind = 'return'] = process.argv.slice(2).filter(n => n !== '--apply');
const apply = process.argv.includes('--apply');
let lock, smoke;
const save = () => { const tmp = new URL('smoke.tmp', directory); writeFileSync(tmp, JSON.stringify(smoke,null,2), { mode:0o600 }); chmodSync(tmp,0o600); renameSync(tmp,file); };
const hash = n => (BigInt(keccak256(toHex(BigInt(n), { size:32 }))) >> 8n).toString();
const client = createPublicClient({ transport:http('https://horizen-testnet.rpc.caldera.xyz/http',{timeout:20000,retryCount:0}) });
const abi = parseAbi(['function owner() view returns(address)','function enabled() view returns(bool)','function bridge() view returns(address)',
  'function vkHash() view returns(bytes32)','function domainId() view returns(uint256)','function scopeHash() view returns(uint256)',
  'function batches(bytes32) view returns(uint256,uint16)','function spent(uint256) view returns(bool)',
  'function reservations(bytes32) view returns(uint256,uint256,uint8)', 'function statementLeaf(uint256[4]) view returns(bytes32)',
  'function registerBatch(bytes32,uint256,uint16)','function reservePass(bytes32,uint256,uint64,uint256[4],uint256,bytes32[],uint256,uint256)',
  'function returnPass(bytes32)','function settlePass(bytes32)']);
const bridgeABI = parseAbi(['function verifyProofAggregation(uint256,uint256,bytes32,bytes32[],uint256,uint256) view returns(bool)',
  'function proofsAggregations(uint256,uint256) view returns(bytes32)']);
const read = (functionName,args=[],blockTag='finalized') => client.readContract({address:deployment.contract,abi,functionName,args,blockTag});
async function api(path,body,timeout=30000) {
  const response = await fetch(`http://127.0.0.1:8090/v1/${path}`,{method:body===undefined?'GET':'POST',
    headers:{'Content-Type':'application/json','X-GMR-Engine-Key':deployment.apiKey},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
  if(!response.ok)throw new Error(`Engine smoke operation returned HTTP ${response.status}`);
  return response.json();
}
async function write(name,functionName,args) {
  const payload=createHash('sha256').update(JSON.stringify({contract:deployment.contract,functionName,args})).digest('hex');
  const old=smoke.operations[name]; if(old && old.payload!==payload)throw new Error('Smoke immutable operation differs');
  if(!old) {
    smoke.operations[name]={status:'dispatching',payload};save();
    const {transaction}=await api('contracts/write',{abi,chainId:2651420,contractAddress:deployment.contract,functionName,
      args:args.map(n=>typeof n==='object'?JSON.stringify(n):String(n)),value:'0',walletAddress:''});
    if(!transaction?.id)throw new Error('Smoke uncertain Engine dispatch needs reconciliation');
    smoke.operations[name]={id:transaction.id,status:transaction.status,payload};save();
  }
  const operation=smoke.operations[name];if(!operation.id)throw new Error('Smoke uncertain Engine dispatch needs reconciliation');
  for(let attempt=0;attempt<36;attempt++) {
    const {transaction}=await api(`transactions/${operation.id}`);
    if(['confirmed','mined'].includes(transaction.status)) {operation.status=transaction.status;operation.hash=transaction.transactionHash;save();return operation;}
    if(['failed','errored'].includes(transaction.status))throw new Error('Smoke transaction failed; reconcile its recorded operation');
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
  throw new Error('Smoke transaction pending; rerun to reconcile the same operation');
}
function leaf(signals) {
  const encoded=signals.map(n=>`0x${BigInt(n).toString(16).padStart(64,'0').match(/../g).reverse().join('')}`);
  return keccak256(concat([keccak256(toHex('groth16')),deployment.pins.nativeVk,sha256(toHex('')),keccak256(concat(encoded))]));
}
async function bridgeVerified(pass) {
  if(!pass.receipt)return false;
  const r=pass.receipt;
  return client.readContract({address:deployment.bridge||'0x3098A6974649478f0133046e44105AA84e868C21',abi:bridgeABI,
    functionName:'verifyProofAggregation',args:[175n,BigInt(pass.submission.aggregationId),pass.statement,r.proof,BigInt(r.numberOfLeaves),BigInt(r.leafIndex)],blockTag:'finalized'});
}
try {
  if(!['return','settle'].includes(kind))throw new Error('Smoke kind must be return or settle');
  if(phase!=='inspect') {
    if(!apply)throw new Error('Smoke mutations require --apply');
    try{lock=openSync(lockFile,'wx',0o600);}catch{throw new Error('Smoke another deployment operation needs reconciliation');}
    writeFileSync(lock,JSON.stringify({pid:process.pid,phase,kind}));
  }
  smoke=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{version:1,synthetic:true,contract:deployment.contract,batchId:keccak256(toHex(`pass-release:${randomUUID()}`)),operations:{},passes:{}};
  if(!deployment.contract || smoke.contract!==deployment.contract || await client.getChainId()!==2651420)throw new Error('Smoke deployment configuration differs');
  if(phase==='prepare') {
    if(!smoke.members) {
      const identities=Array.from({length:8},()=>new Identity());
      smoke.members=identities.map(n=>n.commitment.toString()).sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
      const group=new Group(smoke.members.map(BigInt));smoke.root=group.root.toString();
      for(const [i,name] of ['return','settle'].entries()) {
        const refund=new Identity();
        smoke.passes[name]={privateKey:identities[i].export(),refundKey:refund.export(),authorization:{id:keccak256(toHex(`pass-intent:${randomUUID()}`)),
          root:smoke.root,refundCommitment:refund.commitment.toString(),deadline:Math.floor(Date.now()/1000)+172800}};
      }save();
    }
    const assets=new URL('../../fluentxverse-student-solid-prototype/public/anonymous-reviews/',import.meta.url);
    const wasm=new Uint8Array(readFileSync(new URL('semaphore.wasm',assets))),zkey=new Uint8Array(readFileSync(new URL('semaphore.zkey',assets)));
    if(createHash('sha256').update(wasm).digest('hex')!==deployment.pins.wasm || createHash('sha256').update(zkey).digest('hex')!==deployment.pins.zkey)throw new Error('Smoke proving artifacts differ');
    for(const name of ['return','settle']) {
      const pass=smoke.passes[name]; if(pass.proof)continue;
      pass.proof=await generateProof(Identity.import(pass.privateKey),new Group(smoke.members.map(BigInt)),passMessage(pass.authorization),passScope(2651420,deployment.contract),8,{wasm,zkey});
      if(!await verifyProof(pass.proof))throw new Error('Smoke local proof verification failed');
      pass.signals=[pass.proof.merkleTreeRoot,pass.proof.nullifier,hash(pass.proof.message),hash(pass.proof.scope)];pass.statement=leaf(pass.signals);save();
    }
    console.log(JSON.stringify({synthetic:true,prepared:true,batchId:smoke.batchId,statements:Object.fromEntries(Object.entries(smoke.passes).map(([k,p])=>[k,p.statement]))}));
  }else if(phase==='register') {
    await write('register','registerBatch',[smoke.batchId,smoke.root,8]);console.log(JSON.stringify({synthetic:true,registration:smoke.operations.register}));
  }else if(phase==='submit') {
    const pass=smoke.passes[kind];if(!pass?.proof)throw new Error('Smoke prepare the synthetic proof first');
    if(!pass.submission) {
      if(pass.submitting)throw new Error('Smoke uncertain proof submission needs Engine reconciliation');
      pass.submitting=true;save();
      const vk=JSON.parse(readFileSync(new URL('../../fluentxverse-student-solid-prototype/public/anonymous-reviews/semaphore.vk.json',import.meta.url),'utf8'));
      if(createHash('sha256').update(JSON.stringify(vk)).digest('hex')!==deployment.pins.vk)throw new Error('Smoke verifier artifacts differ');
      const {submission}=await api('zkverify/proofs',{proof:unpackGroth16Proof(pass.proof.points),publicSignals:pass.signals,vk,domainId:175,
        curve:'bn128',proofSystem:'groth16',expectedNetwork:'Volta'},300000);
      const result=JSON.parse(submission.transactionResult);
      if(submission.zkVerifyNetwork!=='Volta'|| result.statement?.toLowerCase()!==pass.statement.toLowerCase() || Number(result.domainId)!==175 || !/^0x[a-fA-F0-9]{64}$/.test(result.txHash||''))throw new Error('Smoke proof statement or network differs');
      pass.submission={id:submission.id,txHash:result.txHash,aggregationId:result.aggregationId,domainId:result.domainId,blockHash:result.blockHash};save();
    }console.log(JSON.stringify({synthetic:true,kind,submission:pass.submission}));
  }else if(phase==='receipt') {
    const pass=smoke.passes[kind];if(!pass?.submission)throw new Error('Smoke submit the proof first');
    const session=await zkVerifySession.start().Volta().readOnly();
    try {
      if(!pass.receiptBlockHash) {
        const head=(await session.api.rpc.chain.getHeader(await session.api.rpc.chain.getFinalizedHead())).number.toNumber();
        const start=pass.scanNext??(await session.api.rpc.chain.getHeader(pass.submission.blockHash)).number.toNumber();
        for(let height=start;height<=Math.min(head,start+299);height++) {
          const blockHash=(await session.api.rpc.chain.getBlockHash(height)).toString(),events=await session.api.query.system.events.at(blockHash);
          if(events.some(({event})=>event.section==='aggregate'&&event.method==='NewAggregationReceipt'&&event.data[0].toString()==='175'&&event.data[1].toString()===String(pass.submission.aggregationId))) {
            pass.receiptBlockHash=blockHash;pass.receiptBlockNumber=height;save();break;
          }pass.scanNext=height+1;
        }save();
      }
      if(pass.receiptBlockHash&&!pass.receipt) {
        const path=await session.getAggregateStatementPath(pass.receiptBlockHash,175,pass.submission.aggregationId,pass.statement);
        if(path.leaf.toLowerCase()!==pass.statement.toLowerCase())throw new Error('Smoke receipt statement differs');
        pass.receipt=path;save();
      }
      pass.finalizedBridgeVerified=await bridgeVerified(pass);save();
      console.log(JSON.stringify({synthetic:true,kind,status:pass.finalizedBridgeVerified?'bridge_verified':pass.receipt?'awaiting_horizen_relay':'awaiting_volta_publication',
        aggregationId:pass.submission.aggregationId,publicationBlock:pass.receiptBlockNumber||null}));
    }finally{await session.close();}
  }else if(phase==='reserve') {
    const pass=smoke.passes[kind];if(!pass?.receipt||!await bridgeVerified(pass))throw new Error('Smoke finalized official bridge receipt is unavailable');
    if(!await read('enabled') || (await read('batches',[smoke.batchId]))[0].toString()!==smoke.root)throw new Error('Smoke ledger configuration or issuance is not finalized');
    const a=pass.authorization,r=pass.receipt;
    await write(`reserve-${kind}`,'reservePass',[a.id,a.refundCommitment,a.deadline,pass.signals,pass.submission.aggregationId,r.proof,r.numberOfLeaves,r.leafIndex]);
    console.log(JSON.stringify({synthetic:true,kind,reservation:smoke.operations[`reserve-${kind}`]}));
  }else if(phase==='finalize') {
    const pass=smoke.passes[kind];const n=await read('reservations',[pass.authorization.id],'latest');
    if(n[0].toString()!==pass.proof.nullifier||n[1].toString()!==pass.authorization.refundCommitment||Number(n[2])!==1&&!smoke.operations[`finalize-${kind}`])throw new Error('Smoke reserved entitlement differs');
    await write(`finalize-${kind}`,kind==='return'?'returnPass':'settlePass',[pass.authorization.id]);
    console.log(JSON.stringify({synthetic:true,kind,finalization:smoke.operations[`finalize-${kind}`]}));
  }else if(phase==='verify') {
    for(const name of ['return','settle']) {
      const p=smoke.passes[name],n=await read('reservations',[p.authorization.id]);
      if(Number(n[2])!==(name==='return'?3:2)||n[0].toString()!==p.proof.nullifier||n[1].toString()!==p.authorization.refundCommitment
        ||!await read('spent',[BigInt(p.proof.nullifier)])||!await bridgeVerified(p))throw new Error('Smoke finalized end-to-end settlement is unavailable');
    }smoke.finalizedVerified=true;save();console.log(JSON.stringify({synthetic:true,finalizedVerified:true,contract:smoke.contract}));
  }else if(phase==='inspect') {
    console.log(JSON.stringify({synthetic:true,contract:smoke.contract,batchId:smoke.batchId,finalizedVerified:smoke.finalizedVerified===true,
      operations:smoke.operations,passes:Object.fromEntries(Object.entries(smoke.passes).map(([name,p])=>[name,{statement:p.statement,submission:p.submission,bridgeVerified:p.finalizedBridgeVerified===true}]))}));
  }else throw new Error('Smoke unsupported phase');
}catch(error){console.error(/^(Smoke|Engine smoke)/.test(error.message)?error.message:'Smoke operation failed; inspect private journals and service state');process.exitCode=1;}
finally{if(lock!==undefined){closeSync(lock);unlinkSync(lockFile);}}
process.exit(process.exitCode||0);
