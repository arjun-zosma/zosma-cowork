import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { type ThemeMode, getThemeMode } from "../lib/themes";

/**
 * Custom instructions editor.
 *
 * Instructions are stored as Markdown (`INSTRUCTIONS.md`) by the sidecar and
 * injected into the system prompt as always-on context. Saving reloads the live
 * session, so changes take effect immediately — no app restart.
 */
export function CustomInstructions() {
	const [instructions, setInstructions] = useState("");
	const [saved, setSaved] = useState(false);
	const [saving, setSaving] = useState(false);
	const [loading, setLoading] = useState(true);
	const [colorMode, setColorMode] = useState<ThemeMode>(() => getThemeMode());
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Load saved instructions on mount.
	useEffect(() => {
		let cancelled = false;
		invoke<string>("get_instructions")
			.then((content) => {
				if (cancelled) return;
				if (typeof content === "string") setInstructions(content);
			})
			.catch(() => {
				// Silently fail — absence of instructions is a valid state.
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// Keep the editor's color scheme in sync with the app theme (data-theme on
	// <html>, toggled elsewhere). The editor reads `data-color-mode`.
	useEffect(() => {
		const sync = () => setColorMode(getThemeMode());
		const observer = new MutationObserver(sync);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});
		return () => observer.disconnect();
	}, []);

	// Clean up the "Saved!" timer on unmount.
	useEffect(
		() => () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		},
		[],
	);

	const handleSave = async () => {
		setSaving(true);
		try {
			await invoke("save_instructions", { content: instructions });
			setSaved(true);
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => setSaved(false), 2000);
		} catch {
			// Silently fail — keep the editor content so the user can retry.
		} finally {
			setSaving(false);
		}
	};

	const handleChange = (value?: string) => {
		setInstructions(value ?? "");
		if (saved) setSaved(false);
	};

	return (
		<div>
			<div
				data-color-mode={colorMode}
				className="rounded-md overflow-hidden border border-sidebar-border"
			>
				<MDEditor
					value={instructions}
					onChange={handleChange}
					height={240}
					preview="edit"
					visibleDragbar={false}
					textareaProps={{
						placeholder:
							"e.g. You are a senior developer who prefers TypeScript. Always explain trade-offs and keep changes minimal.",
						disabled: loading,
						"aria-label": "Custom instructions",
					}}
				/>
			</div>
			<div className="flex items-center gap-2 mt-2">
				<button
					type="button"
					onClick={handleSave}
					disabled={loading || saving}
					className="px-2.5 py-1 text-[10px] font-medium bg-primary text-primary-foreground rounded hover:bg-primary/80 disabled:opacity-50 transition-colors"
				>
					{saving ? "Saving…" : "Save"}
				</button>
				{saved && (
					<span className="text-[10px] text-primary font-medium transition-opacity">
						Saved! Applied to this and new chats.
					</span>
				)}
			</div>
		</div>
	);
}
