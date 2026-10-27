import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { initDriver, getDriver, closeDriver } from "../src/db/memgraph";
import { tutorCompensationService as rates } from "../src/services/admin.services/tutorCompensation.service";
import { tutorEarningsService as earnings } from "../src/services/admin.services/tutorEarnings.service";
import { tutorPayoutRecoveryService as recovery } from "../src/services/admin.services/tutorPayoutRecovery.service";
import {
  TutorPayoutAuthorizationService,
  payoutEvidenceDigest,
  type PayoutAuthorizationEngine,
  type PayoutProofRelease,
} from "../src/services/admin.services/tutorPayoutAuthorization.service";
import { ClassroomNotesService } from "../src/services/classroomNotes.services/classroomNotes.service";
import { LessonWorkflowService } from "../src/services/lessonWorkflow.service";
import { withLessonAIPrivacy, privateAgent } from "../src/privacy/aiBoundary";
import Elysia from "elysia";
import { signAuthToken } from "../src/utils/jwt";

if (process.env.PAYOUT_PRIVACY_TEST_URI !== "bolt://127.0.0.1:17699")
  throw Error("Use only the empty disposable privacy graph on port 17699");
process.env.JWT_SECRET = "synthetic-privacy-tests-not-production";
const { preparePrivatePayout, payoutPolicyHash } = await import(
  "../../../budol/gmr-engine/scripts/payout-private-authorization.mjs"
);
await initDriver(process.env.PAYOUT_PRIVACY_TEST_URI, "", "", 1);
const db = getDriver().session(),
  seed = randomBytes(32),
  key = randomBytes(32);
let serial = 0;
async function batch() {
  const bookingId = `lesson-${++serial}`;
  await db.run(
    `MATCH (s:Student {id:'student-test'}) CREATE (:Booking {bookingId:$bookingId,tutorId:'tutor-test',status:'completed',
    lessonOutcome:'attended',attendanceTutor:'present',attendanceStudent:'present',finalizedAt:$completed,slotDateTime:datetime($start),durationMinutes:25})-[:BOOKED_BY]->(s)`,
    {
      bookingId,
      completed: new Date(Date.now() - 60000).toISOString(),
      start: new Date(Date.now() - 30 * 60000).toISOString(),
    },
  );
  await earnings.post("tutor-test", bookingId, "finance", "Synthetic approval");
  const reserved = await earnings.reserve(
    "tutor-test",
    {
      requestId: crypto.randomUUID(),
      bookingIds: [bookingId],
      recipient: "0x0000000000000000000000000000000000001234",
      reason: "Synthetic reservation",
    },
    "finance",
  );
  return { bookingId, id: reserved.batch.id as string };
}
class EngineFixture implements PayoutAuthorizationEngine {
  proves = 0;
  submits = 0;
  enabled = true;
  failSubmit = false;
  onProve: () => Promise<void> = async () => {};
  native = false;
  receipt = false;
  release = {} as PayoutProofRelease;
  submissionsEnabled() {
    return this.enabled;
  }
  async ready() {
    return this.release;
  }
  async prove(evidence: any) {
    this.proves++;
    const result = await preparePrivatePayout(evidence, { chainId: 8453, scopeHash: "123" }, seed, key);
    const s = result.publicSignals;
    Object.assign(this.release, { issuerHash: s[2], issuerAx: s[3], issuerAy: s[4] });
    await this.onProve();
    return {
      ...this.release,
      publicSignals: s,
      evidenceDigest: result.evidenceDigest,
      localVerified: true,
      transferEnabled: false,
      proof: { protocol: "groth16", curve: "bn128", pi_a: ["1", "2", "1"] },
    };
  }
  async submit() {
    this.submits++;
    if (this.failSubmit) throw Error("Sensitive transport payload");
    return "engine-submission-" + this.submits;
  }
  async lookup() {
    return { nativeFinalized: this.native, receiptVerified: this.receipt };
  }
}
function fixture() {
  const engine = new EngineFixture();
  engine.release = {
    policyHash: payoutPolicyHash,
    issuerHash: "1",
    issuerAx: "2",
    issuerAy: "3",
    scopeHash: "123",
    releaseManifestSHA256: "a".repeat(64),
    vkHash: "0x" + "b".repeat(64),
    verificationNetwork: "zkVerify",
    chainId: 8453,
    domainId: 2,
    bridge: "0xCb47A3C3B9Eb2E549a3F2EA4729De28CafbB2b69",
    vk: { synthetic: true },
    cryptographicSetupVerified: true,
    releasePolicy: "independent-reviewed",
    independentlyReviewed: true,
    independentContributors: true,
  };
  return { engine, service: new TutorPayoutAuthorizationService(engine) };
}
const count = async (query: string) => (await db.run(query)).records[0]!.get("n").toNumber();
try {
  assert.equal(await count("MATCH(n) RETURN count(n) AS n"), 0);
  await db.run(`CREATE (:User {id:'tutor-test'}),(:Student {id:'student-test',firstName:'Alice',lastName:'Tanaka',email:'alice@example.test'}),
    (:Admin {id:'finance',role:'admin',permissions:['finance']}),(:Admin {id:'support',role:'admin',permissions:['support']})`);
  const rate = await rates.save(
    "tutor-test",
    {
      currency: "USD",
      amount: "12.34",
      expectedVersion: 0,
      requestId: crypto.randomUUID(),
      reason: "Synthetic rate",
    },
    "finance",
  );
  await db.run("MATCH (h:TutorRateChange {id:$id}) SET h.changedAt=$at", {
    id: rate.change.id,
    at: new Date(Date.now() - 86400000).toISOString(),
  });
  const first = await batch(),
    { engine, service } = fixture();
  const generated = await service.generate("tutor-test", first.id, "finance", {});
  assert.equal(generated.authorization?.phase, "locally_proved");
  assert.equal(generated.currentlyEligible, true);
  assert.equal(generated.transferEnabled, false);
  assert(!JSON.stringify(generated).includes("proofJson"));
  assert(!JSON.stringify(generated).includes("signalsJson"));
  await service.generate("tutor-test", first.id, "finance", {});
  assert.equal(engine.proves, 1);
  await assert.rejects(service.generate("tutor-test", first.id, "support", {}), /Finance/);
  await assert.rejects(
    service.generate("tutor-test", first.id, "finance", { zkVerified: true }),
    /accepts no/,
  );
  engine.enabled = false;
  await assert.rejects(service.submit("tutor-test", first.id, "finance", {}), /disabled/);
  assert.equal(
    (await service.detail("tutor-test", first.id, "finance")).authorization?.phase,
    "locally_proved",
  );
  engine.enabled = true;
  await service.submit("tutor-test", first.id, "finance", {});
  await assert.rejects(service.submit("tutor-test", first.id, "finance", {}), /Do not resend/);
  assert.equal(engine.submits, 1);
  engine.native = true;
  assert.equal(
    (await service.reconcile("tutor-test", first.id, "finance", {})).authorization?.phase,
    "native_finalized",
  );
  engine.receipt = true;
  assert.equal(
    (await service.reconcile("tutor-test", first.id, "finance", {})).authorization?.phase,
    "receipt_verified",
  );
  await db.run("MATCH (b:Booking {bookingId:$id}) SET b.refunded=true", { id: first.bookingId });
  assert.equal((await service.reconcile("tutor-test", first.id, "finance", {})).currentlyEligible, false);
  assert.equal(await count("MATCH (e:TutorEarning {status:'paid'}) RETURN count(e) AS n"), 0);
  const refundRace = await batch(),
    raced = fixture();
  raced.engine.onProve = async () => {
    await db.run("MATCH (b:Booking {bookingId:$id}) SET b.refundStatus='pending'", {
      id: refundRace.bookingId,
    });
  };
  await assert.rejects(raced.service.generate("tutor-test", refundRace.id, "finance", {}), /not accepted/);
  assert.equal(
    (await raced.service.detail("tutor-test", refundRace.id, "finance")).authorization?.phase,
    "review",
  );
  const concurrent = await batch(),
    parallel = fixture();
  await Promise.allSettled([
    parallel.service.generate("tutor-test", concurrent.id, "finance", {}),
    parallel.service.generate("tutor-test", concurrent.id, "finance", {}),
  ]);
  assert.equal(parallel.engine.proves, 1);
  const lost = await batch(),
    lostResponse = fixture();
  await lostResponse.service.generate("tutor-test", lost.id, "finance", {});
  lostResponse.engine.failSubmit = true;
  await assert.rejects(
    lostResponse.service.submit("tutor-test", lost.id, "finance", {}),
    /requires Engine review/,
  );
  await assert.rejects(lostResponse.service.submit("tutor-test", lost.id, "finance", {}), /Do not resend/);
  assert.equal(lostResponse.engine.submits, 1);
  const cancelled = await batch(),
    cancelledProof = fixture();
  await cancelledProof.service.generate("tutor-test", cancelled.id, "finance", {});
  await recovery.cancel("tutor-test", cancelled.id, "finance", {
    requestId: crypto.randomUUID(),
    reason: "Synthetic cancellation",
  });
  assert.equal(
    (await cancelledProof.service.detail("tutor-test", cancelled.id, "finance")).currentlyEligible,
    false,
  );
  await assert.rejects(
    cancelledProof.service.submit("tutor-test", cancelled.id, "finance", {}),
    /unavailable/,
  );
  const tampered = await batch(),
    bad = fixture(),
    original = bad.engine.prove.bind(bad.engine);
  bad.engine.prove = async (e: any) => ({ ...(await original(e)), evidenceDigest: "f".repeat(64) });
  await assert.rejects(bad.service.generate("tutor-test", tampered.id, "finance", {}), /not accepted/);

  const noteBooking = await batch(),
    notes = new ClassroomNotesService(),
    workflow = new LessonWorkflowService();
  const feedback =
    "The student used the past tense accurately and practiced clear questions during this lesson. Continue reviewing the new vocabulary.";
  await notes.saveLessonNotes(noteBooking.bookingId, "tutor-test", feedback, "Review past tense next time.");
  for (const value of [
    "Alice practiced well.",
    "alice@example.test",
    "123 Main Street",
    "Student ID: student-test",
    "A<b>li</b>ce",
  ]) {
    await assert.rejects(
      notes.saveLessonNotes(noteBooking.bookingId, "tutor-test", feedback, value),
      /Remove student names/,
    );
    assert.equal(
      (await notes.getLessonNotes(noteBooking.bookingId, "tutor-test"))?.tutorMemo,
      "Review past tense next time.",
    );
  }
  const material = {
    sessionId: noteBooking.bookingId,
    tutorId: "tutor-test",
    studentId: "student-test",
    materialType: "daily-dispatch",
    materialId: "article",
    materialTitle: "Science article",
    isUsed: true,
    vocabularyItems: [],
    grammarItems: [],
    pronunciationItems: [],
  };
  await notes.saveNotes(material);
  await assert.rejects(
    notes.saveNotes({
      ...material,
      grammarItems: [
        { id: "grammar", youSaid: "Alice is at school.", correct: "The student is at school." },
      ] as any,
    }),
    /Remove student names/,
  );
  await db.run("MATCH (n:ClassroomMaterialNote {sessionId:$id}) SET n.materialTitle='Alice private lesson'", {
    id: noteBooking.bookingId,
  });
  await assert.rejects(workflow.submit(noteBooking.bookingId, "tutor-test"), /Remove student names/);
  assert.equal(await count("MATCH (n:PublishedLessonNotes) RETURN count(n) AS n"), 0);
  const agent = privateAgent({ generate: async (value: string) => value });
  assert.equal(
    await withLessonAIPrivacy(noteBooking.bookingId, "tutor-test", () =>
      agent.generate("Alice can email alice@example.test"),
    ),
    "[PRIVATE] can email [PRIVATE]",
  );
  await assert.rejects(
    withLessonAIPrivacy(noteBooking.bookingId, "not-the-tutor", () => agent.generate("Alice")),
    /access unavailable/,
  );
  await assert.rejects(
    withLessonAIPrivacy(undefined, "tutor-test", () => agent.generate("Alice")),
    /access unavailable/,
  );
  const { tutorEarningsRoute } = await import("../src/routes/tutorEarnings.route");
  const app = new Elysia().use(tutorEarningsRoute);
  const request = async (actor: string, origin: string, body: unknown) =>
    app.handle(
      new Request(
        `http://localhost/admin/operations/compensation/tutor-test/payouts/${noteBooking.id}/authorization`,
        {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            cookie: `adminAuth=${await signAuthToken({ userId: actor, email: "fixture@example.test", role: "admin" })}`,
          },
          body: JSON.stringify(body),
        },
      ),
    );
  assert.equal((await request("support", "https://dashboard.fluentxverse.com", {})).status, 403);
  assert.equal((await request("finance", "https://evil.test", {})).status, 403);
  assert.equal(
    (await request("finance", "https://dashboard.fluentxverse.com", { zkVerified: true })).status,
    400,
  );
  assert.equal(payoutEvidenceDigest({ a: 1, b: 2 }), payoutEvidenceDigest({ b: 2, a: 1 }));
  console.log(
    "PASS Memgraph privacy/payout workflow: note rejection and rollback, final submission validation, owned AI context, finance/origin guards, duplicate generation, refund race, disabled submission, response loss, cancellation, native/receipt states and zero paid earnings. Engine/native outcomes simulated; circuit proved separately.",
  );
} finally {
  seed.fill(0);
  key.fill(0);
  await db.close();
  await closeDriver();
}
