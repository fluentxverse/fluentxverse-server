import { expect, test, spyOn } from 'bun:test';
import { signIdentityCredential } from '../src/services/tutorIdentity/credential';
import { advanceIdentityIssuance, identityCredentialDisplayStatus, type IdentityIssuanceJob } from '../src/services/tutorIdentity/issuance';
import { IdentityEngineGateway, type IdentityRelease } from '../src/services/tutorIdentity/gateway';
import { identityMetadataUri, productionIdentityMetadata } from '../src/services/tutorIdentity/metadata';
import { identityIssuanceMode, identityWalletConsentVersion,assertProfileCredentialConsent } from '../src/services/tutorIdentity/production';
import { BASE_MAINNET_BRIDGE, horizenReceiptReader } from '../src/services/proof.services/horizenReceipt';

const eligibility={submissionId:'s',currentSubmissionId:'s',interviewId:'i',currentInterviewId:'i',status:'verified',adultConfirmed:true,
  interviewResult:'pass',interviewPassed:true,identityVerified:true,banned:false,revoked:false,walletPublicationConsent:true,walletBound:true};
const binding={chainId:42161 as const,collection:'0x'+'1'.repeat(40),holder:'0x'+'2'.repeat(40),mock:false};
const signed=await signIdentityCredential(eligibility,binding,Buffer.alloc(32,15));
test('profile completion requires current mainnet consent bound to the verified tutor wallet',()=>{
  const user={id:'tutor',identitySubmissionId:'i',identityVerified:true,smartWalletAddress:{userId:'tutor',address:binding.holder}};
  const identity={id:'i',status:'verified',walletPublicationConsent:true,walletConsentVersion:identityWalletConsentVersion('production'),walletConsentAddress:binding.holder};
  expect(()=>assertProfileCredentialConsent(user,identity)).not.toThrow();
  for(const change of [{walletPublicationConsent:false},{walletConsentVersion:'tutor-identity-wallet.v1'},{walletConsentAddress:binding.collection},{id:'old'},{status:'resubmit'}])
    expect(()=>assertProfileCredentialConsent(user,{...identity,...change})).toThrow();
  expect(()=>assertProfileCredentialConsent({...user,identityBanned:true},identity)).toThrow();
});
const hash=('0x'+'a'.repeat(64)) as `0x${string}`,vk={fixture:true};
const release={mode:'production',chainId:42161,collection:binding.collection,operator:'0x'+'3'.repeat(40),rpcUrl:'http://127.0.0.1:1',
  issuerAx:signed.issuer.issuerAx,issuerAy:signed.issuer.issuerAy,domainId:10,verificationNetwork:'zkVerify',artifacts:{vk:{sha256:'b'.repeat(64)}}} as IdentityRelease;
function fixture() {
  const job:IdentityIssuanceJob={id:'s',stage:'proof_submitted',binding,issuer:signed.issuer,verificationKeySHA256:'b'.repeat(64),
    tokenId:signed.publicSignals[7],proofSubmissionId:'proof',proof:{proof:{synthetic:true},publicSignals:signed.publicSignals,verificationKeySHA256:'b'.repeat(64)}};
  const gateway=new IdentityEngineGateway(release,vk,'http://127.0.0.1:1','test-only');
  const receipt={aggregationId:'5',merklePath:[],leafCount:'1',index:'0'};
  const native={status:'finalized',txHash:hash,blockHash:hash,statement:hash};
  const response={submissionId:'proof',receipt:{network:'zkVerify',verifiedOnZkVerify:true,verifiedOnArbitrum:true,status:'arbitrum_finalized',
    chainId:42161,domainId:10,bridge:BASE_MAINNET_BRIDGE,statement:hash,receipt}};
  (gateway as any).request=async(path:string)=>path.endsWith('/receipt')?response:{submission:{id:'proof',status:'finalized',zkVerifyNetwork:'zkVerify',domainId:10,
    proofSystem:'groth16',publicSignals:JSON.stringify(job.proof!.publicSignals),proof:JSON.stringify(job.proof!.proof),vk:JSON.stringify(vk),transactionResult:JSON.stringify(native)}};
  return {job,gateway,response,native};
}
test('production mode requires its own consent version; unknown modes fail closed',()=>{
  expect(identityWalletConsentVersion('production')).not.toBe(identityWalletConsentVersion('pilot'));
  const old=process.env.TUTOR_IDENTITY_ISSUANCE_MODE;
  try{delete process.env.TUTOR_IDENTITY_ISSUANCE_MODE;expect(identityIssuanceMode()).toBe('pilot');
    process.env.TUTOR_IDENTITY_ISSUANCE_MODE='unexpected';expect(identityIssuanceMode).toThrow();}
  finally{if(old===undefined)delete process.env.TUTOR_IDENTITY_ISSUANCE_MODE;else process.env.TUTOR_IDENTITY_ISSUANCE_MODE=old;}
});
test('mainnet receipt must verify independently at a finalized Arbitrum snapshot before metadata can publish',async()=>{
  const f=fixture();
  const check=spyOn(horizenReceiptReader,'check').mockResolvedValue({number:100n,hash} as any);
  const verify=spyOn(horizenReceiptReader,'verify').mockResolvedValue(false);
  try{
    expect(await f.gateway.verifyReceipt(f.job)).toBe(false);expect(f.job.arbitrumReceipt).toBeUndefined();
    verify.mockResolvedValue(true);expect(await f.gateway.verifyReceipt(f.job)).toBe(true);
    expect(verify.mock.calls[1]![3]).toEqual({blockNumber:100,blockHash:hash});
    const metadata=productionIdentityMetadata({...f.job,stage:'issued',mintTransactionHash:hash});
    expect(metadata.properties.arbitrumReceipt).toEqual(f.job.arbitrumReceipt!);
    expect(metadata.external_url).toContain('arbiscan.io/address/');
    expect(identityMetadataUri(f.job)).toContain(`${binding.collection}/${BigInt(f.job.tokenId!).toString(16).padStart(64,'0')}.json`);
    for(const changed of [{stage:'proof_verified'}, {binding:{...binding,mock:true}}, {arbitrumReceipt:undefined}, {tokenId:'1'}])
      expect(()=>productionIdentityMetadata({...f.job,stage:'issued',mintTransactionHash:hash,...changed} as IdentityIssuanceJob)).toThrow();
  }finally{check.mockRestore();verify.mockRestore();}
});
test('wrong proof submission, network, statement and bridge cannot authorize mainnet issuance',async()=>{
  for(const mutate of [(f:any)=>f.response.submissionId='other',(f:any)=>f.response.receipt.network='Volta',
    (f:any)=>f.response.receipt.statement='0x'+'c'.repeat(64),(f:any)=>f.response.receipt.bridge=binding.collection]){
    const f=fixture();mutate(f);await expect(f.gateway.verifyReceipt(f.job)).rejects.toThrow();expect(f.job.arbitrumReceipt).toBeUndefined();
  }
});
test('pending Arbitrum root never advances issuance to mint',async()=>{
  const f=fixture();f.response.receipt.status='awaiting_arbitrum_relay_or_finality';f.response.receipt.verifiedOnArbitrum=false;
  const next=await advanceIdentityIssuance(f.job,{eligibility:async()=>eligibility,save:async()=>{}},f.gateway);
  expect(next.stage).toBe('proof_submitted');expect(next.arbitrumReceipt).toBeUndefined();
  expect(next.receiptStatus).toBe('awaiting_arbitrum_finality');
  expect(identityCredentialDisplayStatus(next)).toBe('credential_awaiting_arbitrum_finality');
});
test('production mint requires receipt evidence and a matching collection metadata URI',async()=>{
  const f=fixture();await expect(f.gateway.mint(f.job,'key')).rejects.toThrow('Arbitrum evidence');
  (f.gateway as any).client={getChainId:async()=>42161,readContract:async({functionName}:any)=>
    ({owner:release.operator,transfersEnabled:false,transfersPermanentlyLocked:true,uri:'https://wrong.invalid/{id}.json'} as any)[functionName]};
  await expect(f.gateway.assertCollectionLocked(f.job)).rejects.toThrow('URI');
  (f.gateway as any).client.readContract=async({functionName}:any)=>
    ({owner:release.operator,transfersEnabled:false,transfersPermanentlyLocked:true,uri:identityMetadataUri(f.job)} as any)[functionName];
  await f.gateway.assertCollectionLocked(f.job);
});
