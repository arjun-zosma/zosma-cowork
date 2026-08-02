import { Dialog } from "@/components/ui/dialog";
import type { Phase as ZosmaAuthPhase } from "@/hooks/useZosmaAuth";
import { Loader2, XCircle } from "lucide-react";

export interface ZosmaRouterAnnouncementProps {
	open: boolean;
	phase: ZosmaAuthPhase;
	error?: string | null;
	onStartTrial: () => void;
	onCancelAuth: () => void;
	onDismiss: () => void;
}

export function ZosmaRouterAnnouncement({
	open,
	phase,
	error,
	onStartTrial,
	onCancelAuth,
	onDismiss,
}: ZosmaRouterAnnouncementProps) {
	if (!open) return null;

	const pending = phase === "starting" || phase === "waiting_browser" || phase === "completing";

	return (
		<Dialog open={open} onClose={onDismiss} labelledBy="zosma-router-announcement-title">
			<div className="brand-gradient rounded-2xl text-white">
				<div className="flex justify-center px-6 pt-6">
					<img
						src="/zosma-mark.png"
						alt="Zosma AI Router"
						className="h-14 w-14 rounded-xl shadow-lg"
						draggable={false}
					/>
				</div>

				<div className="px-6 pb-6 pt-4 text-center">
					<h2 id="zosma-router-announcement-title" className="text-lg font-semibold">
						Zosma AI Router is here
					</h2>
					<p className="mt-2 text-sm leading-relaxed text-white/90">
						One connection. Four Zosma models.
						<br />
						Mimo v2.5 · DeepSeek V4 Flash
						<br />
						GPT-5.6 Luna · GPT-5.6 Terra
					</p>
					<p className="mt-4 text-xs text-white/80">100 free requests every day.</p>

					<div className="mt-5 space-y-2">
						{pending ? (
							<>
								<div className="flex items-center justify-center gap-2 rounded-lg bg-white/15 px-4 py-2.5 text-sm">
									<Loader2 className="h-4 w-4 animate-spin" />
									{phase === "starting"
										? "Opening Google sign-in…"
										: phase === "waiting_browser"
											? "Complete sign-in in your browser"
											: "Loading your models…"}
								</div>
								<button
									type="button"
									onClick={onCancelAuth}
									className="w-full rounded-lg px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white"
								>
									Cancel
								</button>
							</>
						) : phase === "error" ? (
							<>
								<p className="flex items-center justify-center gap-1.5 text-xs text-white/90">
									<XCircle className="h-3.5 w-3.5" />
									{error ?? "Something went wrong. Please try again."}
								</p>
								<button
									type="button"
									onClick={onStartTrial}
									className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white"
								>
									Try again
								</button>
							</>
						) : (
							<button
								type="button"
								onClick={onStartTrial}
								className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white"
							>
								Start free trial
							</button>
						)}

						<button
							type="button"
							onClick={onDismiss}
							className="w-full rounded-lg px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white"
						>
							Not now
						</button>
					</div>
				</div>
			</div>
		</Dialog>
	);
}
