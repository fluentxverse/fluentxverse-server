import { createHash } from "node:crypto";
import type { ManagedTransaction } from "neo4j-driver";
import { getDriver } from "../../db/memgraph";
import { plainNode } from "../../utils/adminOperations";
import {
  compensationTutorId,
  ensureCompensationSchema,
  TutorCompensationError,
} from "./tutorCompensation.service";
import { finance, financialFailure, lockTutor, reservedPayoutEvidence } from "./tutorEarnings.service";
import { payoutReconciliationRequest } from "./tutorPayoutRecovery.service";
import { assertContributedGroth16Key } from "../proof.services/groth16KeySafety";

export const PAYOUT_AUTHORIZATION_PROTOCOL = "fluentxverse.payout-authorization.v2";
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const policyHash = String(
  BigInt(
    "0x" +
      createHash("sha256")
        .update(PAYOUT_AUTHORIZATION_PROTOCOL + ":fluentxverse.usd-earnings.v1.zero-fee")
        .digest("hex"),
  ) % FIELD,
);
const canonical = (value: any): string =>
  JSON.stringify(
    value && typeof value === "object"
      ? Array.isArray(value)
        ? value.map((v) => JSON.parse(canonical(v)))
        : Object.fromEntries(
            Object.keys(value)
              .filter((k) => value[k] !== undefined)
              .sort()
              .map((k) => [k, JSON.parse(canonical(value[k]))]),
          )
      : value,
  );
export const payoutEvidenceDigest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
type Evidence = Awaited<ReturnType<typeof reservedPayoutEvidence>>;
// Operational lock counters and free-form financial comments are not proving evidence.
export function payoutAuthorizationEvidence(e: Evidence): Evidence {
  const pick = (value: Record<string, any>, keys: string[]) =>
    Object.fromEntries(keys.map((k) => [k, value[k]]).filter(([, v]) => v !== undefined));
  return {
    protocol: e.protocol,
    zkVerified: false,
    transferEnabled: false,
    batch: pick(e.batch, [
      "id",
      "tutorId",
      "approvedBy",
      "policy",
      "currency",
      "status",
      "recipient",
      "totalCents",
      "feeCents",
      "bookingIdsJson",
      "createdAt",
      "expiresAt",
    ]),
    earnings: e.earnings.map((item) =>
      pick(item, [
        "bookingId",
        "tutorId",
        "status",
        "approvedBy",
        "policy",
        "currency",
        "units",
        "feeCents",
        "grossCents",
        "netCents",
        "rateVersion",
        "completionAt",
      ]),
    ),
  };
}
export interface PayoutProofRelease {
  releaseManifestSHA256: string;
  vkHash: string;
  policyHash: string;
  issuerHash: string;
  issuerAx: string;
  issuerAy: string;
  scopeHash: string;
  chainId: number;
  domainId: number;
  bridge: string;
  verificationNetwork: string;
  vk: any;
  cryptographicSetupVerified: boolean;
  releasePolicy: string;
  independentlyReviewed: boolean;
  independentContributors: boolean;
}
export interface PayoutAuthorizationEngine {
  submissionsEnabled(): boolean;
  ready(): Promise<PayoutProofRelease>;
  prove(evidence: Evidence): Promise<any>;
  submit(record: Record<string, any>, release: PayoutProofRelease): Promise<string>;
  lookup(
    id: string,
    record: Record<string, any>,
  ): Promise<{ nativeFinalized: boolean; receiptVerified: boolean }>;
}
const blocked = () =>
  new TutorCompensationError(
    503,
    "Approved private payout proving release is unavailable. Transfers remain disabled.",
  );
async function engineRequest(path: string, body?: unknown, timeout = 10000) {
  const base = (process.env.GMR_PAYOUT_ENGINE_API_BASE || "").replace(/\/$/, ""),
    key = process.env.GMR_PAYOUT_ENGINE_API_KEY || "";
  if (!base || !key) throw blocked();
  const url = new URL(base);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        [
          "localhost",
          "127.0.0.1",
          "[::1]",
          "gmr-engine",
          "budol-gmr-engine-1",
          "host.docker.internal",
        ].includes(url.hostname))
    )
  )
    throw blocked();
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-GMR-Engine-Key": key },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
    redirect: "error",
  });
  if (!response.ok || !response.body) throw blocked();
  const reader = response.body.getReader(),
    parts: Uint8Array[] = [];
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > 65536) {
        await reader.cancel();
        throw blocked();
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(parts).toString());
}
export function validatePayoutProofRelease(r: PayoutProofRelease) {
  const mainnet = process.env.PAYOUT_VERIFICATION_NETWORK === "zkVerify",
    chain = Number(process.env.PAYOUT_CHAIN_ID);
  if (
    process.env.PAYOUT_ARTIFACTS_APPROVED !== "true" ||
    !r ||
    r.cryptographicSetupVerified !== true ||
    r.policyHash !== policyHash ||
    r.releaseManifestSHA256 !== process.env.PAYOUT_RELEASE_MANIFEST_SHA256 ||
    !/^[a-f0-9]{64}$/.test(r.releaseManifestSHA256) ||
    r.vkHash?.toLowerCase() !== process.env.PAYOUT_ZKVERIFY_VK_HASH?.toLowerCase() ||
    !/^0x[0-9a-f]{64}$/i.test(r.vkHash) ||
    r.issuerHash !== process.env.PAYOUT_ISSUER_HASH ||
    r.scopeHash !== process.env.PAYOUT_SCOPE_HASH ||
    r.chainId !== chain ||
    r.domainId !== Number(process.env.PAYOUT_ZKVERIFY_DOMAIN_ID) ||
    r.domainId !== 2 ||
    r.verificationNetwork !== process.env.PAYOUT_VERIFICATION_NETWORK ||
    !((mainnet && chain === 8453) || (!mainnet && chain === 84532 && r.verificationNetwork === "Volta")) ||
    r.bridge?.toLowerCase() !==
      (mainnet
        ? "0xcb47a3c3b9eb2e549a3f2ea4729de28cafbb2b69"
        : "0x0807c544d38ae7729f8798388d89be6502a1e8a8") ||
    r.releasePolicy !== (process.env.PAYOUT_RELEASE_POLICY || "independent-reviewed") ||
    !["self-operated", "independent-reviewed"].includes(r.releasePolicy) ||
    r.independentlyReviewed !== (r.releasePolicy === "independent-reviewed") ||
    r.independentContributors !== (r.releasePolicy === "independent-reviewed") ||
    [r.issuerHash, r.issuerAx, r.issuerAy, r.scopeHash].some(
      (v) => typeof v !== "string" || !/^[1-9]\d{0,76}$/.test(v) || BigInt(v) >= FIELD,
    ) ||
    r.vk?.protocol !== "groth16" ||
    r.vk?.curve !== "bn128" ||
    r.vk?.nPublic !== 20 ||
    r.vk?.IC?.length !== 21
  )
    throw blocked();
  assertContributedGroth16Key(r.vk);
  return r;
}
export function validatePayoutAuthorization(
  result: any,
  evidence: Evidence,
  release: PayoutProofRelease,
  now = Date.now(),
) {
  const s = result?.publicSignals;
  if (
    result?.transferEnabled !== false ||
    result.localVerified !== true ||
    result.evidenceDigest !== payoutEvidenceDigest(evidence) ||
    result.releaseManifestSHA256 !== release.releaseManifestSHA256 ||
    result.vkHash?.toLowerCase() !== release.vkHash.toLowerCase() ||
    !Array.isArray(s) ||
    s.length !== 20 ||
    s.some((v) => typeof v !== "string" || !/^(0|[1-9]\d{0,76})$/.test(v) || BigInt(v) >= FIELD) ||
    !result.proof ||
    result.proof.protocol !== "groth16" ||
    result.proof.curve !== "bn128"
  )
    throw new TutorCompensationError(409, "Engine payout statement differs from the reserved evidence.");
  const expected = [
    "1",
    release.policyHash,
    release.issuerHash,
    release.issuerAx,
    release.issuerAy,
    String(release.chainId),
    "840",
    release.scopeHash,
  ];
  const issued = Math.floor(Date.parse(evidence.batch.createdAt) / 1000),
    expiry = issued + 3600;
  if (
    expected.some((v, i) => s[i] !== v) ||
    s[14] !== String(issued) ||
    s[15] !== String(expiry) ||
    expiry <= Math.floor(now / 1000) ||
    s.slice(8, 14).some((v) => v === "0") ||
    s.slice(16, 16 + evidence.earnings.length).some((v) => v === "0") ||
    s.slice(16 + evidence.earnings.length).some((v) => v !== "0") ||
    new Set(s.slice(16, 16 + evidence.earnings.length)).size !== evidence.earnings.length
  )
    throw new TutorCompensationError(409, "Engine payout binding, nullifiers or lifetime differ.");
  return s as string[];
}
const liveEngine: PayoutAuthorizationEngine = {
  submissionsEnabled: () => process.env.PAYOUT_PROOF_SUBMISSIONS_ENABLED === "true",
  async ready() {
    const response = await engineRequest("/v1/payouts/prover");
    if (response.ready !== true) throw blocked();
    return validatePayoutProofRelease(response.release);
  },
  prove: (evidence) => engineRequest("/v1/payouts/authorizations", { evidence }, 250000),
  async submit(record, release) {
    if (process.env.PAYOUT_PROOF_SUBMISSIONS_ENABLED !== "true")
      throw new TutorCompensationError(503, "Paid zkVerify submissions are disabled.");
    const response = await engineRequest(
      "/v1/zkverify/proofs",
      {
        proof: JSON.parse(record.proofJson),
        publicSignals: JSON.parse(record.signalsJson),
        vk: release.vk,
        domainId: release.domainId,
        proofSystem: "groth16",
        curve: "bn128",
        expectedNetwork: release.verificationNetwork,
      },
      300000,
    );
    const s = response.submission;
    if (!s || s.zkVerifyNetwork !== release.verificationNetwork || !/^[a-zA-Z0-9_-]{1,128}$/.test(s.id || ""))
      throw blocked();
    return s.id;
  },
  async lookup(id, record) {
    const { submission: s } = await engineRequest("/v1/zkverify/proofs/" + encodeURIComponent(id));
    if (
      s?.id !== id ||
      s.zkVerifyNetwork !== record.verificationNetwork ||
      s.domainId !== record.domainId ||
      s.proofSystem !== "groth16" ||
      payoutEvidenceDigest(JSON.parse(s.vk)) !== record.vkDigest ||
      canonical(JSON.parse(s.publicSignals)) !== canonical(JSON.parse(record.signalsJson)) ||
      canonical(JSON.parse(s.proof)) !== canonical(JSON.parse(record.proofJson))
    )
      throw blocked();
    if (s.status !== "finalized") return { nativeFinalized: false, receiptVerified: false };
    const { receipt } = await engineRequest(
      "/v1/zkverify/proofs/" + encodeURIComponent(id) + "/receipt",
      undefined,
      90000,
    );
    if (
      receipt?.verifiedOnZkVerify !== true ||
      receipt.chainId !== record.chainId ||
      receipt.domainId !== record.domainId
    )
      throw blocked();
    return {
      nativeFinalized: true,
      receiptVerified: receipt.verifiedOnBase === true && receipt.status === "base_finalized",
    };
  },
};
function view(record: Record<string, any> | null, valid: boolean) {
  if (!record) return { authorization: null, currentlyEligible: valid, transferEnabled: false };
  const { proofJson, signalsJson, ...summary } = record;
  return { authorization: summary, currentlyEligible: valid, transferEnabled: false };
}
export class TutorPayoutAuthorizationService {
  constructor(
    private readonly engine: PayoutAuthorizationEngine = liveEngine,
    private readonly clock = Date.now,
  ) {}
  private async transaction<T>(
    tutorId: string,
    batchId: string,
    actorId: string,
    work: (tx: ManagedTransaction, record: Record<string, any> | null) => Promise<T>,
  ) {
    compensationTutorId(tutorId);
    compensationTutorId(batchId);
    await ensureCompensationSchema();
    const session = getDriver().session();
    try {
      return await session.executeWrite(async (tx) => {
        await finance(tx, actorId);
        await lockTutor(tx, tutorId);
        const batch = await tx.run(
          "MATCH (p:TutorPayoutBatch {id:$batchId,tutorId:$tutorId}) SET p.writeRevision=coalesce(p.writeRevision,0)+1 RETURN p",
          { batchId, tutorId },
        );
        if (!batch.records.length) throw new TutorCompensationError(404, "Tutor payout not found.");
        const row = (
          await tx.run("MATCH (a:TutorPayoutAuthorization {batchId:$batchId,tutorId:$tutorId}) RETURN a", {
            batchId,
            tutorId,
          })
        ).records[0];
        return work(tx, row ? plainNode(row.get("a").properties) : null);
      });
    } catch (e) {
      return financialFailure(e);
    } finally {
      await session.close();
    }
  }
  async readiness() {
    try {
      const r = await this.engine.ready();
      return {
        ready: true,
        chainId: r.chainId,
        verificationNetwork: r.verificationNetwork,
        releasePolicy: r.releasePolicy,
        submissionsEnabled: this.engine.submissionsEnabled(),
        transferEnabled: false,
      };
    } catch {
      return {
        ready: false,
        reason: "Approved payout proving artifacts and dedicated Engine project must be configured.",
        transferEnabled: false,
      };
    }
  }
  async detail(tutorId: string, batchId: string, actorId: string) {
    return this.transaction(tutorId, batchId, actorId, async (tx, record) => {
      let eligible = true;
      try {
        await reservedPayoutEvidence(tx, tutorId, batchId, this.clock());
      } catch (e) {
        if (!(e instanceof TutorCompensationError) || e.status !== 409) throw e;
        eligible = false;
      }
      return view(record, eligible);
    });
  }
  async generate(tutorId: string, batchId: string, actorId: string, input: unknown) {
    payoutReconciliationRequest(input);
    const release = await this.engine.ready();
    const claim = await this.transaction(tutorId, batchId, actorId, async (tx, old) => {
      const evidence = payoutAuthorizationEvidence(
        await reservedPayoutEvidence(tx, tutorId, batchId, this.clock()),
      );
      if (old) return { old, evidence, attempt: "" };
      const attempt = crypto.randomUUID(),
        now = new Date(this.clock()).toISOString();
      await tx.run(
        `MATCH (p:TutorPayoutBatch {id:$batchId}) CREATE (a:TutorPayoutAuthorization {batchId:$batchId,tutorId:$tutorId,
        phase:'proving',attempt:$attempt,evidenceDigest:$digest,actorId:$actorId,createdAt:$now,updatedAt:$now,transferEnabled:false})
        CREATE (p)-[:HAS_AUTHORIZATION]->(a)`,
        { batchId, tutorId, attempt, digest: payoutEvidenceDigest(evidence), actorId, now },
      );
      return { old: null, evidence, attempt };
    });
    if (claim.old) return view(claim.old, true);
    try {
      const result = await this.engine.prove(claim.evidence),
        signals = validatePayoutAuthorization(result, claim.evidence, release, this.clock());
      return await this.transaction(tutorId, batchId, actorId, async (tx, record) => {
        const fresh = payoutAuthorizationEvidence(
          await reservedPayoutEvidence(tx, tutorId, batchId, this.clock()),
        );
        if (
          record?.attempt !== claim.attempt ||
          record.phase !== "proving" ||
          payoutEvidenceDigest(fresh) !== record.evidenceDigest
        )
          throw new TutorCompensationError(409, "Payout evidence changed while proving.");
        const now = new Date(this.clock()).toISOString();
        const saved = await tx.run(
          `MATCH (a:TutorPayoutAuthorization {batchId:$batchId}) SET a.phase='locally_proved',a.updatedAt=$now,
          a.proofJson=$proof,a.signalsJson=$signals,a.vkHash=$vkHash,a.releaseManifestSHA256=$manifest,a.chainId=$chainId,a.domainId=$domainId,
          a.verificationNetwork=$network,a.expiresAt=$expiresAt,a.claimNullifier=$nullifier,a.vkDigest=$vkDigest RETURN a`,
          {
            batchId,
            now,
            proof: JSON.stringify(result.proof),
            signals: JSON.stringify(signals),
            vkHash: release.vkHash,
            manifest: release.releaseManifestSHA256,
            chainId: release.chainId,
            domainId: release.domainId,
            network: release.verificationNetwork,
            expiresAt: new Date(Number(signals[15]) * 1000).toISOString(),
            nullifier: signals[13],
            vkDigest: payoutEvidenceDigest(release.vk),
          },
        );
        return view(plainNode(saved.records[0]!.get("a").properties), true);
      });
    } catch {
      await this.transaction(tutorId, batchId, actorId, async (tx, record) => {
        if (record?.attempt === claim.attempt && record.phase === "proving")
          await tx.run(
            "MATCH (a:TutorPayoutAuthorization {batchId:$batchId}) SET a.phase='review',a.updatedAt=$now",
            { batchId, now: new Date(this.clock()).toISOString() },
          );
      });
      throw new TutorCompensationError(
        409,
        "Payout proof was not accepted. Review or cancel this reservation; no transfer occurred.",
      );
    }
  }
  async submit(tutorId: string, batchId: string, actorId: string, input: unknown) {
    payoutReconciliationRequest(input);
    if (!this.engine.submissionsEnabled())
      throw new TutorCompensationError(503, "Paid zkVerify submissions are disabled.");
    const release = await this.engine.ready();
    const record = await this.transaction(tutorId, batchId, actorId, async (tx, r) => {
      const fresh = payoutAuthorizationEvidence(
        await reservedPayoutEvidence(tx, tutorId, batchId, this.clock()),
      );
      if (
        !r ||
        r.phase !== "locally_proved" ||
        r.releaseManifestSHA256 !== release.releaseManifestSHA256 ||
        r.vkHash !== release.vkHash ||
        payoutEvidenceDigest(fresh) !== r.evidenceDigest ||
        Date.parse(r.expiresAt) <= this.clock()
      )
        throw new TutorCompensationError(
          409,
          "Only a current, locally proved authorization can be submitted. Do not resend an uncertain submission.",
        );
      await tx.run(
        "MATCH (a:TutorPayoutAuthorization {batchId:$batchId}) SET a.phase='submitting',a.updatedAt=$now",
        { batchId, now: new Date(this.clock()).toISOString() },
      );
      return r;
    });
    let engineSubmissionId: string;
    try {
      engineSubmissionId = await this.engine.submit(record, release);
    } catch {
      throw new TutorCompensationError(
        409,
        "Submission outcome requires Engine review. Do not resubmit. No payout transfer was made.",
      );
    }
    return this.transaction(tutorId, batchId, actorId, async (tx, r) => {
      if (r?.phase !== "submitting")
        throw new TutorCompensationError(409, "Payout authorization journal changed.");
      await tx.run(
        "MATCH (a:TutorPayoutAuthorization {batchId:$batchId}) SET a.phase='submitted',a.engineSubmissionId=$engineSubmissionId,a.updatedAt=$now",
        { batchId, engineSubmissionId, now: new Date(this.clock()).toISOString() },
      );
      return view({ ...r, phase: "submitted", engineSubmissionId }, false);
    });
  }
  async reconcile(tutorId: string, batchId: string, actorId: string, input: unknown) {
    payoutReconciliationRequest(input);
    const record = await this.transaction(tutorId, batchId, actorId, async (_tx, r) => {
      if (!r?.engineSubmissionId)
        throw new TutorCompensationError(
          409,
          "No stored Engine submission to reconcile. Unknown submissions require operator review.",
        );
      return r;
    });
    const result = await this.engine.lookup(record.engineSubmissionId, record);
    return this.transaction(tutorId, batchId, actorId, async (tx, r) => {
      if (r?.engineSubmissionId !== record.engineSubmissionId)
        throw new TutorCompensationError(409, "Payout journal changed.");
      let eligible = true;
      try {
        await reservedPayoutEvidence(tx, tutorId, batchId, this.clock());
      } catch (e) {
        if (!(e instanceof TutorCompensationError) || e.status !== 409) throw e;
        eligible = false;
      }
      const phase = result.receiptVerified
        ? "receipt_verified"
        : result.nativeFinalized
          ? "native_finalized"
          : "submitted";
      await tx.run(
        "MATCH (a:TutorPayoutAuthorization {batchId:$batchId}) SET a.phase=$phase,a.updatedAt=$now",
        { batchId, phase, now: new Date(this.clock()).toISOString() },
      );
      return view({ ...r, phase }, eligible);
    });
  }
}
export const tutorPayoutAuthorizationService = new TutorPayoutAuthorizationService();
