import Elysia, { t } from "elysia";
import { createHash } from "node:crypto";
import { verifyAuthToken, verifyAdminToken } from "../utils/jwt";
import {
	studentDisputeService as disputes,
	type DisputeActor,
} from "../services/studentDispute.service";
import { getDriver } from "../db/memgraph";
import {
	lessonIssueImageStorage,
	sanitizeIssueImage,
} from "../services/lessonIssueImages";
import {
	isAllowedAdminMutationOrigin,
	isAllowedTutorMutationOrigin,
	isAllowedStudentRequest,
} from "../config/cors";

async function actor(cookie: any, mode?: string): Promise<DisputeActor | null> {
	if (mode === "admin") {
		const a =
			cookie.adminAuth?.value &&
			(await verifyAdminToken(String(cookie.adminAuth.value)));
		if (!a) return null;
		const s = getDriver().session();
		try {
			return (
				await s.run(
					"MATCH(a:Admin {id:$id}) WHERE a.role IN ['admin','superadmin'] RETURN a",
					{ id: a.userId },
				)
			).records.length
				? { id: a.userId, role: "admin" }
				: null;
		} finally {
			await s.close();
		}
	}
	const role = mode === "student" ? "student" : "tutor",
		raw = cookie[role + "Auth"]?.value;
	const a = raw && (await verifyAuthToken(String(raw)));
	return a?.role === role ? { id: a.userId, role } : null;
}
const text = t.String({ maxLength: 10000 });
const replyFields = {
	text,
	duration: t.Optional(t.String({ maxLength: 20 })),
	reason: t.Optional(t.String({ maxLength: 40 })),
};
const route = new Elysia({ prefix: "/disputes" })
	.onRequest(({ set }) => {
		set.headers["Cache-Control"] = "private, no-store";
	})
	.derive(async ({ cookie, query }) => {
		const user = await actor(cookie, query.as);
		return { user };
	})
	.onBeforeHandle(({ user, request, set }) => {
		if (request.method === "GET") return;
		const origin = request.headers.get("origin");
		const allowed =
			user?.role === "admin"
				? isAllowedAdminMutationOrigin(origin)
				: user?.role === "tutor"
					? isAllowedTutorMutationOrigin(origin)
					: user?.role === "student"
						? isAllowedStudentRequest(origin, request.method)
						: false;
		if (!allowed) {
			set.status = 403;
			return {
				success: false,
				error: "Untrusted origin or unauthenticated request",
			};
		}
	})
	.onError(({ error, set }) => {
		const message = error instanceof Error ? error.message : "";
		const safe =
			/^(Conversation not found|The 24-hour|A reply has|Staff access|Decision changed|Choose |Write a reply|Invalid |Only a pending|An explanation|Images must)/.test(
				message,
			);
		if (safe) {
			set.status =
				message === "Conversation not found"
					? 404
					: message.startsWith("Decision changed")
						? 409
						: 400;
			return { success: false, error: message };
		}
		if (set.status === 403)
			return { success: false, error: "Untrusted origin" };
		set.status = 503;
		return {
			success: false,
			error: "The case could not be updated. Refresh before retrying.",
		};
	})
	.get("/", async ({ user, set }) => {
		if (!user) {
			set.status = 401;
			return { success: false, error: "Authentication required" };
		}
		return { success: true, data: await disputes.list(user) };
	})
	.post(
		"/:id/reply",
		async ({ user, params, body, set }) => {
			if (!user || user.role !== "tutor") {
				set.status = 403;
				return { success: false, error: "Tutor access required" };
			}
			await disputes.reply(
				params.id,
				user,
				body.text,
				[],
				body.duration,
				body.reason,
			);
			return { success: true };
		},
		{ body: t.Object(replyFields) },
	)
	.post(
		"/:id/images",
		async ({ user, params, body, set }) => {
			if (!user || user.role !== "tutor") {
				set.status = 403;
				return { success: false, error: "Tutor access required" };
			}
			// Authorize before accepting expensive image conversion/storage.
			const thread = (await disputes.list(user)).find(
				(t) => t.id === params.id,
			);
			if (!thread?.canReply) throw Error("Conversation not found");
			const files: { id: string; sha256: string }[] = [];
			try {
				for (const file of body.images) {
					const bytes = await sanitizeIssueImage(file),
						id = crypto.randomUUID();
					await lessonIssueImageStorage.put(id, bytes);
					files.push({ id, sha256: createHash("sha256").update(bytes).digest("hex") });
				}
				await disputes.reply(
					params.id,
					user,
					body.text,
					files,
					body.duration,
					body.reason,
				);
				return { success: true };
			} catch (e) {
				// Retain encrypted files on ambiguous DB failures: a committed reply may reference them.
				if (
					/^(The 24-hour|A reply has|Conversation not found|Write a reply|Invalid |Images must)/.test(
						String((e as Error).message),
					)
				)
					await Promise.allSettled(
						files.map((f) => lessonIssueImageStorage.remove(f.id)),
					);
				throw e;
			}
		},
		{
			body: t.Object({
				...replyFields,
				images: t.Files({ minItems: 1, maxItems: 3, maxSize: "5m" }),
			}),
		},
	)
	.get("/:id/images/:imageId", async ({ user, params, set }) => {
		if (!user || user.role === "student") {
			set.status = 404;
			return { success: false, error: "Image not found" };
		}
		const thread = (await disputes.list(user)).find((t) => t.id === params.id);
		if (
			!thread?.replies.some((r: any) =>
				r.attachments?.some((a: any) => a.id === params.imageId),
			)
		) {
			set.status = 404;
			return { success: false, error: "Image not found" };
		}
		const bytes = await lessonIssueImageStorage.get(params.imageId),
			s = getDriver().session();
		try {
			const attachment = thread.replies.flatMap((r: any) => r.attachments || []).find((a: any) => a.id === params.imageId);
			if (attachment?.sha256 && attachment.sha256 !== createHash("sha256").update(bytes).digest("hex"))
				throw Error("Image evidence integrity check failed");
			await s.run(
				"CREATE(:LessonIssueImageAccess {id:$id,imageId:$imageId,threadId:$threadId,actorId:$actorId,actorRole:$role,createdAt:$now})",
				{
					id: crypto.randomUUID(),
					imageId: params.imageId,
					threadId: params.id,
					actorId: user.id,
					role: user.role,
					now: new Date().toISOString(),
				},
			);
		} finally {
			await s.close();
		}
		return new Response(bytes, {
			headers: {
				"Content-Type": "image/jpeg",
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
				"Content-Security-Policy": "default-src 'none'; sandbox",
			},
		});
	})
	.post(
		"/:id/decision",
		async ({ user, params, body, set }) => {
			if (user?.role !== "admin") {
				set.status = 403;
				return { success: false, error: "Staff access required" };
			}
			await disputes.decide(
				params.id,
				user.id,
				body.decision,
				body.reason,
				body.revision,
				body.refund,
				body.sys501,
			);
			return { success: true };
		},
		{
			body: t.Object({
				decision: t.Union([
					t.Literal("ta301"),
					t.Literal("no_penalty"),
					t.Literal("past"),
				]),
				reason: t.String({ minLength: 1, maxLength: 2000 }),
				revision: t.Integer({ minimum: 0 }),
				refund: t.Boolean(),
				sys501: t.Optional(t.Boolean()),
			}),
		},
	)
	.post(
		"/:id/request",
		async ({ user, params, body, set }) => {
			if (user?.role !== "admin") {
				set.status = 403;
				return { success: false, error: "Staff access required" };
			}
			await disputes.requestExplanation(params.id, user.id, body.text);
			return { success: true };
		},
		{ body: t.Object({ text: t.String({ minLength: 1, maxLength: 2000 }) }) },
	)
	.post(
		"/:id/extend",
		async ({ user, params, body, set }) => {
			if (user?.role !== "admin") {
				set.status = 403;
				return { success: false, error: "Staff access required" };
			}
			await disputes.extend(params.id, user.id, body.deadline, body.reason);
			return { success: true };
		},
		{
			body: t.Object({
				deadline: t.String({ maxLength: 40 }),
				reason: t.String({ minLength: 1, maxLength: 2000 }),
			}),
		},
	)
	.post(
		"/:id/followup",
		async ({ user, params, body, set }) => {
			if (!user || user.role === "tutor") {
				set.status = 403;
				return { success: false, error: "Student or staff access required" };
			}
			await disputes.followup(params.id, user, body.text);
			return { success: true };
		},
		{ body: t.Object({ text: t.String({ minLength: 1, maxLength: 10000 }) }) },
	);
export default route;
