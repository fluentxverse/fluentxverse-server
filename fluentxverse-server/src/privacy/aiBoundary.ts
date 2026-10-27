import { AsyncLocalStorage } from "node:async_hooks";
import { minimizeAIInput, type PrivateIdentity } from "./personalInformation";
import { getDriver } from "../db/memgraph";
import { lessonStudentIdentity } from "./lessonNotePrivacy";

const identities = new AsyncLocalStorage<PrivateIdentity>();
export const withAIPrivacy = <T>(identity: PrivateIdentity, work: () => T): T =>
  identities.run(identity, work);

export async function withLessonAIPrivacy<T>(
  bookingId: string | undefined,
  tutorId: string,
  work: () => Promise<T>,
): Promise<T> {
  if (!bookingId) throw new Error("Lesson AI access unavailable");
  const session = getDriver().session();
  let identity;
  try {
    const owned = await session.run(
      "MATCH (b:Booking {bookingId:$bookingId,tutorId:$tutorId}) RETURN b.bookingId AS id",
      { bookingId, tutorId },
    );
    if (!owned.records.length) throw new Error("Lesson AI access unavailable");
    identity = await lessonStudentIdentity(session, bookingId);
  } finally {
    await session.close();
  }
  return withAIPrivacy(identity, work);
}

// Every Mastra call crosses the same boundary, including future agents.
export function privateAgent<T extends object>(agent: T): T {
  return new Proxy(agent, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if ((property === "generate" || property === "stream") && typeof value === "function") {
        return async (input: unknown, ...options: unknown[]) => {
          try {
            // Memory, tracing metadata and per-call instructions need their own privacy review.
            for (const option of options)
              if (
                option &&
                typeof option === "object" &&
                Object.keys(option).some((key) => !["abortSignal", "structuredOutput"].includes(key))
              )
                throw Error("Unreviewed AI options");
            return await Reflect.apply(value, target, [
              minimizeAIInput(input, identities.getStore()),
              ...options,
            ]);
          } catch {
            throw new Error("AI request failed. Request and provider response content were omitted.");
          }
        };
      }
      return value;
    },
  });
}
