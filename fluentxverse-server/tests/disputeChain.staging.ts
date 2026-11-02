import assert from "node:assert/strict";
import { initDriver, getDriver, closeDriver } from "../src/db/memgraph";
import { StudentDisputeService } from "../src/services/studentDispute.service";
import { CancellationRefundService } from "../src/services/ticket.services/cancellationRefund.service";
import { disputeEvents, DISPUTE_POLICY_HASH } from "../src/services/disputeChain/outbox";
import { signAuthToken } from "../src/utils/jwt";
import { createHash } from "node:crypto";
import { lessonIssueImageStorage } from "../src/services/lessonIssueImages";

if (process.env.MEMGRAPH_URI !== "bolt://graph:7687" || process.env.REFUND_TRANSFERS_DISABLED !== "true" ||
  process.env.DISPUTE_CHAIN_CAPTURE !== "true" || process.env.GMR_ENGINE_API_KEY)
  throw Error("Isolated dispute staging with live transfers disabled required");
await initDriver(process.env.MEMGRAPH_URI, "", "");
const db = getDriver().session();
try {
  const suffix = crypto.randomUUID(), student = "chain-pilot-student-" + suffix,
    tutor = "chain-pilot-tutor-" + suffix, admin = "chain-pilot-staff-" + suffix,
    bookingId = "chain-pilot-lesson-" + suffix;
  await db.run(`CREATE(s:Student {id:$student}),(:User {id:$tutor}),(:Admin {id:$admin,role:'admin'}),
    (b:Booking {bookingId:$bookingId,studentId:$student,tutorId:$tutor,status:'completed',paymentMethod:'trial',
      testFixture:'dispute-chain-staging',attendanceSource:'admin',attendanceTutor:'present',
      slotDateTime:datetime($start),durationMinutes:25})-[:BOOKED_BY]->(s)
    CREATE(b)-[:BOOKS]->(:TimeSlot {slotId:$bookingId,status:'booked'})`, {
    student, tutor, admin, bookingId, start: new Date(Math.floor((Date.now() - 1800000)/1000)*1000).toISOString(),
  });
  const service = new StudentDisputeService();
  const report = await service.create(bookingId, student, "tutor", "Synthetic private staging report", "late_join");
  assert(report);
  await service.reconcile();
  const tutorToken = await signAuthToken({userId:tutor,role:"tutor",email:"synthetic@example.invalid"});
  const png = Bun.spawnSync(["ffmpeg","-v","error","-f","lavfi","-i","color=c=blue:s=16x16","-frames:v","1","-threads","1","-f","image2pipe","-c:v","png","pipe:1"]);
  assert.equal(png.exitCode,0);
  const form = new FormData();
  form.set("text","Synthetic explanation for staff");form.set("duration","over_ten");form.set("reason","connection");
  form.append("images",new File([png.stdout],"synthetic.png",{type:"image/png"}));
  const submitted=await fetch(`http://127.0.0.1:8765/inbox/disputes/${report.id}/images?as=tutor`,{
    method:"POST",headers:{cookie:`tutorAuth=${tutorToken}`,origin:"https://tutor.fluentxverse.com"},body:form,
  });
  assert.equal(submitted.status,200,await submitted.text());
  const reply=(await db.run("MATCH(t:LessonIssueThread {id:$id})-[:HAS_REPLY]->(r:LessonIssueReply {role:'tutor'}) RETURN r.attachmentsJson AS json",{id:report.id})).records[0]!.get("json");
  const attachment=JSON.parse(reply)[0];assert.match(attachment.sha256,/^[a-f0-9]{64}$/);
  const url=`http://127.0.0.1:8765/inbox/disputes/${report.id}/images/${attachment.id}?as=tutor`;
  const original=await lessonIssueImageStorage.get(attachment.id);
  assert.equal(createHash("sha256").update(original).digest("hex"),attachment.sha256);
  assert.equal((await fetch(url,{headers:{cookie:`tutorAuth=${tutorToken}`}})).status,200);
  try {
    await lessonIssueImageStorage.put(attachment.id,Buffer.from("synthetic corruption test"));
    assert.equal((await fetch(url,{headers:{cookie:`tutorAuth=${tutorToken}`}})).status,503);
  } finally { await lessonIssueImageStorage.put(attachment.id,original); }
  await service.decide(report.id, admin, "no_penalty", "Synthetic staff decision; refund without tutor penalty", 0, true);
  await new CancellationRefundService().process(bookingId);
  await new CancellationRefundService().process(bookingId);
  const thread = (await db.run("MATCH(t:LessonIssueThread {id:$id}) RETURN t", {id:report.id})).records[0]!.get("t").properties;
  const events = (await disputeEvents(0)).filter(e => e.caseKey === thread.chainKey);
  assert.deepEqual(events.map(e=>e.kind),["open","request","response","staff","refund"]);
  assert.equal(JSON.stringify(events).includes("Synthetic explanation"),false);
  for (const role of ["student","tutor"] as const)
    assert.equal(JSON.stringify(await service.list({id:role==="student"?student:tutor,role})).includes("chainSalt"),false);
  const unauth = await fetch("http://127.0.0.1:8765/internal/dispute-chain/events");
  assert.equal(unauth.status,404);
  const auth = await fetch("http://127.0.0.1:8765/internal/dispute-chain/events", {headers:{"X-FXV-Dispute-Feed-Key":process.env.DISPUTE_CHAIN_FEED_KEY!}});
  assert.equal(auth.status,200);
  const page = await auth.json() as {policyHash:string;events:unknown[]};
  assert.equal(page.policyHash,DISPUTE_POLICY_HASH);
  console.log(JSON.stringify({stagingCase:report.id,events:events.length,refundEvents:events.filter(e=>e.kind==="refund").length,
    policyHash:DISPUTE_POLICY_HASH,liveTransfers:false,privateEvidenceExported:false,imageContentIntegrityVerified:true,feedThroughSequence:events.at(-1).sequence}));
} finally { await db.close(); await closeDriver(); }
