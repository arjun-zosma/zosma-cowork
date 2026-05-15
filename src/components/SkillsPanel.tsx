import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

interface SkillResult {
	id: string;
	installCount: number;
	url: string;
}

interface InstalledSkill {
	name: string;
	path: string;
	scope: "project" | "global";
	agents: string[];
}

function formatInstallCount(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
	return String(count);
}

export function SkillsPanel() {
	const [query, setQuery] = useState("");
	const [searchResults, setSearchResults] = useState<SkillResult[]>([]);
	const [installed, setInstalled] = useState<InstalledSkill[]>([]);
	const [searching, setSearching] = useState(false);
	const [installing, setInstalling] = useState<string | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

		const loadInstalled = useCallback(async () => {
		try {
			const skills = await invoke<unknown>("list_skills");
			setInstalled(Array.isArray(skills) ? (skills as InstalledSkill[]) : []);
		} catch {
			setInstalled([]);
		}
	}, []);

	// Load installed skills on mount
	useEffect(() => {
		loadInstalled().catch(() => {});
	}, [loadInstalled]);

	// Debounced search
	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current);

		if (!query.trim()) {
			setSearchResults([]);
			setSearching(false);
			return;
		}

		setSearching(true);
		debounceRef.current = setTimeout(async () => {
			try {
				const result = await invoke<{ results: SkillResult[] }>("search_skills", {
					query: query.trim(),
				});
				setSearchResults(Array.isArray(result?.results) ? result.results : []);
			} catch {
				setSearchResults([]);
			} finally {
				setSearching(false);
			}
		}, 300);

		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [query]);

	const handleInstall = async (skillId: string) => {
		setInstalling(skillId);
		try {
			await invoke("install_skill", { source: skillId });
			await loadInstalled();
		} catch {
			// Silently fail
		} finally {
			setInstalling(null);
		}
	};

	const handleRemove = async (name: string) => {
		try {
			await invoke("remove_skill", { name });
			await loadInstalled();
		} catch {
			// Silently fail
		}
	};

	const isInstalled = (skillId: string): boolean => {
		const name = skillId.split("@").pop() || skillId;
		return installed.some((s) => s.name === name);
	};

	return (
		<div className="flex flex-col h-full overflow-hidden">
			{/* Header */}
			<div className="px-3 py-2 border-b border-sidebar-border">
				<p className="text-xs text-sidebar-foreground/50">
					Search and install agent skills from skills.sh
				</p>
			</div>

			{/* Search */}
			<div className="px-3 py-2">
				<input
					type="text"
					placeholder="Search skills..."
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					className="w-full px-2 py-1.5 text-xs bg-sidebar-background border border-sidebar-border rounded text-sidebar-foreground placeholder:text-sidebar-foreground/30 focus:outline-none focus:border-sidebar-accent"
				/>
			</div>

			{/* Scrollable results */}
			<div className="flex-1 overflow-y-auto px-3 pb-3 space-y-3">
				{/* Search Results */}
				{query.trim() && (
					<div>
						<p className="text-xs font-medium text-sidebar-foreground mb-1.5">
							Search results
						</p>
						{searching ? (
							<p className="text-xs text-sidebar-foreground/40">Searching...</p>
						) : searchResults.length === 0 ? (
							<p className="text-xs text-sidebar-foreground/40">
								No skills found for &ldquo;{query}&rdquo;
							</p>
						) : (
							<div className="space-y-1">
								{searchResults.map((skill) => (
									<div
										key={skill.id}
										className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-sidebar-background/50"
									>
										<div className="min-w-0 flex-1">
											<p className="text-xs text-sidebar-foreground truncate">
												{skill.id}
											</p>
											<p className="text-[10px] text-sidebar-foreground/40">
												{formatInstallCount(skill.installCount)} installs
											</p>
										</div>
										{isInstalled(skill.id) ? (
											<span className="text-[10px] text-sidebar-accent whitespace-nowrap">
												Installed
											</span>
										) : (
											<button
												type="button"
												title="Install skill"
												disabled={installing === skill.id}
												onClick={() => handleInstall(skill.id)}
												className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium text-white bg-primary rounded hover:bg-primary/80 disabled:opacity-50 transition-opacity"
											>
												{installing === skill.id ? "..." : "Install"}
											</button>
										)}
									</div>
								))}
							</div>
						)}
					</div>
				)}

				{/* Installed Skills */}
				<div>
					<p className="text-xs font-medium text-sidebar-foreground mb-1.5">
						Installed Skills
					</p>
					{installed.length === 0 ? (
						<p className="text-xs text-sidebar-foreground/40">
							No skills installed yet. Search above to find skills.
						</p>
					) : (
						<div className="space-y-1">
							{installed.map((skill) => (
								<div
									key={skill.name}
									className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-sidebar-background/50"
								>
									<div className="min-w-0 flex-1">
										<p className="text-xs text-sidebar-foreground truncate">
											{skill.name}
										</p>
										<p className="text-[10px] text-sidebar-foreground/40">
											{skill.scope}
											{skill.agents.length > 0 && ` · ${skill.agents.join(", ")}`}
										</p>
									</div>
									<button
										type="button"
										title="Remove skill"
										onClick={() => handleRemove(skill.name)}
										className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/60 border border-sidebar-border rounded hover:bg-sidebar-background/50 transition-colors"
									>
										Remove
									</button>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
