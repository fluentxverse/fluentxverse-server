import type { ManagedTransaction } from "neo4j-driver";
import { getDriver } from "../../db/memgraph";
import { ApplicationError } from "../exam.services/applicationPolicy";

export function interviewStart(date: string, time: string): number {
  const match = /^(1[0-2]|[1-9]):([0-5]\d) (AM|PM)$/.exec(time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !match)
    throw new ApplicationError(
      400,
      "Use an ISO date and h:mm AM/PM time (Asia/Manila).",
    );
  const hour = (Number(match[1]) % 12) + (match[3] === "PM" ? 12 : 0);
  const stamp = Date.parse(
    `${date}T${String(hour).padStart(2, "0")}:${match[2]}:00+08:00`,
  );
  if (
    !Number.isFinite(stamp) ||
    new Date(stamp + 8 * 3600000).toISOString().slice(0, 10) !== date
  )
    throw new ApplicationError(400, "Invalid interview date.");
  return stamp;
}
export function interviewWeek(offset: number, now = Date.now()) {
  if (!Number.isInteger(offset) || Math.abs(offset) > 104)
    throw new ApplicationError(400, "Invalid interview week.");
  const local = new Date(now + 8 * 3600000),
    weekday = (local.getUTCDay() + 6) % 7;
  local.setUTCDate(local.getUTCDate() - weekday + offset * 7);
  const weekStart = local.toISOString().slice(0, 10);
  local.setUTCDate(local.getUTCDate() + 6);
  return { weekStart, weekEnd: local.toISOString().slice(0, 10) };
}
let schema: Promise<void> | undefined;
export function ensureInterviewCalendar() {
  return (schema ||= (async () => {
    const s = getDriver().session();
    try {
      const exists = async () =>
        (await s.run("SHOW CONSTRAINT INFO")).records.some(
          (r) =>
            r.get("label") === "InterviewCalendar" &&
            r.get("constraint type") === "unique",
        );
      if (!(await exists())) {
        try {
          await s.run(
            "CREATE CONSTRAINT ON (n:InterviewCalendar) ASSERT n.id IS UNIQUE",
          );
        } catch {
          if (!(await exists()))
            throw Error("Interview calendar uniqueness required");
        }
      }
      await s.run("MERGE(:InterviewCalendar {id:'main'})");
    } finally {
      await s.close();
    }
  })().catch((error) => {
    schema = undefined;
    throw error;
  }));
}
export async function lockInterviewCalendar(tx: ManagedTransaction) {
  await tx.run(
    "MATCH(c:InterviewCalendar {id:'main'}) SET c.revision=coalesce(c.revision,0)+1",
  );
}
