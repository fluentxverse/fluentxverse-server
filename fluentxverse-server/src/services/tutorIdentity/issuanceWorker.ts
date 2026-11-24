import { getDriver } from '../../db/memgraph';
import { lockApplicant } from '../exam.services/applicationPolicy';
import { currentIdentity } from './service';
import { advanceIdentityIssuance, identityCredentialDisplayStatus, type IdentityIssuanceJob } from './issuance';
import { IdentityEngineGateway, loadIdentityRelease } from './gateway';
import { logger } from '../../utils/logger';
import { testIdentityMetadata, productionIdentityMetadata } from './metadata';
import { identityIssuanceMode, identityWalletConsentVersion } from './production';
import { ensureTutorIdentitySchema } from './schema';

export function startIdentityIssuanceWorker() {
  if(process.env.TUTOR_IDENTITY_ISSUANCE_ENABLED!=='true')return;
  let running=false,ready=false;
  const tick=async()=>{
    if(running)return;running=true;
    try{if(!ready){await ensureTutorIdentitySchema();ready=true;}await runIdentityIssuanceBatch();}
    catch{logger.error('Identity credential issuance is not ready; no credential claimed');}
    finally{running=false;}
  };
  void tick();setInterval(tick,15000).unref();
}

export async function runIdentityIssuanceBatch() {
  if (process.env.TUTOR_IDENTITY_ISSUANCE_ENABLED !== 'true') return;
  const {release,vk}=await loadIdentityRelease(process.env.TUTOR_IDENTITY_RELEASE_PATH||'',process.env.TUTOR_IDENTITY_RELEASE_SHA256||'');
  if (release.mode!==identityIssuanceMode()) throw Error('Identity release and configured issuance mode differ');
  const consentVersion=identityWalletConsentVersion(release.mode);
  const gateway=new IdentityEngineGateway(release,vk,process.env.TUTOR_IDENTITY_ENGINE_API_BASE||'',process.env.TUTOR_IDENTITY_ENGINE_API_KEY||'');
  const s=getDriver().session();
  try {
    const rows=(await s.run(`MATCH(j:TutorIdentityCredential) WHERE j.revoked=false AND j.status IN ['awaiting_configuration','issuance_pending']
      AND coalesce(j.issuanceNextAttempt,'') <= $at RETURN j.id AS id ORDER BY j.createdAt LIMIT 5`,{at:new Date().toISOString()})).records;
    for(const row of rows){
      const id=row.get('id'),lease=crypto.randomUUID();
      const job=await s.executeWrite(async tx=>{
        const entry=(await tx.run('MATCH(j:TutorIdentityCredential {id:$id}) SET j.issuanceRevision=coalesce(j.issuanceRevision,0)+1 RETURN j',{id})).records[0]?.get('j').properties;
        const now=new Date().toISOString();
        if(!entry || entry.revoked || !['awaiting_configuration','issuance_pending'].includes(entry.status) || (entry.issuanceLeaseUntil && entry.issuanceLeaseUntil>now))return null;
        const u=await lockApplicant(tx,entry.tutorId,true),i=await currentIdentity(tx,entry.tutorId);
        const wallet=u.smartWalletAddress;
        const holder=wallet && typeof wallet==='object' ? wallet.smartAccountAddress||wallet.address : null;
        if(typeof holder!=='string' || i?.id!==id || i.walletPublicationConsent!==true || i.walletConsentVersion!==consentVersion || i.walletConsentAddress!==holder.toLowerCase()){
          await tx.run("MATCH(j:TutorIdentityCredential {id:$id}) SET j.issuanceNextAttempt=$retry,j.issuanceBlockedReason='Wallet publication consent and bound managed wallet required'",{id,retry:new Date(Date.now()+300000).toISOString()});return null;
        }
        const job:IdentityIssuanceJob=entry.issuanceJson?JSON.parse(entry.issuanceJson):{
          id,stage:'ready',binding:{chainId:release.chainId,collection:release.collection,holder:holder.toLowerCase(),mock:release.mode==='pilot'},
          issuer:{issuerAx:release.issuerAx,issuerAy:release.issuerAy},verificationKeySHA256:release.artifacts.vk.sha256,
        };
        await tx.run("MATCH(j:TutorIdentityCredential {id:$id}) SET j.issuanceLease=$lease,j.issuanceLeaseUntil=$until",{id,lease,until:new Date(Date.now()+600000).toISOString()});
        return {job,tutorId:entry.tutorId};
      });
      if(!job)continue;
      const repository={
        eligibility:async(j:IdentityIssuanceJob)=>s.executeRead(async tx=>{
          const u=(await tx.run('MATCH(u:User {id:$id}) RETURN u',{id:job.tutorId})).records[0]?.get('u').properties||{};
          const i=await currentIdentity(tx,job.tutorId);
          const v=(await tx.run('MATCH(v:InterviewSlot {id:$id,tutorId:$tutorId}) RETURN v',{id:i?.interviewId||'',tutorId:job.tutorId})).records[0]?.get('v').properties;
          const entry=(await tx.run('MATCH(j:TutorIdentityCredential {id:$id}) RETURN j',{id})).records[0]?.get('j').properties;
          const w=u.smartWalletAddress,holder=w&&typeof w==='object'?(w.smartAccountAddress||w.address):null;
          return {submissionId:id,currentSubmissionId:i?.id||'',interviewId:entry?.interviewId||'',currentInterviewId:i?.interviewId===u.interviewSlotId?(u.interviewSlotId||''):'',
            status:i?.status||'',adultConfirmed:i?.adultConfirmed===true,interviewResult:v?.result||'',interviewPassed:u.interviewPassed===true,
            identityVerified:u.identityVerified===true,banned:u.identityBanned===true,revoked:entry?.revoked!==false || entry?.status==='cancelled',
            walletPublicationConsent:i?.walletPublicationConsent===true && i.walletConsentVersion===consentVersion && i.walletConsentAddress===j.binding.holder,
            walletBound:typeof holder==='string' && holder.toLowerCase()===j.binding.holder && w.userId===job.tutorId};
        }),
        save:async(j:IdentityIssuanceJob)=>{
          const terminal=['issued','cancelled','reconciliation_required','revocation_required'].includes(j.stage);
          await s.executeWrite(async tx=>{
          const result=await tx.run(`MATCH(j:TutorIdentityCredential {id:$id,issuanceLease:$lease})
            SET j.issuanceJson=$json,j.issuanceStage=$stage,j.issuanceNextAttempt=$retry,j.credentialDisplayStatus=$display,
              j.issuedAt=CASE WHEN $stage='issued' THEN coalesce(j.issuedAt,$at) ELSE j.issuedAt END,
              j.mintTransactionId=$mintId,j.mintTransactionHash=$mintHash,j.proofSubmissionId=$proofId
            WITH j MATCH(i:TutorIdentity {id:j.id}) SET i.credentialStatus=$display RETURN j.id AS id`,
            {id,lease,at:new Date().toISOString(),json:JSON.stringify(j),stage:j.stage,retry:terminal?'9999-01-01T00:00:00.000Z':new Date(Date.now()+15000).toISOString(),
              mintId:j.mintTransactionId||null,mintHash:j.mintTransactionHash||null,proofId:j.proofSubmissionId||null,display:identityCredentialDisplayStatus(j)});
          if(!result.records.length)throw Error('Identity issuance lease lost');
          if(j.stage==='issued')await tx.run(`MERGE(m:TutorIdentityPublicMetadata {id:$id})
            SET m.chainId=$chain,m.mock=$mock,m.submissionId=$submission,m.tokenHex=$hex,m.json=$json`,{
            id:`${j.binding.chainId}:${j.binding.collection.toLowerCase()}:${j.tokenId}`,chain:j.binding.chainId,mock:j.binding.mock,submission:j.id,
            hex:BigInt(j.tokenId!).toString(16).padStart(64,'0'),json:JSON.stringify(j.binding.mock?testIdentityMetadata(j):productionIdentityMetadata(j)),
          });
          });
        },
      };
      try{await advanceIdentityIssuance(job.job,repository,gateway);}
      catch{
        await s.run('MATCH(j:TutorIdentityCredential {id:$id,issuanceLease:$lease}) SET j.issuanceNextAttempt=$retry',
          {id,lease,retry:new Date(Date.now()+300000).toISOString()});
        logger.error('Identity credential processing requires attention');
      }
      finally{await s.run(`MATCH(j:TutorIdentityCredential {id:$id,issuanceLease:$lease}) REMOVE j.issuanceLease,j.issuanceLeaseUntil`,{id,lease});}
    }
  }finally{await s.close();}
}
