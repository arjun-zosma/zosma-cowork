import { CustomInstructions } from "../CustomInstructions";

export function Instructions() {
	return (
		<section>
			<h2 className="text-sm font-semibold text-foreground mb-1">Custom Instructions</h2>
			<p className="text-xs text-muted-foreground mb-5">
				Persist context, preferences, or constraints across every session. Written in Markdown and
				applied immediately to this chat and all new ones.
			</p>
			<CustomInstructions />
		</section>
	);
}
