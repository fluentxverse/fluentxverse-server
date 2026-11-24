import { createHash } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createPublicClient, decodeEventLog, http, parseAbi, type Address, type Hex } from 'viem';
import { signIdentityCredential, assertIdentitySignals, identityPolicyHash, type IdentityEligibility } from './credential';
import type { IdentityIssuanceGateway, IdentityIssuanceJob } from './issuance';
import { assertContributedGroth16Key } from '../proof.services/groth16KeySafety';
import { finalizedDestinationReceipt, horizenReceiptReader, BASE_MAINNET_BRIDGE } from '../proof.services/horizenReceipt';
import { identityMetadataUri } from './metadata';

const exec = promisify(execFile);
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const abi = parseAbi(['function transfersEnabled() view returns(bool)', 'function transfersPermanentlyLocked() view returns(bool)',
  'function owner() view returns(address)',
  'function uri(uint256) view returns(string)',
  'function balanceOf(address,uint256) view returns(uint256)', 'function mint(address,uint256,uint256,bytes)',
  'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)']);
export interface IdentityRelease {
  version: 1; mode: 'pilot' | 'production'; policyHash: string;
  chainId: 42161 | 421614; collection: string; operator: string; rpcUrl: string;
  issuerAx: string; issuerAy: string; issuerKeyPath: string;
  verificationNetwork: 'zkVerify' | 'Volta'; domainId: number;
  artifacts: { wasm: { path: string; sha256: string }; zkey: { path: string; sha256: string }; vk: { path: string; sha256: string } };
}
export async function loadIdentityRelease(path: string, pinnedSHA256: string) {
  if (!/^[a-f0-9]{64}$/.test(pinnedSHA256)) throw Error('Pin an approved identity release');
  const bytes = await readFile(path);
  if (sha(bytes) !== pinnedSHA256) throw Error('Identity release manifest changed');
  const release = JSON.parse(bytes.toString()) as IdentityRelease;
  if (release.version !== 1 || release.policyHash !== identityPolicyHash || !['pilot','production'].includes(release.mode)
    || (release.mode === 'pilot' ? release.chainId !== 421614 || release.verificationNetwork !== 'Volta' || release.domainId !== 0
      : release.chainId !== 42161 || release.verificationNetwork !== 'zkVerify' || release.domainId !== 10)) throw Error('Identity release destination differs');
  for (const a of [release.collection,release.operator]) if (!/^0x[a-fA-F0-9]{40}$/.test(a) || BigInt(a) === 0n) throw Error('Invalid identity collection/operator');
  const root = dirname(resolve(path));
  for (const artifact of Object.values(release.artifacts)) {
    const absolute = resolve(root,artifact.path);
    if (relative(root,absolute).startsWith('..') || !/^[a-f0-9]{64}$/.test(artifact.sha256) || sha(await readFile(absolute)) !== artifact.sha256) throw Error('Identity proving artifact differs');
    artifact.path = absolute;
  }
  const vk = JSON.parse(await readFile(release.artifacts.vk.path,'utf8'));
  assertContributedGroth16Key(vk);
  if (vk.nPublic !== 10 || !Array.isArray(vk.IC) || vk.IC.length !== 11) throw Error('Wrong identity circuit key');
  return {release,vk};
}

export class IdentityEngineGateway implements IdentityIssuanceGateway {
  private client;
  constructor(readonly release: IdentityRelease, private vk: unknown, private base: string, private apiKey: string) {
    if (!base || !apiKey) throw Error('Dedicated identity Engine connection required');
    this.client = createPublicClient({transport:http(release.rpcUrl,{timeout:15000,retryCount:0})});
  }
  private async request(path:string, body?:unknown, timeout=30000):Promise<any> {
    const r=await fetch(this.base.replace(/\/$/,'')+path,{method:body===undefined?'GET':'POST',
      headers:{'Content-Type':'application/json','X-GMR-Engine-Key':this.apiKey},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
    if(!r.ok)throw Error('Identity Engine request failed; reconcile before resubmission');
    return r.json();
  }
  private assertJob(job:IdentityIssuanceJob) {
    if (job.binding.chainId!==this.release.chainId || job.binding.collection.toLowerCase()!==this.release.collection.toLowerCase()
      || job.binding.mock!==(this.release.mode==='pilot') || job.verificationKeySHA256!==this.release.artifacts.vk.sha256
      || job.issuer.issuerAx!==this.release.issuerAx || job.issuer.issuerAy!==this.release.issuerAy) throw Error('Identity job differs from pinned release');
  }
  async prove(job:IdentityIssuanceJob, eligibility:IdentityEligibility) {
    this.assertJob(job);
    const keyStat=await stat(this.release.issuerKeyPath);
    if ((keyStat.mode&0o077)!==0 || !keyStat.isFile()) throw Error('Private identity issuer key permissions required');
    const seed=await readFile(this.release.issuerKeyPath);
    let signed;
    try { signed=await signIdentityCredential(eligibility,job.binding,seed); }
    finally {seed.fill(0);}
    if (signed.issuer.issuerAx!==job.issuer.issuerAx || signed.issuer.issuerAy!==job.issuer.issuerAy) throw Error('Identity signing key differs');
    const dir=await mkdtemp(join(tmpdir(),'identity-proof-'));
    try {
      await writeFile(join(dir,'input.json'),JSON.stringify(signed.input),{mode:0o600});
      await exec('snarkjs',['groth16','fullprove',join(dir,'input.json'),this.release.artifacts.wasm.path,this.release.artifacts.zkey.path,join(dir,'proof.json'),join(dir,'public.json')],{timeout:180000,maxBuffer:1024*1024});
      const checked=await exec('snarkjs',['groth16','verify',this.release.artifacts.vk.path,join(dir,'public.json'),join(dir,'proof.json')],{timeout:30000});
      if (!checked.stdout.includes('OK!')) throw Error('Identity local verification failed');
      const publicSignals=JSON.parse(await readFile(join(dir,'public.json'),'utf8'));
      assertIdentitySignals(publicSignals,job.binding,job.issuer);
      if(JSON.stringify(publicSignals)!==JSON.stringify(signed.publicSignals))throw Error('Identity prover output differs');
      return {proof:JSON.parse(await readFile(join(dir,'proof.json'),'utf8')),publicSignals,verificationKeySHA256:job.verificationKeySHA256};
    }finally{await rm(dir,{recursive:true,force:true});}
  }
  async submitProof(job:IdentityIssuanceJob) {
    this.assertJob(job);
    const {submission}=await this.request('/v1/zkverify/proofs',{proof:job.proof!.proof,publicSignals:job.proof!.publicSignals,vk:this.vk,
      proofSystem:'groth16',curve:'bn128',domainId:this.release.domainId,expectedNetwork:this.release.verificationNetwork},300000);
    if(!submission?.id || submission.zkVerifyNetwork!==this.release.verificationNetwork)throw Error('Wrong identity proof submission');
    return submission.id as string;
  }
  async verifyReceipt(job:IdentityIssuanceJob) {
    this.assertJob(job);
    const {submission:s}=await this.request('/v1/zkverify/proofs/'+encodeURIComponent(job.proofSubmissionId!));
    if(s?.id!==job.proofSubmissionId || s.zkVerifyNetwork!==this.release.verificationNetwork || s.domainId!==this.release.domainId
      || s.proofSystem!=='groth16' || JSON.stringify(JSON.parse(s.publicSignals))!==JSON.stringify(job.proof!.publicSignals)
      || JSON.stringify(JSON.parse(s.proof))!==JSON.stringify(job.proof!.proof) || sha(JSON.stringify(JSON.parse(s.vk)))!==sha(JSON.stringify(this.vk))) throw Error('Identity proof receipt binding differs');
    if(s.status!=='finalized'){job.receiptStatus='awaiting_zkverify_finality';return false;}
    const native=JSON.parse(s.transactionResult);
    if(native.status!=='finalized' || !/^0x[a-fA-F0-9]{64}$/.test(native.txHash||'') || !/^0x[a-fA-F0-9]{64}$/.test(native.blockHash||''))throw Error('Missing finalized native identity proof transaction');
    job.nativeProofTransactionHash=native.txHash;
    // Pilot NFTs reference a native Volta proof; they do not claim an Arbitrum bridge receipt.
    if(this.release.mode==='pilot'){delete job.receiptStatus;return true;}
    const result=await this.request('/v1/zkverify/proofs/'+encodeURIComponent(job.proofSubmissionId!)+'/receipt',undefined,240000);
    const r=result.receipt;
    if(result.submissionId!==job.proofSubmissionId || r?.network!=='zkVerify')throw Error('Wrong identity receipt submission');
    if(!finalizedDestinationReceipt(r,42161)){
      job.receiptStatus=r.status==='awaiting_aggregation'?'awaiting_aggregation':'awaiting_arbitrum_finality';return false;
    }
    if(r.bridge?.toLowerCase()!==BASE_MAINNET_BRIDGE.toLowerCase() || !/^0x[a-fA-F0-9]{64}$/.test(r.statement)
      || r.statement.toLowerCase()!==native.statement?.toLowerCase())throw Error('Wrong identity receipt bridge');
    const config={chainId:42161,domainId:10,bridge:BASE_MAINNET_BRIDGE,rpcUrl:this.release.rpcUrl};
    const block=await horizenReceiptReader.check(config);
    if(block.number===null || !block.hash || block.number>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Invalid Arbitrum receipt snapshot');
    if(!await horizenReceiptReader.verify(config,r.statement,r.receipt,{blockNumber:Number(block.number),blockHash:block.hash})){
      job.receiptStatus='awaiting_arbitrum_finality';return false;
    }
    job.arbitrumReceipt={chainId:42161,domainId:10,bridge:BASE_MAINNET_BRIDGE,statement:r.statement,
      receipt:structuredClone(r.receipt),blockNumber:block.number.toString(),blockHash:block.hash};
    delete job.receiptStatus;
    return true;
  }
  async assertCollectionLocked(job:IdentityIssuanceJob) {
    this.assertJob(job);
    if(await this.client.getChainId()!==job.binding.chainId)throw Error('Wrong identity mint network');
    const address=job.binding.collection as Address;
    if((await this.client.readContract({address,abi,functionName:'owner'})).toLowerCase()!==this.release.operator.toLowerCase())throw Error('Identity operator does not own the collection');
    if(await this.client.readContract({address,abi,functionName:'transfersEnabled'})!==false
      || await this.client.readContract({address,abi,functionName:'transfersPermanentlyLocked'})!==true)throw Error('Identity collection is not permanently locked');
    if(this.release.mode==='production') {
      if(!job.tokenId)throw Error('Missing identity token ID');
      const uri=await this.client.readContract({address,abi,functionName:'uri',args:[BigInt(job.tokenId)]});
      if(uri.replaceAll('{id}',BigInt(job.tokenId).toString(16).padStart(64,'0'))!==identityMetadataUri(job))
        throw Error('Production collection URI does not resolve to its bound credential metadata');
    }
  }
  async mint(job:IdentityIssuanceJob,idempotencyKey:string) {
    this.assertJob(job);
    if(this.release.mode==='production' && !job.arbitrumReceipt)throw Error('Finalized Arbitrum evidence required before mint');
    if(!job.tokenId || job.tokenId!==job.proof!.publicSignals[7])throw Error('Identity token binding differs');
    const {transaction:t}=await this.request('/v1/transactions',{idempotencyKey,chainId:this.release.chainId,walletAddress:this.release.operator,
      contractAddress:this.release.collection,kind:'contract_write',method:'mint',args:[job.binding.holder,job.tokenId,'1','0x'],value:'0',metadata:{abi}});
    if(!t?.id)throw Error('Missing identity mint reference');return t.id as string;
  }
  async verifyMint(job:IdentityIssuanceJob) {
    this.assertJob(job);
    if(this.release.mode==='production')await this.assertCollectionLocked(job);
    const {transaction:t}=await this.request('/v1/transactions/'+encodeURIComponent(job.mintTransactionId!));
    if(t?.id!==job.mintTransactionId || t.chainId!==this.release.chainId || t.contractAddress?.toLowerCase()!==this.release.collection.toLowerCase()
      || t.method!=='mint' || JSON.stringify(t.args)!==JSON.stringify([job.binding.holder,job.tokenId,'1','0x']))throw Error('Identity mint transaction differs');
    if(!/^0x[a-fA-F0-9]{64}$/.test(t.transactionHash||''))return null;
    if(await this.client.getChainId()!==job.binding.chainId)throw Error('Wrong identity receipt network');
    const receipt=await this.client.getTransactionReceipt({hash:t.transactionHash as Hex});
    const finalized=await this.client.getBlock({blockTag:'finalized'});
    if(receipt.status!=='success' || receipt.blockNumber>finalized.number)return null;
    const minted=receipt.logs.some(log=>{
      if(log.address.toLowerCase()!==this.release.collection.toLowerCase())return false;
      try {const event=decodeEventLog({abi,data:log.data,topics:log.topics});
        return event.eventName==='TransferSingle' && event.args.from==='0x0000000000000000000000000000000000000000'
          && event.args.operator.toLowerCase()===this.release.operator.toLowerCase()
          && event.args.to.toLowerCase()===job.binding.holder.toLowerCase() && event.args.id===BigInt(job.tokenId!) && event.args.value===1n;
      }catch{return false;}
    });
    if(!minted)throw Error('Identity mint event missing');
    if((await this.client.getBlock({blockNumber:receipt.blockNumber})).hash!==receipt.blockHash)throw Error('Noncanonical identity mint receipt');
    const balance=await this.client.readContract({address:this.release.collection as Address,abi,functionName:'balanceOf',args:[job.binding.holder as Address,BigInt(job.tokenId!)],blockNumber:finalized.number});
    if(balance!==1n)throw Error('Expected one identity token');
    return {transactionHash:t.transactionHash as string};
  }
}
