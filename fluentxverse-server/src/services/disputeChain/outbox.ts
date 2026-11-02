import { createHash, randomBytes } from "node:crypto";
import type { ManagedTransaction } from "neo4j-driver";
import { int } from "neo4j-driver";
import { getDriver } from "../../db/memgraph";
import policy from "../../../../shared/disputeChainPolicy.json";

export const DISPUTE_POLICY_HASH = "0x" + createHash("sha256").update(JSON.stringify(policy)).digest("hex");
export const chainCaptureEnabled = () => process.env.DISPUTE_CHAIN_CAPTURE === "true";
let schema: Promise<void> | undefined;
export async function ensureDisputeOutbox() {
  if (!chainCaptureEnabled()) return;
  return schema ||= (async () => {
    const db = getDriver().session();
    try {
      for (const q of [
        "CREATE CONSTRAINT ON (n:DisputeChainCounter) ASSERT n.id IS UNIQUE",
        "CREATE CONSTRAINT ON (n:DisputeChainEvent) ASSERT n.sequence IS UNIQUE",
        "CREATE CONSTRAINT ON (n:DisputeChainEvent) ASSERT n.id IS UNIQUE",
        "CREATE INDEX ON :DisputeChainEvent(sequence)",
      ]) {
        try { await db.run(q); }
        catch (e) { if (!/already exists|already exist/i.test(String(e))) throw e; }
      }
      await db.run("MERGE(c:DisputeChainCounter {id:'v1'}) ON CREATE SET c.sequence=0");
    } finally { await db.close(); }
  })().catch(e => { schema = undefined; throw e; });
}

export function enrollDispute() {
  return chainCaptureEnabled() ? {
    chainVersion: 1,
    chainKey: "0x" + randomBytes(32).toString("hex"),
    chainSalt: randomBytes(32).toString("hex"),
  } : {};
}

export type ChainEventKind = "open" | "authorize" | "request" | "response" | "extend" |
  "staff" | "duration" | "nonresponse" | "noshow" | "cancel" | "refund";

// Must run in the transaction that writes the authoritative business change.
// The counter serializes commits, so a polling consumer cannot skip an uncommitted lower sequence.
export async function appendDisputeEvent(tx: ManagedTransaction, thread: any, kind: ChainEventKind,
  at: string, fields: Record<string, string | number | boolean> = {}, evidence: unknown = {}) {
  if (Number(thread.chainVersion) !== 1) return;
  if (!/^0x[0-9a-f]{64}$/.test(thread.chainKey) || !/^[0-9a-f]{64}$/.test(thread.chainSalt))
    throw Error("Invalid dispute chain binding");
  const row = await tx.run(`MATCH(c:DisputeChainCounter {id:'v1'}),(t:LessonIssueThread {id:$id})
    SET c.sequence=c.sequence+1,t.chainSequence=coalesce(t.chainSequence,0)+1
    RETURN c.sequence AS sequence,t.chainSequence AS caseSequence`, { id: thread.id });
  if (row.records.length !== 1) throw Error("Dispute outbox not initialized");
  const sequence = Number(row.records[0]!.get("sequence")), caseSequence = Number(row.records[0]!.get("caseSequence"));
  if (!Number.isSafeInteger(sequence) || !Number.isSafeInteger(caseSequence) || sequence < 1 || caseSequence < 1)
    throw Error("Dispute sequence requires migration before exceeding safe integer range");
  const payload = { version: 1, sequence, caseSequence, id: `${thread.id}:${caseSequence}`, kind,
    caseKey: thread.chainKey, policyHash: DISPUTE_POLICY_HASH, at: Math.floor(Date.parse(at) / 1000), ...fields };
  if (!Number.isSafeInteger(payload.at) || payload.at <= 0) throw Error("Invalid dispute event time");
  const evidenceJson = JSON.stringify(evidence);
  const commitment = "0x" + createHash("sha256").update(JSON.stringify([
    "FXV_DISPUTE_EVENT_V1", thread.chainSalt, payload, evidenceJson,
  ])).digest("hex");
  const publicJson = JSON.stringify({ ...payload, commitment });
  await tx.run(`MATCH(t:LessonIssueThread {id:$threadId})
    CREATE(e:DisputeChainEvent {id:$id,sequence:$sequence,caseSequence:$caseSequence,
      json:$json,evidenceJson:$evidence,createdAt:$at}) CREATE(t)-[:HAS_CHAIN_EVENT]->(e)`, {
    threadId: thread.id, id: payload.id, sequence: int(sequence), caseSequence: int(caseSequence), json: publicJson, evidence: evidenceJson, at,
  });
}

export async function appendRefundDelivery(tx: ManagedTransaction, bookingId: string, receipt: string, at: string) {
  const r = await tx.run(`MATCH(t:LessonIssueThread {bookingId:$bookingId,chainVersion:1})
    SET t.chainRefundWrite=coalesce(t.chainRefundWrite,0)+1 RETURN t`, { bookingId });
  const thread = r.records[0]?.get("t").properties;
  if (!thread || thread.chainRefundEmitted) return;
  await appendDisputeEvent(tx, thread, "refund", at, {}, { receipt, bookingId });
  await tx.run("MATCH(t:LessonIssueThread {id:$id}) SET t.chainRefundEmitted=true", { id: thread.id });
}

export async function disputeEvents(after: number, limit = 100) {
  await ensureDisputeOutbox();
  const db = getDriver().session();
  try {
    const r = await db.run(`MATCH(e:DisputeChainEvent) WHERE e.sequence > $after
      RETURN e.json AS json ORDER BY e.sequence LIMIT $limit`, { after: int(after), limit: int(limit) });
    return r.records.map(r => JSON.parse(r.get("json")));
  } finally { await db.close(); }
}
