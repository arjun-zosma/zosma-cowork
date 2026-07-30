import { useZosmaAuth } from "@/hooks/useZosmaAuth";
import { Loader2, XCircle } from "lucide-react";

interface Props {
	onComplete: () => void;
}

export function ZosmaLoginScreen({ onComplete }: Props) {
	const { phase, error, start, cancel } = useZosmaAuth({ onComplete });
	const working = phase === "starting" || phase === "completing";

	return (
		<div className="flex flex-1 flex-col items-center justify-center p-8">
			<div className="w-full max-w-sm space-y-6 text-center">
				<img
					src="/zosma-mark.png"
					alt="Zosma Cowork"
					className="mx-auto h-16 w-16 rounded-2xl shadow-lg"
					draggable={false}
				/>
				<div className="space-y-2">
					<h1 className="text-2xl font-semibold text-foreground">Zosma Cowork</h1>
					<p className="text-sm leading-relaxed text-muted-foreground">Your work. Amplified.</p>
				</div>

				{phase === "waiting_browser" ? (
					<div className="space-y-3">
						<div className="flex items-center justify-center gap-2 text-sm text-foreground">
							<Loader2 className="h-4 w-4 animate-spin text-primary" />
							Complete sign-in in your browser
						</div>
						<button
							type="button"
							onClick={cancel}
							className="w-full rounded-lg bg-muted/50 px-4 py-2 text-sm font-medium text-muted-foreground"
						>
							Cancel
						</button>
					</div>
				) : working ? (
					<div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin text-primary" />
						{phase === "starting" ? "Opening Google sign-in..." : "Loading your models..."}
					</div>
				) : (
					<div className="space-y-3">
						{error && (
							<p className="flex items-center justify-center gap-1 text-sm text-destructive">
								<XCircle className="h-4 w-4" /> {error}
							</p>
						)}
						<button
							type="button"
							onClick={start}
							className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
						>
							Continue with Google
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
