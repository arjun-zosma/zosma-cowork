import { trackEvent } from "@/lib/telemetry";
import { useCallback, useEffect, useState } from "react";

type Category = "bug" | "feature" | "general";

interface FeedbackDialogProps {
	open: boolean;
	onClose: () => void;
}

const CATEGORIES: { value: Category; label: string }[] = [
	{ value: "bug", label: "Bug Report" },
	{ value: "feature", label: "Feature Request" },
	{ value: "general", label: "General" },
];

export function FeedbackDialog({ open, onClose }: FeedbackDialogProps) {
	const [category, setCategory] = useState<Category>("general");
	const [message, setMessage] = useState("");
	const [email, setEmail] = useState("");

	// Reset when dialog opens
	useEffect(() => {
		if (open) {
			setCategory("general");
			setMessage("");
			setEmail("");
		}
	}, [open]);

	const handleSubmit = useCallback(() => {
		if (!message.trim()) return;
		trackEvent("app_feedback", {
			category,
			message: message.trim(),
		});
		onClose();
	}, [message, category, onClose]);

	const handleOverlayClick = useCallback(
		(e: React.MouseEvent | React.KeyboardEvent) => {
			if ("key" in e) {
				if (e.key === "Escape") onClose();
			} else if (e.target === e.currentTarget) {
				onClose();
			}
		},
		[onClose],
	);

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			onClick={handleOverlayClick}
			onKeyDown={handleOverlayClick}
		>
			<div className="w-full max-w-md mx-4 bg-background border border-border rounded-lg shadow-lg">
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-border">
					<h2 className="text-sm font-semibold text-foreground">Send Feedback</h2>
					<button
						type="button"
						onClick={onClose}
						className="text-muted-foreground hover:text-foreground text-lg leading-none"
					>
						&times;
					</button>
				</div>

				{/* Body */}
				<div className="p-4 space-y-3">
					{/* Category */}
					<div>
						<p className="text-xs font-medium text-foreground mb-1.5">Category</p>
						<div className="flex gap-2">
							{CATEGORIES.map((cat) => (
								<button
									key={cat.value}
									type="button"
									onClick={() => setCategory(cat.value)}
									className={`px-3 py-1 text-xs rounded-full border transition-colors ${
										category === cat.value
											? "bg-primary text-primary-foreground border-primary"
											: "bg-background text-muted-foreground border-border hover:border-primary/50"
									}`}
								>
									{cat.label}
								</button>
							))}
						</div>
					</div>

					{/* Message */}
					<div>
						<textarea
							placeholder="Describe your feedback in detail..."
							value={message}
							onChange={(e) => setMessage(e.target.value)}
							rows={5}
							className="w-full px-3 py-2 text-sm bg-background border border-border rounded resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
						/>
					</div>

					{/* Email */}
					<div>
						<input
							type="email"
							placeholder="Email (optional, if you'd like a reply)"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
						/>
					</div>
				</div>

				{/* Footer */}
				<div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
					<button
						type="button"
						onClick={onClose}
						className="px-3 py-1.5 text-xs font-medium text-muted-foreground border border-border rounded hover:bg-muted/50 transition-colors"
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={!message.trim()}
						onClick={handleSubmit}
						className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
					>
						Submit Feedback
					</button>
				</div>
			</div>
		</div>
	);
}
