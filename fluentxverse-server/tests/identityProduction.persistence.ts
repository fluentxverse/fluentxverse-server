import { test, expect } from 'bun:test';
import { initDriver,getDriver,closeDriver } from '../src/db/memgraph';
import { ensureTutorIdentitySchema } from '../src/services/tutorIdentity/schema';
import { tutorIdentity } from '../src/services/tutorIdentity/service';
import { publicProductionIdentityMetadata } from '../src/services/tutorIdentity/metadata';
import { identityWalletConsentVersion } from '../src/services/tutorIdentity/production';

test('production consent, public invalidation and manual recovery preserve historical metadata',async()=>{
  if(process.env.IDENTITY_TEST_URI!=='bolt://127.0.0.1:17741')throw Error('Use the dedicated empty identity QA graph.');
  const oldMode=process.env.TUTOR_IDENTITY_ISSUANCE_MODE,oldEnabled=process.env.TUTOR_IDENTITY_ENABLED;
  process.env.TUTOR_IDENTITY_ISSUANCE_MODE='production';process.env.TUTOR_IDENTITY_ENABLED='true';
  await initDriver(process.env.IDENTITY_TEST_URI,'','',1);const s=getDriver().session();let owned=false;
  const holder='0x'+'a'.repeat(40),collection='0x'+'b'.repeat(40),id='1'.padStart(64,'0')+'.json';
  const metadata=()=>publicProductionIdentityMetadata(collection,id);
  try{
    expect(Number((await s.run('MATCH(n) RETURN count(n) AS n')).records[0]!.get('n'))).toBe(0);owned=true;
    await ensureTutorIdentitySchema();
    await s.run(`CREATE(:User {id:'prod-tutor',role:'tutor',identitySubmissionId:'prod-submission',identityVerified:true,interviewPassed:true,
      smartWalletAddress:$wallet}),(:TutorIdentity {id:'prod-submission',tutorId:'prod-tutor',status:'verified',walletPublicationConsent:true,
      walletConsentVersion:'tutor-identity-wallet.v1',walletConsentAddress:$holder}),
      (:TutorIdentityCredential {id:'prod-submission',tutorId:'prod-tutor',revoked:false,status:'awaiting_configuration'})`,
      {holder,wallet:{userId:'prod-tutor',smartAccountAddress:holder}});
    expect((await tutorIdentity.status('prod-tutor')).walletConsentRecorded).toBe(false);
    await expect(tutorIdentity.consentToWallet('prod-tutor','tutor-identity-wallet.v1')).rejects.toThrow('disclosure');
    const version=identityWalletConsentVersion('production');
    expect((await tutorIdentity.consentToWallet('prod-tutor',version)).walletConsentRecorded).toBe(true);
    await s.run(`MATCH(j:TutorIdentityCredential) SET j.issuanceJson='{}',j.issuanceStage='issued'
      CREATE(:TutorIdentityPublicMetadata {id:$id,submissionId:'prod-submission',chainId:42161,mock:false,json:$json})`,
      {id:`42161:${collection}:1`,json:JSON.stringify({properties:{holder},name:'FluentXVerse Tutor Identity'})});
    await expect(tutorIdentity.consentToWallet('prod-tutor',version)).rejects.toThrow('already started');
    expect(JSON.parse((await metadata())!).properties.issuerStatus).toBe('active');
    expect(await publicProductionIdentityMetadata('0x'+'c'.repeat(40),id)).toBeNull();
    await s.run("MATCH(u:User) SET u.smartWalletAddress=$wallet",{wallet:{userId:'prod-tutor',smartAccountAddress:'0x'+'c'.repeat(40)}});
    expect((await tutorIdentity.status('prod-tutor')).walletConsentRecorded).toBe(false);
    expect(JSON.parse((await metadata())!).properties.issuerStatus).toBe('invalidated');
    await s.run('MATCH(u:User) SET u.smartWalletAddress=$wallet',{wallet:{userId:'prod-tutor',smartAccountAddress:holder}});
    await tutorIdentity.review('prod-submission','support','revoke','Synthetic recovery test',true);
    expect(JSON.parse((await metadata())!).properties.issuerStatus).toBe('invalidated');
    expect((await tutorIdentity.status('prod-tutor')).record?.status).toBe('resubmit');
    expect((await s.run('MATCH(m:TutorIdentityPublicMetadata) RETURN count(m) AS n')).records[0]!.get('n').toNumber()).toBe(1);
  }finally{
    if(owned)await s.run('MATCH(n) DETACH DELETE n');await s.close();await closeDriver();
    if(oldMode===undefined)delete process.env.TUTOR_IDENTITY_ISSUANCE_MODE;else process.env.TUTOR_IDENTITY_ISSUANCE_MODE=oldMode;
    if(oldEnabled===undefined)delete process.env.TUTOR_IDENTITY_ENABLED;else process.env.TUTOR_IDENTITY_ENABLED=oldEnabled;
  }
});
