import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { attendanceClaims, selectedFields, type PresenceInterval } from '../src/services/lessonPrivacy/policy';
import { LessonPrivacyCrypto, verifyLessonEvidence } from '../src/services/lessonPrivacy/crypto';
import { evidenceFields } from '../../shared/lessonPrivacy';

const signingKey = () => generateKeyPairSync('ed25519').privateKey.export({format:'der',type:'pkcs8'}).toString('base64');
const start=Date.parse('2026-10-18T01:00:00Z'),end=start+25*60000;
const time=(minutes:number)=>new Date(start+minutes*60000).toISOString();
const interval=(role:'student'|'tutor',from:number,to:number):PresenceInterval=>({role,joinedAt:time(from),lastSeenAt:time(to),leftAt:time(to)});

describe('private lesson policy',()=>{
  test('field selection rejects empty, unknown and duplicate disclosures',()=>{
    for(const value of [[],['audio'],['attendance','attendance'],null,'attendance'])expect(()=>selectedFields(value,evidenceFields)).toThrow();
    expect(selectedFields(['overlap','attendance'],evidenceFields)).toEqual(['attendance','overlap']);
  });
  test('overlapping connections are unioned, clipped to the lesson and not double counted',()=>{
    const rows=[interval('student',-10,10),interval('student',5,14),interval('tutor',0,25)];
    const claims=attendanceClaims(rows,start,end,15,['attendance','overlap'],'completed',null);
    expect(claims).toEqual({attendance:{student:'not_established',tutor:'threshold_met'},overlap:'not_established'});
    rows.push(interval('student',14,30));
    expect(attendanceClaims(rows,start,end,15,['overlap'],'completed',null)).toEqual({overlap:'threshold_met'});
  });
  test('matching duration without simultaneous presence does not establish overlap',()=>{
    expect(attendanceClaims([interval('student',0,10),interval('tutor',10,25)],start,end,10,['attendance','overlap'],'completed',null))
      .toEqual({attendance:{student:'threshold_met',tutor:'threshold_met'},overlap:'not_established'});
  });
  test('missing heartbeats, malformed rows and early disconnects do not invent presence',()=>{
    const rows=[{role:'student' as const,joinedAt:time(0),lastSeenAt:null,leftAt:time(25)},
      {...interval('student',0,25),joinedAt:'invalid'}, {...interval('tutor',0,25),leftAt:time(1)}];
    expect(attendanceClaims(rows,start,end,15,['attendance'],'completed',null))
      .toEqual({attendance:{student:'not_established',tutor:'not_established'}});
    expect(attendanceClaims([],start,end,15,['overlap'],'completed',null)).toEqual({overlap:'not_established'});
  });
  test('cancellation exposes only the selected timing bucket, with unknown provenance preserved',()=>{
    expect(attendanceClaims([],start,end,15,['cancellation'],'cancelled',time(-60))).toEqual({cancellation:'at_least_one_hour_before'});
    expect(attendanceClaims([],start,end,15,['cancellation'],'cancelled',time(-59))).toEqual({cancellation:'less_than_one_hour_before'});
    expect(attendanceClaims([],start,end,15,['cancellation'],'cancelled',null)).toEqual({cancellation:'timing_unknown'});
    expect(attendanceClaims([],start,end,15,['cancellation'],'completed',time(-60))).toEqual({cancellation:'not_cancelled'});
  });
});
describe('private lesson cryptography',()=>{
  test('encryption is randomized and bound to the record and recipient context',()=>{
    const crypto=new LessonPrivacyCrypto('ab'.repeat(32));
    const a=crypto.seal({goal:'Private goal'},'student:booking:tutor'),b=crypto.seal({goal:'Private goal'},'student:booking:tutor');
    expect(a).not.toBe(b);expect(a).not.toContain('Private goal');expect(crypto.open<{goal:string}>(a,'student:booking:tutor')).toEqual({goal:'Private goal'});
    expect(()=>crypto.open(a,'student:booking:other-tutor')).toThrow();
    const changed=Buffer.from(a,'base64');changed[30]=changed[30]!^1;
    expect(()=>crypto.open(changed.toString('base64'),'student:booking:tutor')).toThrow();
  });
  test('missing or malformed keys fail closed',()=>{
    const crypto=new LessonPrivacyCrypto('',signingKey());expect(crypto.encryptionEnabled).toBe(false);expect(crypto.evidenceEnabled).toBe(false);
    expect(()=>crypto.seal({},'record')).toThrow();expect(new LessonPrivacyCrypto('00'.repeat(32),'bad').evidenceEnabled).toBe(false);
  });
  test('signature verifies only with an independently trusted issuer key and unchanged claims',()=>{
    const crypto=new LessonPrivacyCrypto('ab'.repeat(32),signingKey());
    const envelope=crypto.sign({schema:'fluentxverse.lesson-evidence.v1',id:'opaque-id',bookingCommitment:'salted-hash',
      issuedAt:new Date(start).toISOString(),thresholdMinutes:15,source:'platform_room_presence_records',claims:{overlap:'threshold_met'}});
    expect(verifyLessonEvidence(envelope,crypto.issuer().publicKey)).toBe(true);
    expect(verifyLessonEvidence(envelope,new LessonPrivacyCrypto('ab'.repeat(32),signingKey()).issuer().publicKey)).toBe(false);
    expect(verifyLessonEvidence({...envelope,payload:{...envelope.payload,claims:{overlap:'not_established'}}},crypto.issuer().publicKey)).toBe(false);
    expect(verifyLessonEvidence({...envelope,keyId:'fake'},crypto.issuer().publicKey)).toBe(false);
  });
});
