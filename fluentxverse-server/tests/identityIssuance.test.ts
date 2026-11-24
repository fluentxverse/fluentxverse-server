import { expect, test } from 'bun:test';
import { signIdentityCredential, type IdentityEligibility } from '../src/services/tutorIdentity/credential';
import { advanceIdentityIssuance, type IdentityIssuanceJob, type IdentityIssuanceGateway, type IdentityIssuanceRepository } from '../src/services/tutorIdentity/issuance';

const eligibility: IdentityEligibility = { submissionId:'s',currentSubmissionId:'s',interviewId:'i',currentInterviewId:'i',status:'verified',adultConfirmed:true,
  interviewResult:'pass',interviewPassed:true,identityVerified:true,banned:false,revoked:false,walletPublicationConsent:true,walletBound:true };
const binding = { chainId:421614 as const,collection:'0x'+'1'.repeat(40),holder:'0x'+'2'.repeat(40),mock:true };
const signed = await signIdentityCredential(eligibility,binding,Buffer.alloc(32,14));
function fixture() {
  let current = { ...eligibility }, saved: IdentityIssuanceJob[] = [], submits=0, mints=0;
  const job: IdentityIssuanceJob = {id:'s',stage:'ready',binding,issuer:signed.issuer,verificationKeySHA256:'a'.repeat(64)};
  const repo: IdentityIssuanceRepository = {eligibility:async()=>current,save:async j=>{saved.push(structuredClone(j));}};
  const gateway: IdentityIssuanceGateway = {
    prove:async()=>({proof:{synthetic:true},publicSignals:signed.publicSignals,verificationKeySHA256:job.verificationKeySHA256}),
    submitProof:async()=>{submits++;return 'proof';},verifyReceipt:async()=>true,assertCollectionLocked:async()=>{},
    mint:async(_,key)=>{expect(key).toContain('tutor-identity:s:421614:');mints++;return 'mint';},
    verifyMint:async()=>({transactionHash:'0x'+'a'.repeat(64)}),
  };
  return {job,repo,gateway,saved,setEligibility:(e:Partial<IdentityEligibility>)=>{current={...current,...e};},counts:()=>({submits,mints})};
}
test('proof verification precedes mint; finality precedes issued status; retries do not duplicate',async()=>{
  const f=fixture();let j=f.job;
  for(const expected of ['proved','proof_submitted','proof_verified','mint_submitted','issued']){
    j=await advanceIdentityIssuance(j,f.repo,f.gateway);expect(j.stage).toBe(expected as any);
  }
  expect(f.saved.map(j=>j.stage)).toContain('submitting_proof');expect(f.saved.map(j=>j.stage)).toContain('minting');
  expect(j.tokenId).toBe(signed.publicSignals[7]);
  await advanceIdentityIssuance(j,f.repo,f.gateway);expect(f.counts()).toEqual({submits:1,mints:1});
});
test('pending receipt cannot mint',async()=>{
  const f=fixture();f.gateway.verifyReceipt=async()=>false;
  let j=await advanceIdentityIssuance(f.job,f.repo,f.gateway);j=await advanceIdentityIssuance(j,f.repo,f.gateway);
  j=await advanceIdentityIssuance(j,f.repo,f.gateway);expect(j.stage).toBe('proof_submitted');expect(f.counts().mints).toBe(0);
});
test('failed/revoked/replaced identity and withdrawn wallet consent cancel before submission',async()=>{
  for(const change of [{interviewPassed:false},{banned:true},{revoked:true},{currentSubmissionId:'new'},{walletPublicationConsent:false}]){
    const f=fixture();const j=await advanceIdentityIssuance(f.job,f.repo,f.gateway);f.setEligibility(change);
    expect((await advanceIdentityIssuance(j,f.repo,f.gateway)).stage).toBe('cancelled');expect(f.counts()).toEqual({submits:0,mints:0});
  }
});
test('changed eligibility after queuing mint requires revocation, never claims issued',async()=>{
  const f=fixture();let j=f.job;for(let i=0;i<4;i++)j=await advanceIdentityIssuance(j,f.repo,f.gateway);
  f.setEligibility({interviewPassed:false});expect((await advanceIdentityIssuance(j,f.repo,f.gateway)).stage).toBe('revocation_required');
});
test('ambiguous proof/mint response and interrupted side effects cannot blindly retry',async()=>{
  for(const operation of ['submitProof','mint'] as const){
    const f=fixture();f.gateway[operation]=async()=>{throw Error('response lost');};let j=f.job;
    for(let i=0;i<(operation==='mint'?4:2);i++)j=await advanceIdentityIssuance(j,f.repo,f.gateway);
    expect(j.stage).toBe('reconciliation_required');expect((await advanceIdentityIssuance(j,f.repo,f.gateway)).stage).toBe('reconciliation_required');
  }
  for(const stage of ['submitting_proof','minting'] as const){const f=fixture();expect((await advanceIdentityIssuance({...f.job,stage},f.repo,f.gateway)).stage).toBe('reconciliation_required');}
});
test('wrong release and unlocked collection cannot mint',async()=>{
  const f=fixture();f.gateway.prove=async()=>({proof:{},publicSignals:signed.publicSignals,verificationKeySHA256:'b'.repeat(64)});
  await expect(advanceIdentityIssuance(f.job,f.repo,f.gateway)).rejects.toThrow('release');
  const g=fixture();let j=g.job;for(let i=0;i<3;i++)j=await advanceIdentityIssuance(j,g.repo,g.gateway);
  g.gateway.assertCollectionLocked=async()=>{throw Error('unlocked');};
  await expect(advanceIdentityIssuance(j,g.repo,g.gateway)).rejects.toThrow('unlocked');expect(g.counts().mints).toBe(0);
});
