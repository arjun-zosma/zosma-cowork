import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import {
	type ExtensionUiRequest,
	type ExtensionUiResponse,
	useExtensionUi,
} from "@/hooks/useExtensionUi";
import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * Renders extension UI dialog requests (ctx.ui.select / confirm / input /
 * editor) coming from pi extensions like pi-ask-user. Mounted once at the app
 * root; shows at most one dialog at a time (the hook queues the rest).
 *
 * pi's ctx.ui exposes exactly four interactive dialog primitives — there is no
 * checkbox / radio / multiselect in the protocol. `select` is the single-choice
 * (radio-equivalent) primitive; the four below are the complete surface.
 */
export function ExtensionUiHost() {
	const { current, respond } = useExtensionUi();
	if (!current) return null;
	// Key by request id so all local input state resets between dialogs.
	return <ExtensionUiDialog key={current.id} request={current} respond={respond} />;
}

/** Max auto-grow height for the input textarea (≈ 6 rows). */
const INPUT_MAX_HEIGHT_PX = 160;
/** Fixed height for the long-form editor textarea. */
const EDITOR_MIN_HEIGHT_PX = 200;

function autoGrow(el: HTMLTextAreaElement | null, maxPx: number) {
	if (!el) return;
	el.style.height = "auto";
	el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
}

function ExtensionUiDialog({
	request,
	respond,
}: {
	request: ExtensionUiRequest;
	respond: (response: ExtensionUiResponse) => void;
}) {
	const titleId = useId();
	const hintId = useId();
	const [text, setText] = useState(request.prefill ?? "");
	const inputRef = useRef<HTMLTextAreaElement>(null);

	// Optional auto-dismiss countdown (pi-ask-user passes `timeout` in ms). The
	// sidecar owns the authoritative timeout and emits `ui_cancel` to close this
	// dialog; the countdown is the visible UX, plus a safety net in case the
	// cancel event is missed.
	const timeoutMs = request.timeout && request.timeout > 0 ? request.timeout : undefined;
	const [remainingMs, setRemainingMs] = useState(timeoutMs ?? 0);

	// Keep local text in sync if the same request object is ever reused.
	useEffect(() => {
		setText(request.prefill ?? "");
	}, [request.prefill]);

	// Auto-size the input textarea to its content (capped).
	useEffect(() => {
		if (request.method === "input") autoGrow(inputRef.current, INPUT_MAX_HEIGHT_PX);
	}, [request.method]);

	// Stable so the Dialog's focus effect (deps include onClose) does NOT re-run
	// on every keystroke — re-running it stole focus from the text field.
	const cancel = useCallback(() => respond({ cancelled: true }), [respond]);
	const submitText = useCallback(() => respond({ value: text }), [respond, text]);

	useEffect(() => {
		if (!timeoutMs) return;
		const start = Date.now();
		setRemainingMs(timeoutMs);
		const tick = setInterval(() => {
			const left = Math.max(0, timeoutMs - (Date.now() - start));
			setRemainingMs(left);
			if (left <= 0) clearInterval(tick);
		}, 250);
		// Safety net: if the sidecar's ui_cancel is missed, self-dismiss shortly
		// after the deadline so the dialog never lingers after the task moved on.
		const safety = setTimeout(() => respond({ cancelled: true }), timeoutMs + 1500);
		return () => {
			clearInterval(tick);
			clearTimeout(safety);
		};
	}, [timeoutMs, respond]);

	const title = request.title || "Input requested";

	return (
		<Dialog open onClose={cancel} size="md" labelledBy={titleId}>
			<DialogHeader title={title} onClose={cancel} titleId={titleId} />

			<DialogBody>
				{timeoutMs ? (
					<p className="mb-3 text-[11px] text-muted-foreground/70 tabular-nums">
						Auto-dismisses in {Math.ceil(remainingMs / 1000)}s
					</p>
				) : null}

				{request.method === "confirm" && request.message && (
					<p className="text-sm text-foreground whitespace-pre-wrap">{request.message}</p>
				)}

				{request.method === "select" && (
					<div className="flex flex-col gap-1.5">
						{(request.options ?? []).map((option, i) => (
							<button
								key={`${i}-${option}`}
								type="button"
								onClick={() => respond({ value: option })}
								className="w-full text-left px-3 py-2 text-sm bg-background border border-border rounded-lg hover:bg-muted/70 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition-colors active:scale-[0.99]"
							>
								{option}
							</button>
						))}
						{(request.options ?? []).length === 0 && (
							<p className="text-sm text-muted-foreground">No options provided.</p>
						)}
					</div>
				)}

				{request.method === "input" && (
					<>
						<textarea
							ref={inputRef}
							data-autofocus
							rows={1}
							placeholder={request.placeholder ?? ""}
							value={text}
							aria-describedby={hintId}
							onChange={(e) => {
								setText(e.target.value);
								autoGrow(e.target, INPUT_MAX_HEIGHT_PX);
							}}
							onKeyDown={(e) => {
								// Enter submits; Shift+Enter inserts a newline (long answers).
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									submitText();
								}
							}}
							className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg resize-none overflow-y-auto focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition-all placeholder:text-muted-foreground/60"
						/>
						<p id={hintId} className="mt-1.5 text-[11px] text-muted-foreground/70">
							<kbd className="font-sans">Enter</kbd> to submit ·{" "}
							<kbd className="font-sans">Shift</kbd>+<kbd className="font-sans">Enter</kbd> for a
							new line
						</p>
					</>
				)}

				{request.method === "editor" && (
					<>
						<textarea
							data-autofocus
							value={text}
							aria-describedby={hintId}
							style={{ minHeight: EDITOR_MIN_HEIGHT_PX }}
							onChange={(e) => setText(e.target.value)}
							onKeyDown={(e) => {
								// Long-form: Enter is a newline; Cmd/Ctrl+Enter submits.
								if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
									e.preventDefault();
									submitText();
								}
							}}
							className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition-all"
						/>
						<p id={hintId} className="mt-1.5 text-[11px] text-muted-foreground/70">
							<kbd className="font-sans">⌘</kbd>/<kbd className="font-sans">Ctrl</kbd>+
							<kbd className="font-sans">Enter</kbd> to submit
						</p>
					</>
				)}
			</DialogBody>

			<DialogFooter>
				{request.method === "confirm" ? (
					<>
						<button
							type="button"
							onClick={() => respond({ confirmed: false })}
							className="px-3 py-1.5 text-xs font-medium text-muted-foreground rounded-md hover:bg-muted/70 transition-colors active:scale-[0.97]"
						>
							No
						</button>
						<button
							type="button"
							onClick={() => respond({ confirmed: true })}
							className="px-4 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md transition-all active:scale-[0.97] hover:brightness-110"
						>
							Yes
						</button>
					</>
				) : request.method === "input" || request.method === "editor" ? (
					<>
						<button
							type="button"
							onClick={cancel}
							className="px-3 py-1.5 text-xs font-medium text-muted-foreground rounded-md hover:bg-muted/70 transition-colors active:scale-[0.97]"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={submitText}
							className="px-4 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md transition-all active:scale-[0.97] hover:brightness-110"
						>
							Submit
						</button>
					</>
				) : (
					// select: options act as submit; footer only offers cancel.
					<button
						type="button"
						onClick={cancel}
						className="px-3 py-1.5 text-xs font-medium text-muted-foreground rounded-md hover:bg-muted/70 transition-colors active:scale-[0.97]"
					>
						Cancel
					</button>
				)}
			</DialogFooter>
		</Dialog>
	);
}
