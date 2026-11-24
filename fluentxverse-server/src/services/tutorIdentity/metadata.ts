import { getDriver } from '../../db/memgraph';
import type { IdentityIssuanceJob } from './issuance';
import { assertIdentitySignals } from './credential';
import { BASE_MAINNET_BRIDGE, validateHorizenReceipt } from '../proof.services/horizenReceipt';

export function identityMetadataUri(job: IdentityIssuanceJob) {
  if(!job.tokenId)throw Error('Missing identity token');
  return `https://api.fluentxverse.com/proof/tutor-identity/metadata/${job.binding.collection.toLowerCase()}/${BigInt(job.tokenId).toString(16).padStart(64,'0')}.json`;
}

export function productionIdentityMetadata(job: IdentityIssuanceJob) {
  const r=job.arbitrumReceipt;
  if(job.stage!=='issued' || job.binding.chainId!==42161 || job.binding.mock || !job.proof || !job.tokenId
    || !/^0x[\da-fA-F]{64}$/.test(job.nativeProofTransactionHash||'') || !/^0x[\da-fA-F]{64}$/.test(job.mintTransactionHash||'')
    || !r || r.chainId!==42161 || r.domainId!==10 || r.bridge.toLowerCase()!==BASE_MAINNET_BRIDGE.toLowerCase()
    || !/^0x[\da-fA-F]{64}$/.test(r.statement) || BigInt(r.statement)===0n
    || !/^0x[\da-fA-F]{64}$/.test(r.blockHash) || !/^[1-9][0-9]*$/.test(r.blockNumber))throw Error('Finalized Arbitrum identity evidence required');
  validateHorizenReceipt(r.receipt);
  assertIdentitySignals(job.proof.publicSignals,job.binding,job.issuer);
  if(job.tokenId!==job.proof.publicSignals[7] || job.proof.verificationKeySHA256!==job.verificationKeySHA256)throw Error('Identity metadata binding differs');
  return {
    name:'FluentXVerse Tutor Identity',
    description:'Non-transferable FluentXVerse staff attestation of adult identity matching and interview approval. Validity must be checked with the issuer; this is not a government certification.',
    image:'https://fluentxverse.com/assets/img/logo/icon_logo.png',
    external_url:`https://arbiscan.io/address/${r.bridge}#readContract`,
    attributes:[{trait_type:'Network',value:'Arbitrum One'},{trait_type:'Proof verification',value:'zkVerify mainnet / Arbitrum receipt'},
      {trait_type:'Transfers',value:'Permanently disabled'}],
    properties:{policy:'fluentxverse.tutor-identity.v1',mock:false,chainId:42161,collection:job.binding.collection,holder:job.binding.holder,
      tokenId:job.tokenId,mintTransaction:job.mintTransactionHash,proofTransaction:job.nativeProofTransactionHash,
      proof:job.proof.proof,publicSignals:job.proof.publicSignals,verificationKeySHA256:job.verificationKeySHA256,
      arbitrumReceipt:r,validitySource:'FluentXVerse live issuer status; token ownership alone does not establish current approval'},
  };
}

export async function publicProductionIdentityMetadata(collection:string,id:string) {
  if(!/^0x[\da-fA-F]{40}$/.test(collection) || !/^[\da-fA-F]{64}\.json$/.test(id))return null;
  const s=getDriver().session();
  try {
    const row=(await s.run(`MATCH(m:TutorIdentityPublicMetadata {id:$id,chainId:42161,mock:false})
      MATCH(j:TutorIdentityCredential {id:m.submissionId}) MATCH(u:User {id:j.tutorId})
      OPTIONAL MATCH(i:TutorIdentity {id:u.identitySubmissionId})
      RETURN m.json AS json,j,i,u`,{id:`42161:${collection.toLowerCase()}:${BigInt('0x'+id.slice(0,-5)).toString()}`})).records[0];
    if(!row)return null;
    const metadata=JSON.parse(row.get('json')),j=row.get('j').properties,i=row.get('i')?.properties,u=row.get('u').properties;
    const w=u.smartWalletAddress,holder=w&&typeof w==='object'?(w.smartAccountAddress||w.address):null;
    const active=j.revoked===false && j.issuanceStage==='issued' && i?.id===j.id && i.status==='verified'
      && u.identityVerified===true && u.interviewPassed===true && u.identityBanned!==true
      && typeof holder==='string' && w.userId===u.id && holder.toLowerCase()===metadata.properties.holder.toLowerCase();
    metadata.properties.issuerStatus=active?'active':'invalidated';
    return JSON.stringify(metadata);
  } finally {await s.close();}
}

export function testIdentityMetadata(job: IdentityIssuanceJob) {
  if(job.stage!=='issued' || job.binding.chainId!==421614 || !job.binding.mock || !job.proof
    || !job.nativeProofTransactionHash || !job.mintTransactionHash)throw Error('Finalized test identity credential required');
  return {
    name:'FluentXVerse TEST Identity',
    description:'TEST ONLY. A mock identity/interview attestation. This is not a production identity verification or government certification.',
    image:'https://fluentxverse.com/assets/img/logo/icon_logo.png',
    external_url:'https://zkverify-testnet.subscan.io/extrinsic/'+job.nativeProofTransactionHash,
    attributes:[{trait_type:'Credential',value:'TEST ONLY'},{trait_type:'Network',value:'Arbitrum Sepolia'},
      {trait_type:'Proof verification',value:'zkVerify Volta'},{trait_type:'Transfers',value:'Permanently disabled'}],
    properties:{policy:'fluentxverse.tutor-identity.v1',mock:true,chainId:421614,collection:job.binding.collection,holder:job.binding.holder,
      tokenId:job.tokenId,mintTransaction:job.mintTransactionHash,proofTransaction:job.nativeProofTransactionHash,
      proof:job.proof.proof,publicSignals:job.proof.publicSignals,verificationKeySHA256:job.verificationKeySHA256},
  };
}
export async function publicTestIdentityMetadata(id:string) {
  if(!/^[a-fA-F0-9]{64}\.json$/.test(id))return null;
  const s=getDriver().session();
  try{return (await s.run("MATCH(m:TutorIdentityPublicMetadata {chainId:421614,tokenHex:$id,mock:true}) RETURN m.json AS json LIMIT 1",
    {id:id.slice(0,-5).toLowerCase()})).records[0]?.get('json')||null;}
  finally{await s.close();}
}
