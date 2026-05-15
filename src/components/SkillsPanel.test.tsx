import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SkillsPanel } from "./SkillsPanel";

// Track what mockInvoke returns for different commands
const mockInvoke = vi.fn();
const mockResponses = new Map<string, unknown>();

mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
	const key = cmd + (args ? JSON.stringify(args) : "");
	if (mockResponses.has(key)) return Promise.resolve(mockResponses.get(key));
	// Fallback: match just the command name
	for (const [k, v] of mockResponses) {
		if (k === cmd) return Promise.resolve(v);
	}
	return Promise.resolve(null);
});

function setMock(cmd: string, response: unknown, args?: Record<string, unknown>) {
	const key = args ? cmd + JSON.stringify(args) : cmd;
	mockResponses.set(key, response);
}

vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe("SkillsPanel", () => {
	beforeEach(() => {
		mockResponses.clear();
		// Default: no installed skills
		setMock("list_skills", []);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("renders the search input", () => {
		render(<SkillsPanel />);
		expect(screen.getByPlaceholderText("Search skills...")).toBeDefined();
	});

	it("renders section titles", () => {
		render(<SkillsPanel />);
		expect(screen.getByText("Installed Skills")).toBeDefined();
	});

	it("shows loading state while searching", async () => {
		setMock("search_skills", { results: [] });
		render(<SkillsPanel />);
		const input = screen.getByPlaceholderText("Search skills...");
		fireEvent.change(input, { target: { value: "typescript" } });
		// Should show section title immediately
		await vi.waitFor(() => {
			expect(screen.getByText("Search results")).toBeDefined();
		});
	});

	it("displays search results from IPC", async () => {
		setMock("search_skills", {
			results: [
				{
					id: "wshobson/agents@typescript-advanced-types",
					installCount: 41200,
					url: "https://skills.sh/wshobson/agents/typescript-advanced-types",
				},
				{
					id: "github/awesome-copilot@javascript-typescript-jest",
					installCount: 10500,
					url: "https://skills.sh/github/awesome-copilot/javascript-typescript-jest",
				},
			],
		});
		render(<SkillsPanel />);
		const input = screen.getByPlaceholderText("Search skills...");
		fireEvent.change(input, { target: { value: "typescript" } });
		await vi.waitFor(() => {
			expect(
				screen.getByText("wshobson/agents@typescript-advanced-types"),
			).toBeDefined();
		});
		expect(screen.getByText("41.2K installs")).toBeDefined();
	});

	it("displays installed skills from IPC on mount", async () => {
		setMock("list_skills", [
			{
				name: "find-skills",
				path: "/home/user/.agents/skills/find-skills",
				scope: "project",
				agents: ["Codex"],
			},
		]);
		render(<SkillsPanel />);
		await vi.waitFor(() => {
			expect(screen.getByText("find-skills")).toBeDefined();
		});
	});

	it("calls install_skill IPC when install button clicked", async () => {
		setMock("search_skills", {
			results: [{ id: "test/skill@my-skill", installCount: 100, url: "" }],
		});
		setMock("list_skills", []);
		setMock("install_skill", { success: true }, { source: "test/skill@my-skill" });
		render(<SkillsPanel />);
		const input = screen.getByPlaceholderText("Search skills...");
		fireEvent.change(input, { target: { value: "test" } });
		await vi.waitFor(() => {
			expect(screen.getByText("test/skill@my-skill")).toBeDefined();
		});
		const installBtn = screen.getByTitle("Install skill");
		fireEvent.click(installBtn);
		expect(mockInvoke).toHaveBeenCalledWith("install_skill", {
			source: "test/skill@my-skill",
		});
	});

	it("calls remove_skill IPC when remove button clicked", async () => {
		setMock("list_skills", [
			{
				name: "find-skills",
				path: "/path",
				scope: "project",
				agents: ["Codex"],
			},
		]);
		setMock("remove_skill", { success: true }, { name: "find-skills" });
		render(<SkillsPanel />);
		await vi.waitFor(() => {
			expect(screen.getByText("find-skills")).toBeDefined();
		});
		const removeBtn = screen.getByTitle("Remove skill");
		fireEvent.click(removeBtn);
		expect(mockInvoke).toHaveBeenCalledWith("remove_skill", { name: "find-skills" });
	});

	it("refreshes installed list after install", async () => {
		let skillsList: { name: string; path: string; scope: string; agents: string[] }[] =
			[];
		mockInvoke.mockImplementation((cmd: string) => {
			if (cmd === "search_skills")
				return Promise.resolve({
					results: [{ id: "test/skill@my-skill", installCount: 100, url: "" }],
				});
			if (cmd === "list_skills") return Promise.resolve(skillsList);
			if (cmd === "install_skill") {
				skillsList = [
					{
						name: "my-skill",
						path: "/p",
						scope: "project",
						agents: ["Pi"],
					},
				];
				return Promise.resolve({ success: true });
			}
			return Promise.resolve(null);
		});
		render(<SkillsPanel />);
		const input = screen.getByPlaceholderText("Search skills...");
		fireEvent.change(input, { target: { value: "test" } });
		await vi.waitFor(() => {
			expect(screen.getByText("test/skill@my-skill")).toBeDefined();
		});
		const installBtn = screen.getByTitle("Install skill");
		fireEvent.click(installBtn);
		await vi.waitFor(() => {
			expect(screen.getByText("my-skill")).toBeDefined();
		});
	});

	it("shows empty state when no installed skills", () => {
		render(<SkillsPanel />);
		expect(
			screen.getByText("No skills installed yet. Search above to find skills."),
		).toBeDefined();
	});

	it("shows empty results message when search returns nothing", async () => {
		setMock("search_skills", { results: [] });
		render(<SkillsPanel />);
		const input = screen.getByPlaceholderText("Search skills...");
		fireEvent.change(input, { target: { value: "zzznotexist" } });
		await vi.waitFor(() => {
			expect(mockInvoke).toHaveBeenCalledWith("search_skills", {
				query: "zzznotexist",
			});
		});
	});
});
