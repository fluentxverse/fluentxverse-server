import { initDriver,getDriver,closeDriver } from '../src/db/memgraph';
import { runIdentityIssuanceBatch } from '../src/services/tutorIdentity/issuanceWorker';
import { loadIdentityRelease } from '../src/services/tutorIdentity/gateway';
import { ensureTutorIdentitySchema } from '../src/services/tutorIdentity/schema';

if(process.env.MEMGRAPH_URI!=='bolt://fxv-identity-pilot-graph:7687')throw Error('Use the isolated identity pilot graph');
const {release}=await loadIdentityRelease(process.env.TUTOR_IDENTITY_RELEASE_PATH!,process.env.TUTOR_IDENTITY_RELEASE_SHA256!);
if(release.mode!=='pilot'||release.chainId!==421614)throw Error('TEST network only');
await initDriver(process.env.MEMGRAPH_URI,'','',1);
const s=getDriver().session(),id='identity-pilot-20261103',submission=id+'-submission',interview=id+'-interview';
try{
  await ensureTutorIdentitySchema();
  const foreign=await s.run("MATCH(n) WHERE n.id IS NULL OR (NOT n.id STARTS WITH $prefix AND NOT n.id STARTS WITH $publicPrefix) RETURN count(n) AS count",
    {prefix:'identity-pilot-20261103',publicPrefix:'421614:'+release.collection.toLowerCase()+':'});
  if(foreign.records[0]!.get('count').toNumber()!==0)throw Error('Pilot graph contains unexpected records');
  const at=new Date().toISOString();
  await s.executeWrite(async tx=>{
    await tx.run(`MERGE(u:User {id:$id}) ON CREATE SET u.role='tutor',u.email='identity-pilot@example.invalid',u.verifiedEmail=true,
      u.verifiedEmailAddress='identity-pilot@example.invalid',u.writtenExamPassed=true,u.speakingExamPassed=true,u.interviewPassed=true,
      u.identityVerified=true,u.identityBanned=false,u.identitySubmissionId=$submission,u.interviewSlotId=$interview,u.smartWalletAddress=$wallet`,
      {id,submission,interview,wallet:{smartAccountAddress:release.operator,address:release.operator,userId:id}});
    await tx.run(`MERGE(i:TutorIdentity {id:$submission}) ON CREATE SET i.tutorId=$id,i.status='verified',i.adultConfirmed=true,i.interviewId=$interview,
      i.walletPublicationConsent=true,i.walletConsentAddress=$holder,i.walletConsentVersion='tutor-identity-wallet.v1',i.createdAt=$at`,{id,submission,interview,holder:release.operator,at});
    await tx.run("MERGE(v:InterviewSlot {id:$interview}) ON CREATE SET v.tutorId=$id,v.result='pass',v.status='completed',v.completedAt=$at",{id,interview,at});
    await tx.run("MERGE(j:TutorIdentityCredential {id:$submission}) ON CREATE SET j.tutorId=$id,j.interviewId=$interview,j.status='awaiting_configuration',j.revoked=false,j.createdAt=$at",{id,submission,interview,at});
  });
  const deadline=Date.now()+1800000;let completed=false;
  while(Date.now()<deadline){
    await s.run('MATCH(j:TutorIdentityCredential {id:$id}) SET j.issuanceNextAttempt=$at',{id:submission,at:new Date().toISOString()});
    await runIdentityIssuanceBatch();
    const j=(await s.run('MATCH(j:TutorIdentityCredential {id:$id}) RETURN j',{id:submission})).records[0]!.get('j').properties;
    console.log(JSON.stringify({stage:j.issuanceStage||'not_started',proofSubmissionId:j.proofSubmissionId,mintTransactionId:j.mintTransactionId}));
    if(j.issuanceStage==='issued'){
      const job=JSON.parse(j.issuanceJson);
      console.log(JSON.stringify({passed:true,mock:true,chainId:421614,collection:release.collection,tokenId:job.tokenId,
        nativeProofTransaction:job.nativeProofTransactionHash,mintTransaction:job.mintTransactionHash}));completed=true;break;
    }
    if(['cancelled','reconciliation_required','revocation_required'].includes(j.issuanceStage))throw Error('Pilot requires reconciliation; do not recreate it');
    await Bun.sleep(10000);
  }
  if(!completed)throw Error('Pilot is pending finality; preserve the job and resume without resubmission');
}finally{await s.close();await closeDriver();}
process.exit(0);
