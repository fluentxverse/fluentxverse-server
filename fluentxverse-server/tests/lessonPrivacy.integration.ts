import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

// This executable suite only targets the disposable containers documented in the runbook.
if (process.env.LESSON_PRIVACY_TEST !== '1') throw new Error('Set LESSON_PRIVACY_TEST=1 and start the isolated test containers.');
process.env.DATABASE_URL='postgresql://privacy_test:privacy-test@127.0.0.1:5546/privacy_test';
process.env.LESSON_PRIVACY_ENCRYPTION_KEY='ab'.repeat(32);
process.env.LESSON_PRIVACY_SIGNING_KEY=generateKeyPairSync('ed25519').privateKey.export({format:'der',type:'pkcs8'}).toString('base64');
const {initDriver,getDriver,closeDriver}=await import('../src/db/memgraph');
const {query,closePool}=await import('../src/db/postgres');
const {LessonPrivacyService}=await import('../src/services/lessonPrivacy/service');
const {LessonPrivacyCrypto,verifyLessonEvidence}=await import('../src/services/lessonPrivacy/crypto');
const {LessonPrivacyStore}=await import('../src/services/lessonPrivacy/store');
const {createLessonPrivacyRoutes}=await import('../src/routes/lessonPrivacy.route');
const {signAuthToken}=await import('../src/utils/jwt');
const {StudentLessonIssueReportService}=await import('../src/services/studentLessonIssueReport.service');
const {LessonTroubleReportService}=await import('../src/services/lessonTroubleReport.service');
const {default:Elysia}=await import('elysia');
const now=Date.now(),time=(offset:number)=>new Date(now+offset*60000).toISOString();
const prefix=`privacy-${crypto.randomUUID()}`,id=(name:string)=>`${prefix}-${name}`;
let passed=0;
const check=(condition:unknown,label:string)=>{assert.ok(condition,label);passed++;};
const graph=async(text:string,params:Record<string,any>={})=>{const db=getDriver().session();try{return await db.run(text,params);}finally{await db.close();}};
await initDriver('bolt://127.0.0.1:7796','','',1);
try {
  await query(`CREATE TABLE IF NOT EXISTS session_participants (id TEXT PRIMARY KEY,session_id TEXT,user_id TEXT,user_type TEXT,
    socket_id TEXT,joined_at TIMESTAMPTZ,left_at TIMESTAMPTZ,last_seen_at TIMESTAMPTZ,is_active BOOLEAN DEFAULT false)`);
  await graph(`CREATE (:Student {id:$student}),(:Student {id:$other}),(:User {id:$a,displayName:'Previous tutor'}),
    (:User {id:$b,displayName:'Recipient tutor'}),(:User {id:$c,displayName:'Unrelated tutor'}),
    (:Admin {id:$support,role:'admin',permissions:['support']}),(:Admin {id:$finance,role:'admin',permissions:['finance']})`,
    {student:id('student'),other:id('other'),a:id('a'),b:id('b'),c:id('c'),support:id('support'),finance:id('finance')});
  const bookings=[{name:'source',tutor:'a',offset:-120,submitted:true},{name:'target',tutor:'b',offset:120,submitted:false},
    {name:'same-tutor',tutor:'a',offset:180,submitted:false},{name:'foreign',tutor:'c',offset:240,submitted:false},
    {name:'draft',tutor:'a',offset:-90,submitted:false}];
  for(const b of bookings) await graph(`MATCH(s:Student {id:$student}) CREATE (b:Booking {bookingId:$booking,tutorId:$tutor,status:'confirmed',
    durationMinutes:25,slotDateTime:datetime($start),notesSubmittedAt:$submitted,attendanceTutor:'present'})-[:BOOKED_BY]->(s)`,
    {student:id(b.name==='foreign'?'other':'student'),booking:id(b.name),tutor:id(b.tutor),start:time(b.offset),submitted:b.submitted?time(-80):null});
  const service=new LessonPrivacyService(),app=new Elysia().use(createLessonPrivacyRoutes(service));
  const cookies:Record<string,string>={};
  for(const [name,role]of Object.entries({student:'student',other:'student',a:'tutor',b:'tutor',c:'tutor',support:'admin',finance:'admin'}))
    cookies[name]=`${role==='admin'?'adminAuth':`${role}Auth`}=${await signAuthToken({userId:id(name),email:`${name}@test.local`,role})}`;
  const request=async(path:string,actor:string,body?:unknown,method=body===undefined?'GET':'POST')=>app.handle(new Request(`http://localhost/lesson-privacy${path}`,
    {method,headers:{cookie:cookies[actor]||'','content-type':'application/json',origin:'https://student.fluentxverse.com'},body:body===undefined?undefined:JSON.stringify(body)}));
  const json=async(response:Response)=>{const value:any=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value.data;};
  const evidencePath=`/student/${id('source')}/evidence`;
  check((await request(evidencePath,'')).status===401,'unauthenticated evidence rejected');
  check((await request(evidencePath,'a')).status===401,'wrong role rejected');
  for (const path of [`/student/${id('source')}/handover`,`/tutor/${id('target')}/handover`])
    check((await request(path,'student')).status===404,'removed handover read endpoint is unavailable');
  check((await request(`/student/${id('source')}/handover`,'student',{})).status===404,'removed handover creation endpoint is unavailable');
  check((await request('/student/handover/old-grant','student',undefined,'DELETE')).status===404,'removed handover revocation endpoint is unavailable');
  const badOrigin=await app.handle(new Request(`http://localhost/lesson-privacy${evidencePath}`,{method:'POST',headers:{cookie:cookies.student!,'content-type':'application/json',origin:'https://attacker.example'},body:JSON.stringify({fields:['attendance']})}));
  check(badOrigin.status===403,'untrusted browser mutation origin rejected');
  const invalid=await request(evidencePath,'student',{fields:['SECRET-VALIDATION-BODY']});
  check(invalid.status===422,'unsupported evidence fields rejected');
  check(!(await invalid.text()).includes('SECRET-VALIDATION-BODY'),'validation does not reflect private request content');
  check((await request(evidencePath,'other')).status===404,'cross-student evidence read rejected');
  check((await request(`/student/${id('target')}/evidence`,'student',{fields:['attendance']})).status===400,'unfinished lesson evidence rejected');
  for(const role of ['student','tutor']) await query(`INSERT INTO session_participants(id,session_id,user_id,user_type,joined_at,last_seen_at,left_at)
    VALUES($1,$2,$3,$4,$5,$6,$6)`,[id(`presence-${role}`),id('source'),id(role==='student'?'student':'a'),role,time(-120),time(-100)]);
  const evidence=await json(await request(evidencePath,'student',{fields:['attendance','overlap']}));
  check(evidence.envelope.payload.claims.overlap==='threshold_met'&&!evidence.sharedWithSupport,'evidence computed and private by default');
  check(!JSON.stringify(evidence.envelope).includes(id('student'))&&!JSON.stringify(evidence.envelope).includes(id('source')),'export omits participant and booking identifiers');
  check(verifyLessonEvidence(evidence.envelope,service.issuer().publicKey),'signature verifies against configured issuer');
  const saved=(await query('SELECT ciphertext FROM lesson_privacy_records WHERE id=$1',[evidence.id])).rows[0];
  const originalContext=JSON.stringify(['evidence','student',id('student'),id('source'),evidence.id,null]);
  check(JSON.stringify(new LessonPrivacyCrypto().open(saved.ciphertext,originalContext))===JSON.stringify(evidence.envelope),'evidence encryption context remains backward compatible');
  const consentPath=`${evidencePath}/${evidence.id}/support`;
  check((await request(consentPath,'student',{shared:true},'PUT')).status===400,'support sharing requires owned report');
  await new StudentLessonIssueReportService().ensureSchema();await new LessonTroubleReportService().ensureSchema();
  await query(`INSERT INTO student_lesson_issue_reports(id,booking_id,student_id,duration,reason,details) VALUES($1,$2,$3,'over_ten','connection','Private case')`,[id('report'),id('source'),id('student')]);
  const supportPath=`/admin/reports/student/${id('report')}/evidence`;
  check((await json(await request(supportPath,'support'))).length===0,'support sees no unconsented evidence');
  await json(await request(consentPath,'student',{shared:true},'PUT'));
  check((await json(await request(supportPath,'support'))).length===1,'authorized support reads consented snapshot');
  check((await request(supportPath,'finance')).status===403,'finance-only admin cannot read private evidence');
  check((await request(supportPath,'a')).status===401,'participant cannot use admin evidence endpoint');
  check((await request(consentPath,'other',{shared:false},'PUT')).status===404,'another participant cannot revoke evidence');
  await json(await request(consentPath,'student',{shared:false},'PUT'));
  check((await json(await request(supportPath,'support'))).length===0,'revocation immediately stops future support reads');
  await json(await request(consentPath,'student',{shared:true},'PUT'));
  await query(`UPDATE lesson_privacy_records SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1`,[evidence.id]);
  check((await json(await request(supportPath,'support'))).length===0,'expired evidence inaccessible to support');
  const retentionStore=new LessonPrivacyStore();
  await query(`INSERT INTO lesson_privacy_audit(record_id,actor_id,action,created_at) VALUES($1,$2,'test_expired_audit',NOW()-INTERVAL '91 days')`,[evidence.id,id('student')]);
  const removed=await retentionStore.purgeExpired();
  check(removed.snapshots>=1&&removed.auditEvents>=1,'expiry cleanup deletes expired snapshots and old audit events');
  check(!(await query('SELECT id FROM lesson_privacy_records WHERE id=$1',[evidence.id])).rows.length,'expired ciphertext is no longer stored');
  const rows=(await query('SELECT ciphertext FROM lesson_privacy_records WHERE owner_id=$1',[id('student')])).rows;
  check(rows.every((row:any)=>!row.ciphertext.includes('threshold_met')),'stored payloads encrypted');
  const audit=(await query('SELECT action FROM lesson_privacy_audit')).rows.map((r:any)=>r.action);
  check(['evidence_created','support_consented','support_revoked','support_read'].every(action=>audit.includes(action)),'consent and access audited');
  const disabled=new LessonPrivacyService(new LessonPrivacyStore(),new LessonPrivacyCrypto('',''));
  check(!(await disabled.evidenceOptions(id('source'),id('student'),'student')).enabled,'missing keys disable evidence');
  check((await request(evidencePath,'student')).headers.get('cache-control')==='no-store','private responses are not cacheable');
  console.log(`PASS ${passed} real-database privacy and HTTP checks`);
} finally {
  // Only this suite's records are removed; the database and graph are disposable too.
  await query(`DELETE FROM lesson_privacy_audit WHERE actor_id LIKE $1`,[`${prefix}%`]);
  await query(`DELETE FROM lesson_privacy_records WHERE owner_id LIKE $1`,[`${prefix}%`]);
  await query(`DELETE FROM session_participants WHERE id LIKE $1`,[`${prefix}%`]);
  await query(`DELETE FROM student_lesson_issue_reports WHERE id LIKE $1`,[`${prefix}%`]);
  await graph(`MATCH(n) WHERE n.id STARTS WITH $prefix OR n.sessionId STARTS WITH $prefix OR n.bookingId STARTS WITH $prefix DETACH DELETE n`,{prefix});
  await closeDriver();await closePool();
}
