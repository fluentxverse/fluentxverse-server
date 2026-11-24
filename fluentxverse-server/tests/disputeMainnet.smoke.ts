// Explicitly scoped operator test. Never import/run as part of the regular suite.
import assert from 'node:assert/strict';
import { initDriver,getDriver,closeDriver } from '../src/db/memgraph';
import { StudentDisputeService } from '../src/services/studentDispute.service';
import { signAuthToken } from '../src/utils/jwt';
if(process.env.DISPUTE_CHAIN_CAPTURE!=='true'||process.env.NODE_ENV!=='production')throw Error('Production dispute capture must be active');
await initDriver(process.env.MEMGRAPH_URI!,process.env.MEMGRAPH_USER||'',process.env.MEMGRAPH_PASSWORD||'',1);
const s=getDriver().session(),fixture='dispute-mainnet-synthetic-20261103';
try {
 if((await s.run('MATCH(b:SyntheticDisputeBooking {testFixture:$fixture}) RETURN b.bookingId AS id',{fixture})).records.length)throw Error('This synthetic fixture has completed and is archived. Use its saved verification record; do not generate another case.');
 const existing=(await s.run('MATCH(b:Booking {testFixture:$fixture}) RETURN b',{fixture})).records[0];
 let bookingId:string,student:string,tutor:string,staff:string;
 if(existing){const b=existing.get('b').properties;({bookingId,studentId:student,tutorId:tutor,smokeStaffId:staff}=b);}
 else{
  const suffix=crypto.randomUUID();bookingId='synthetic-mainnet-'+suffix;student='synthetic-student-'+suffix;tutor='synthetic-tutor-'+suffix;
  staff=(await s.run("MATCH(a:Admin {role:'superadmin'}) RETURN a.id AS id LIMIT 1")).records[0]!.get('id');
  await s.run(`CREATE(s:Student {id:$student,givenName:'Synthetic',familyName:'Mainnet Test'}),(:User {id:$tutor,firstName:'Synthetic',lastName:'Mainnet Test'}),
   (b:Booking {bookingId:$bookingId,studentId:$student,tutorId:$tutor,status:'completed',paymentMethod:'trial',testFixture:$fixture,smokeStaffId:$staff,
    attendanceSource:'admin',attendanceTutor:'present',attendanceStudent:'present',slotDateTime:datetime($start),durationMinutes:25})-[:BOOKED_BY]->(s)
   CREATE(b)-[:BOOKS]->(:TimeSlot {slotId:$bookingId,status:'booked',testFixture:$fixture})`,{student,tutor,bookingId,fixture,staff,start:new Date(Date.now()-3600000).toISOString()});
 }
 const service=new StudentDisputeService();
 let thread=(await s.run("MATCH(t:LessonIssueThread {bookingId:$bookingId,origin:'student'}) RETURN t",{bookingId})).records[0]?.get('t').properties;
 if(!thread){await service.create(bookingId,student,'tutor','Synthetic mainnet integration check. No real lesson or allegation.','inappropriate_behavior');thread=(await s.run('MATCH(t:LessonIssueThread {bookingId:$bookingId}) RETURN t',{bookingId})).records[0]!.get('t').properties;}
 assert(thread.chainKey&&thread.chainVersion===1);
 const tokens={student:await signAuthToken({userId:student,email:'',role:'student'},120),tutor:await signAuthToken({userId:tutor,email:'',role:'tutor'},120),admin:await signAuthToken({userId:staff,email:'',role:'superadmin'},120)};
 const request=async(path:string,role:keyof typeof tokens,method='GET',body?:unknown)=>{
  const r=await fetch('http://127.0.0.1:8765/inbox/disputes/'+path+(path.includes('?')?'&':'?')+'as='+role,{method,headers:{cookie:`${role}Auth=${tokens[role]}`,origin:`https://${role==='admin'?'dashboard':role}.fluentxverse.com`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  return {status:r.status,body:await r.json() as any};
 };
 const list=await request('','student');assert.equal(list.status,200);assert(!JSON.stringify(list.body).includes('chainSalt'));assert(!JSON.stringify(list.body).includes('chainKey'));
 const denied=await request(thread.id+'/decision','student','POST',{decision:'no_penalty',reason:'Synthetic unauthorized attempt',revision:0,refund:false});assert.equal(denied.status,403);
 const before=await s.run('MATCH(e:DisputeChainEvent) RETURN count(e) AS n');
 if(thread.state==='staff_initial'){
  const decision=await request(thread.id+'/decision','admin','POST',{decision:'no_penalty',reason:'Synthetic mainnet test closed. No real participant, no refund, no penalty.',revision:Number(thread.decisionRevision||0),refund:false});
  assert.equal(decision.status,200,JSON.stringify(decision.body));assert.equal(decision.body.success,true);
 }
 const t=(await s.run('MATCH(t:LessonIssueThread {id:$id}) RETURN t',{id:thread.id})).records[0]!.get('t').properties;
 assert.equal(t.state,'no_penalty');
 const events=(await s.run('MATCH(t:LessonIssueThread {id:$id})-[:HAS_CHAIN_EVENT]->(e:DisputeChainEvent) RETURN e.json AS json ORDER BY e.sequence',{id:t.id})).records.map(r=>JSON.parse(r.get('json')));
 assert.deepEqual(events.map(e=>e.kind),['open','staff']);
 assert.equal(await service.create(bookingId,student,'tutor','Duplicate synthetic report must not create a second case.','inappropriate_behavior'),null);
 assert.equal(Number((await s.run('MATCH(t:LessonIssueThread {id:$id})-[:HAS_CHAIN_EVENT]->(e:DisputeChainEvent) RETURN count(e) AS n',{id:t.id})).records[0]!.get('n')),2);
 assert(events.every(e=>!JSON.stringify(e).includes('Synthetic')));
 const b=(await s.run('MATCH(b:Booking {bookingId:$bookingId}) RETURN b',{bookingId})).records[0]!.get('b').properties;
 assert.equal(b.disputeHold,false);assert(!b.refundApprovedBy);assert(!b.penaltyCode);
 assert.equal((await fetch('http://127.0.0.1:8765/internal/dispute-chain/events')).status,404);
 console.log(JSON.stringify({synthetic:true,bookingId,caseId:t.id,caseKey:t.chainKey,eventCount:events.length,kinds:events.map(e=>e.kind),state:t.state,duplicateCaseRejected:true,unauthorizedDecisionRejected:true,publicFeedRejected:true,privateEvidenceExcluded:true,realRefunds:0,realPenalties:0}));
}finally{await s.close();await closeDriver();}
