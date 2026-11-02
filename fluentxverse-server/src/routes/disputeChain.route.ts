import Elysia from "elysia";
import { timingSafeEqual } from "node:crypto";
import { chainCaptureEnabled, disputeEvents, DISPUTE_POLICY_HASH } from "../services/disputeChain/outbox";

export function validDisputeFeedKey(key: string | null) {
  const expected = process.env.DISPUTE_CHAIN_FEED_KEY || "";
  if (expected.length < 32 || !key || key.length > 256) return false;
  const a = Buffer.from(expected), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const disputeChainRoute = new Elysia({ prefix: "/internal/dispute-chain" })
  .get("/events", async ({ request, query, set }) => {
    set.headers["Cache-Control"] = "private, no-store";
    if (!chainCaptureEnabled() || !validDisputeFeedKey(request.headers.get("X-FXV-Dispute-Feed-Key"))) {
      set.status = 404;
      return { error: "Not found" };
    }
    const after = Number(query.after || "0");
    if (!Number.isSafeInteger(after) || after < 0) {
      set.status = 400;
      return { error: "Invalid cursor" };
    }
    return { version: 1, policyHash: DISPUTE_POLICY_HASH, events: await disputeEvents(after) };
  });
