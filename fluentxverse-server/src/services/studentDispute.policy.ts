export const REPLY_WINDOW = 24 * 60 * 60_000;
export function disputeFailure(error: unknown, code = "") {
	const message = error instanceof Error ? error.message : "";
	const safe =
		/^(Conversation not found|The 24-hour|A reply has|Staff access|Decision changed|Choose |Write a reply|Invalid |Only a pending|An explanation|Images must|Cancelled lessons)/.test(
			message,
		);
	const invalid = code === "VALIDATION" || code === "PARSE";
	return {
		status:
			message === "Conversation not found"
				? 404
				: message.startsWith("Decision changed") ||
						message.startsWith("A reply has")
					? 409
					: safe
						? 400
						: invalid
							? 422
							: 503,
		body: {
			success: false,
			error: safe
				? message
				: invalid
					? "Invalid case request."
					: "The case could not be updated. Refresh before retrying.",
		},
	};
}
export const disputeReasons = [
	"connection",
	"audio",
	"hardware",
	"power",
	"personal",
	"emergency",
	"other",
] as const;
export const terminalDisputeStates = [
	"ta301",
	"no_penalty",
	"past",
	"cancelled",
];
export function disputeReplyState(duration?: string, reason?: string) {
	if (duration && !["up_to_ten", "over_ten"].includes(duration))
		throw Error("Invalid teaching duration");
	if (reason && !disputeReasons.includes(reason as any))
		throw Error("Invalid response reason");
	return duration === "up_to_ten" && reason && reason !== "other"
		? "pending_ta301"
		: "awaiting_admin";
}
export function disputeText(text: unknown, images = 0) {
	if (
		typeof text !== "string" ||
		text.trim().length > 10000 ||
		(!text.trim() && !images)
	)
		throw Error(
			"Write a reply or attach an image (maximum 10,000 characters).",
		);
	return text.trim();
}
export function disputeTime(value: any): string {
	return value?.toStandardDate
		? value.toStandardDate().toISOString()
		: new Date(value).toISOString();
}
export function lessonDescription(start: string, end: string) {
	const f = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Manila",
		weekday: "long",
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
	return `${f.format(new Date(start))} to ${f.format(new Date(end))} (Asia/Manila, UTC+08:00)`;
}
