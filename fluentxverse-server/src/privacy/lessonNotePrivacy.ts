import type { ManagedTransaction } from "neo4j-driver";
import { privateInformationKinds, type PrivateIdentity } from "./personalInformation";
import { LessonFeedbackInvalid } from "../utils/lessonFeedbackValidation";

export async function lessonStudentIdentity(
  tx: Pick<ManagedTransaction, "run">,
  bookingId: string,
): Promise<PrivateIdentity> {
  const row = (
    await tx.run("MATCH (:Booking {bookingId:$bookingId})-[:BOOKED_BY]->(s:Student) RETURN s", { bookingId })
  ).records[0];
  if (!row)
    throw new LessonFeedbackInvalid("The lesson student could not be verified. Notes were not saved.");
  const s = row.get("s").properties;
  return {
    names: [
      s.firstName,
      s.lastName,
      s.givenName,
      s.familyName,
      s.displayName,
      s.name,
      s.fullName,
      s.username,
      [s.firstName, s.lastName].filter(Boolean).join(" "),
      [s.givenName, s.familyName].filter(Boolean).join(" "),
    ].filter(Boolean),
    emails: [s.email].filter(Boolean),
    addresses: [s.address, s.streetAddress].filter((value) => typeof value === "string"),
    identifiers: [s.id, s.phone, s.phoneNumber, bookingId].filter(Boolean),
  };
}
export function assertPrivateLessonNotes(
  value: unknown,
  identity: PrivateIdentity,
  field?: "studentFeedback" | "tutorHandoff",
  depth = 0,
): void {
  if (depth > 12) throw new LessonFeedbackInvalid("Lesson notes exceed validation limits.");
  if (typeof value === "string" && privateInformationKinds(value, identity).length) {
    throw new LessonFeedbackInvalid(
      'Remove student names, contact details, addresses, identifiers and personal information from lesson notes. Use "the student" instead.',
      field ? { field } : undefined,
    );
  }
  if (Array.isArray(value))
    for (const item of value) assertPrivateLessonNotes(item, identity, field, depth + 1);
  else if (value && typeof value === "object")
    for (const item of Object.values(value)) assertPrivateLessonNotes(item, identity, field, depth + 1);
}
