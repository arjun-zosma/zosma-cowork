/**
 * SkillTile — an app-store style tile for a single skill. Clicking the tile
 * opens the SKILL.md reader; the install / remove action lives in the corner
 * and stops propagation so it doesn't trigger the reader.
 */

import { cn } from "@/lib/utils";
import { Download } from "lucide-react";
import { useCallback } from "react";
import { formatInstallCount } from "../../lib/skillRegistry";
import { TileAvatar } from "./StoreUI";

export interface SkillTileData {
	id: string;
	displayName: string;
	source?: string;
	category?: string;
	installCount?: number;
}

export function SkillTile({
	skill,
	installed,
	installing,
	removable = true,
	onOpen,
	onInstall,
	onRemove,
}: {
	skill: SkillTileData;
	installed: boolean;
	installing: boolean;
	removable?: boolean;
	onOpen: (id: string) => void;
	onInstall: (id: string) => void;
	onRemove: (id: string) => void;
}) {
	const open = useCallback(() => onOpen(skill.id), [onOpen, skill.id]);

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={open}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					open();
				}
			}}
			aria-label={`Open ${skill.displayName}`}
			className="glass group relative flex flex-col gap-2.5 p-3.5 !rounded-2xl hover:border-primary/30 hover:shadow-md transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
		>
			<div className="flex items-start gap-3">
				<TileAvatar seed={skill.id} label={skill.displayName} className="w-11 h-11 text-base" />
				<div className="min-w-0 flex-1">
					<p className="text-sm font-semibold text-foreground truncate leading-tight">
						{skill.displayName}
					</p>
					{skill.source && (
						<p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">{skill.source}</p>
					)}
				</div>
			</div>

			<div className="flex items-center justify-between gap-2 mt-auto">
				<div className="flex items-center gap-2 min-w-0">
					{skill.category && (
						<span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground/80 shrink-0">
							{skill.category}
						</span>
					)}
					{typeof skill.installCount === "number" && skill.installCount > 0 && (
						<span className="text-[10px] text-muted-foreground/60 flex items-center gap-1 shrink-0">
							<Download className="w-3 h-3 opacity-60" />
							{formatInstallCount(skill.installCount)}
						</span>
					)}
				</div>

				{installed && removable ? (
					<button
						type="button"
						title="Remove skill"
						aria-label={`Remove ${skill.displayName}`}
						onClick={(e) => {
							e.stopPropagation();
							onRemove(skill.id);
						}}
						className="shrink-0 px-2.5 py-1 text-[11px] font-medium rounded-lg border border-border/70 text-muted-foreground hover:text-destructive hover:border-destructive/40 hover:bg-destructive/10 transition-colors"
					>
						Remove
					</button>
				) : installed && !removable ? (
					<span className="shrink-0 px-2.5 py-1 text-[11px] font-medium rounded-lg border border-border/50 text-muted-foreground/60">
						System
					</span>
				) : installed ? (
					<span className="shrink-0 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-primary/10 text-primary">
						Installed
					</span>
				) : (
					<button
						type="button"
						title="Install skill"
						aria-label={`Install ${skill.displayName}`}
						disabled={installing}
						onClick={(e) => {
							e.stopPropagation();
							onInstall(skill.id);
						}}
						className={cn(
							"shrink-0 px-3 py-1 text-[11px] font-semibold rounded-lg transition-all",
							installing
								? "bg-muted text-muted-foreground"
								: "bg-primary text-primary-foreground hover:brightness-110",
						)}
					>
						{installing ? "…" : "Install"}
					</button>
				)}
			</div>
		</div>
	);
}
