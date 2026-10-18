import { getDriver } from "../db/memgraph";
import {
	calculateTutorPerformance,
	performanceWindow,
} from "../utils/tutorPerformance";

function plain(properties: Record<string, any>) {
	return Object.fromEntries(
		Object.entries(properties).map(([key, value]) => [
			key,
			value?.toStandardDate
				? value.toStandardDate().toISOString()
				: value?.toNumber
					? value.toNumber()
					: value,
		]),
	);
}

export class TutorPerformanceService {
	async get(tutorId: string, period = "month", month?: string, page = 1, excludedPenalties: string[] = []) {
		const now = Date.now();
		const window = performanceWindow(period, month, now);
		if (!Number.isInteger(page) || page < 1 || page > 100000)
			throw new Error("Invalid metrics page");
		const session = getDriver().session();
		try {
			return await session.executeRead(async (tx) => {
				const user = (
					await tx.run(
						"MATCH (u:User {id: $tutorId}) RETURN u.rating AS rating, u.totalReviews AS totalReviews",
						{ tutorId },
					)
				).records[0];
				if (!user) throw new Error("Tutor not found");
				// Keep cancelled bookings too: a cancelled/rebooked slot must not become two opportunities.
				const bookingRows = await tx.run(
					`MATCH (b:Booking {tutorId: $tutorId})
          OPTIONAL MATCH (b)-[:BOOKED_BY]->(s:Student)
          RETURN b, coalesce(s.givenName, s.firstName, 'Student') AS first, coalesce(s.familyName, s.lastName, '') AS last`,
					{ tutorId },
				);
				const slots = await tx.run(
					"MATCH (s:TimeSlot {tutorId: $tutorId}) RETURN s",
					{ tutorId },
				);
				const penalties = await tx.run(
					"MATCH (p:Penalty {tutorId: $tutorId}) RETURN p",
					{ tutorId },
				);
				const surveys = await tx.run('MATCH (s:LessonSurvey {tutorId: $tutorId}) RETURN s', { tutorId });
				return calculateTutorPerformance(
					bookingRows.records.map((r) => ({
						...plain(r.get("b").properties),
						studentName: `${r.get("first")} ${r.get("last")}`.trim(),
					})),
					slots.records.map((r) => plain(r.get("s").properties)),
					penalties.records.map((r) => plain(r.get("p").properties)).filter(p => !excludedPenalties.includes(p.penaltyId)),
					plain({
						rating: user.get("rating"),
						totalReviews: user.get("totalReviews"),
					}),
					window,
					now,
					page,
					surveys.records.map(r => plain(r.get('s').properties)),
				);
			});
		} finally {
			await session.close();
		}
	}
}
export const tutorPerformanceService = new TutorPerformanceService();
