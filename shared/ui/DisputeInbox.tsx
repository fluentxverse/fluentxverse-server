import { createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import { RefreshCw, Send } from "lucide-solid";
import { createStore, reconcile } from "solid-js/store";
import "./lesson-issue-threads.css";
const labels: Record<string, string> = {
	queued: "Waiting for lesson to end",
	staff_initial: "Staff review",
	awaiting_tutor: "Tutor explanation requested",
	pending_ta301: "TA-301 scheduled",
	awaiting_admin: "Staff review",
	ta301: "Resolved",
	no_penalty: "Resolved",
	past: "Resolved",
	cancelled: "Cancelled",
};
const reasons = [
	["connection", "Internet connection problem"],
	["audio", "Audio or microphone problem"],
	["hardware", "Device or accessory problem"],
	["power", "Power interruption"],
	["personal", "Health or urgent personal matter"],
	["emergency", "Emergency"],
	["other", "Other"],
];
export default function DisputeInbox(props: {
	client: any;
	role: "student" | "tutor";
}) {
	const [cases, setCases] = createStore<any[]>([]);
	const [error, setError] = createSignal(""),
		[busy, setBusy] = createSignal(false),
		[now, setNow] = createSignal(Date.now());
	let disposed = false,
		offset = 0;
	const path = (id = "") => "/inbox/disputes/" + id;
	const load = async () => {
		try {
			const r = await props.client.get(path() + "?as=" + props.role);
			if (!disposed) {
				setCases(reconcile(r.data.data));
				if (r.data.data[0])
					offset = Date.parse(r.data.data[0].serverNow) - Date.now();
				setError("");
			}
		} catch {
			if (!disposed) setError("Could not load lesson cases. Please retry.");
		}
	};
	createEffect(() => {
		void load();
		const timer = setInterval(() => void load(), 30000),
			clock = setInterval(() => setNow(Date.now()), 1000);
		onCleanup(() => {
			disposed = true;
			clearInterval(timer);
			clearInterval(clock);
		});
	});
	const date = (v: string) =>
		new Date(v).toLocaleString("en-US", {
			timeZone: "Asia/Manila",
			dateStyle: "medium",
			timeStyle: "short",
		}) + " PHT";
	const send = async (e: SubmitEvent, id: string, followup: boolean) => {
		e.preventDefault();
		if (busy()) return;
		const form = e.currentTarget as HTMLFormElement,
			data = new FormData(form),
			text = String(data.get("text") || "").trim();
		const files = data
			.getAll("images")
			.filter((f): f is File => f instanceof File && f.size > 0);
		if (!text && !files.length) {
			setError("Write a reply or attach an image.");
			return;
		}
		if (files.length > 3 || files.some((f) => f.size > 5 * 1024 * 1024)) {
			setError("Choose up to three images, 5 MB each.");
			return;
		}
		if (
			!followup &&
			!confirm(
				"Send your only reply? It cannot be edited. Include your full explanation and evidence.",
			)
		)
			return;
		setBusy(true);
		try {
			const duration = String(data.get("duration") || ""),
				reason = String(data.get("reason") || "");
			if (files.length) {
				const upload = new FormData();
				upload.set("text", text);
				upload.set("duration", duration);
				upload.set("reason", reason);
				files.forEach((f) => upload.append("images", f));
				await props.client.post(path(id) + "/images?as=" + props.role, upload, {
					headers: { "Content-Type": undefined },
				});
			} else
				await props.client.post(
					path(id) + (followup ? "/followup" : "/reply") + "?as=" + props.role,
					{ text, duration, reason },
				);
			form.reset();
			await load();
		} catch (e: any) {
			setError(
				e.response?.data?.error ||
					"Could not confirm your reply. Refresh the case before trying again.",
			);
		} finally {
			setBusy(false);
		}
	};
	return (
		<section class="lesson-issue-threads" aria-label="Private lesson cases">
			<header>
				<h2>Lesson cases</h2>
				<button type="button" disabled={busy()} onClick={load}>
					<RefreshCw size={16} />
					Refresh
				</button>
			</header>
			<Show when={error()}>
				<p role="alert">{error()}</p>
			</Show>
			<Show when={!cases.length}>
				<p>No lesson cases.</p>
			</Show>
			<For each={cases}>
				{(c) => (
					<details>
						<summary>
							{date(c.startsAt)} · {labels[c.state] || c.state}
						</summary>
						<p>Lesson reference: {c.bookingId}</p>
						<p class="issue-thread-body">{c.body}</p>
						<Show when={c.decisionReason}>
							<p class="issue-thread-body">
								<strong>Decision</strong>
								<br />
								{c.decisionReason}
							</p>
							<Show when={props.role === "student" && c.refundStatus}>
								<p>Refund: {c.refundStatus}</p>
							</Show>
							<Show when={props.role === "tutor"}>
								<p>
									This decision cannot be replied to. Contact support in a
									separate ticket for reconsideration.
								</p>
							</Show>
						</Show>
						<Show when={c.nonresponse}>
							<p class="issue-thread-warning">
								TA-301 — No tutor reply within 24 hours
							</p>
						</Show>
						<For each={c.replies}>
							{(r) => (
								<div class="issue-thread-reply">
									<strong>{r.role === "admin" ? "Staff" : "You"}</strong>
									<time> {date(r.createdAt)}</time>
									<p class="issue-thread-body">{r.body}</p>
									<div class="issue-thread-images">
										<For each={r.attachments}>
											{(a) => (
												<a
													target="_blank"
													rel="noopener noreferrer"
													href={
														(props.client.defaults.baseURL || "").replace(
															/\/$/,
															"",
														) +
														path(c.id) +
														"/images/" +
														a.id +
														"?as=" +
														props.role
													}
												>
													<img
														loading="lazy"
														alt="Your private case evidence"
														src={
															(props.client.defaults.baseURL || "").replace(
																/\/$/,
																"",
															) +
															path(c.id) +
															"/images/" +
															a.id +
															"?as=" +
															props.role
														}
													/>
												</a>
											)}
										</For>
									</div>
								</div>
							)}
						</For>
						<Show when={props.role === "tutor" && c.deadline}>
							<p>Response deadline: {date(c.deadline)}</p>
						</Show>
						<Show
							when={
								props.role === "tutor" &&
								c.canReply &&
								now() + offset < Date.parse(c.deadline)
							}
						>
							<form onSubmit={(e) => void send(e, c.id, false)}>
								<p>
									One reply only, visible to staff. Include your full
									explanation and evidence. No reply by the deadline results in
									TA-301.
								</p>
								<Show when={!c.behavior}>
									<label>
										Actual teaching time
										<select name="duration" aria-label="Actual teaching time">
											<option value="">Not specified</option>
											<option value="up_to_ten">10 minutes or less</option>
											<option value="over_ten">More than 10 minutes</option>
										</select>
									</label>
									<label>
										Reason
										<select name="reason" aria-label="Reason">
											<option value="">Not specified</option>
											<For each={reasons}>
												{(r) => <option value={r[0]}>{r[1]}</option>}
											</For>
										</select>
									</label>
								</Show>
								<label>
									Explanation
									<textarea
										name="text"
										rows={6}
										maxLength={10000}
										disabled={busy()}
									/>
								</label>
								<label>
									Evidence images
									<input
										name="images"
										type="file"
										multiple
										accept="image/jpeg,image/png,image/webp"
										disabled={busy()}
									/>
								</label>
								<p>
									Up to 3 images, 5 MB each. Remove unnecessary personal
									information.{" "}
									{c.behavior
										? "Staff will review your explanation."
										: "Listed tutor-side causes with 10 minutes or less result in TA-301 at the deadline. Other goes to staff review."}
								</p>
								<button type="submit" disabled={busy()}>
									<Send size={16} />
									Send reply
								</button>
							</form>
						</Show>
						<Show
							when={
								props.role === "tutor" &&
								c.state === "awaiting_tutor" &&
								now() + offset >= Date.parse(c.deadline)
							}
						>
							<p>
								Response deadline expired. Contact support for reconsideration.
							</p>
						</Show>
						<Show when={props.role === "student" && c.canFollowup}>
							<form onSubmit={(e) => void send(e, c.id, true)}>
								<label>
									Reply privately to staff
									<textarea
										name="text"
										required
										maxLength={10000}
										disabled={busy()}
									/>
								</label>
								<button type="submit" disabled={busy()}>
									<Send size={16} />
									Send to staff
								</button>
							</form>
						</Show>
					</details>
				)}
			</For>
		</section>
	);
}
