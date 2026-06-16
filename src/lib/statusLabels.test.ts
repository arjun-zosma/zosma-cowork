import type { ToolCallInfo } from "@/types";
import { describe, expect, it } from "vitest";
import { clubActivities, friendlyToolPhrase, headlineActivity, hostFromUrl } from "./statusLabels";

function tc(
	name: string,
	status: ToolCallInfo["status"] = "completed",
	id = Math.random().toString(36).slice(2),
	args: Record<string, unknown> = {},
): ToolCallInfo {
	return { id, name, args, status };
}

describe("friendlyToolPhrase", () => {
	it("maps known tools to friendly phrases", () => {
		expect(friendlyToolPhrase("write")).toBe("Creating a document");
		expect(friendlyToolPhrase("edit")).toBe("Updating a document");
		expect(friendlyToolPhrase("read")).toBe("Reading your files");
		expect(friendlyToolPhrase("bash")).toBe("Working in your workspace");
		expect(friendlyToolPhrase("web_search")).toBe("Searching the web");
	});

	it("groups file-search tools under one phrase", () => {
		expect(friendlyToolPhrase("ls")).toBe("Looking through files");
		expect(friendlyToolPhrase("find")).toBe("Looking through files");
		expect(friendlyToolPhrase("grep")).toBe("Looking through files");
	});

	it("normalizes provider-namespaced tools by prefix", () => {
		expect(friendlyToolPhrase("google_docs_create")).toBe("Working on your document");
		expect(friendlyToolPhrase("google_sheets_update_values")).toBe("Working on your spreadsheet");
		expect(friendlyToolPhrase("google_slides_read")).toBe("Working on your slides");
	});

	it("is case-insensitive", () => {
		expect(friendlyToolPhrase("WRITE")).toBe("Creating a document");
	});

	it("falls back for unknown tools", () => {
		expect(friendlyToolPhrase("some_mystery_tool")).toBe("Working on it");
	});

	it("maps agentic browser tools to plain phrases", () => {
		expect(friendlyToolPhrase("browser_snapshot")).toBe("Reading the page");
		expect(friendlyToolPhrase("browser_extract")).toBe("Reading the page");
		expect(friendlyToolPhrase("browser_click")).toBe("Clicking on the page");
		expect(friendlyToolPhrase("browser_type")).toBe("Filling in the page");
		expect(friendlyToolPhrase("browser_close")).toBe("Closing the browser");
	});

	it("surfaces the domain for browser_navigate when a url is given", () => {
		expect(
			friendlyToolPhrase("browser_navigate", { url: "https://www.example.com/path?q=1" }),
		).toBe("Browsing example.com");
		expect(friendlyToolPhrase("browser_navigate", { url: "example.org" })).toBe(
			"Browsing example.org",
		);
	});

	it("falls back to a generic browse phrase without a usable url", () => {
		expect(friendlyToolPhrase("browser_navigate")).toBe("Browsing the web");
		expect(friendlyToolPhrase("browser_navigate", { url: "" })).toBe("Browsing the web");
		expect(friendlyToolPhrase("browser_navigate", { url: 42 })).toBe("Browsing the web");
	});

	it("never leaks raw browser tool names", () => {
		expect(friendlyToolPhrase("browser_unknown_future_tool")).toBe("Browsing the web");
	});
});

describe("hostFromUrl", () => {
	it("strips protocol, www, and path", () => {
		expect(hostFromUrl("https://www.example.com/a/b?c=1")).toBe("example.com");
		expect(hostFromUrl("http://docs.example.co.uk/page")).toBe("docs.example.co.uk");
	});

	it("assumes https for bare hosts", () => {
		expect(hostFromUrl("example.com")).toBe("example.com");
	});

	it("returns empty string for non-urls", () => {
		expect(hostFromUrl("")).toBe("");
		expect(hostFromUrl(undefined)).toBe("");
		expect(hostFromUrl(123)).toBe("");
	});
});

describe("clubActivities", () => {
	it("merges consecutive same-phrase calls with counts", () => {
		const activities = clubActivities([tc("read"), tc("read"), tc("read")]);
		expect(activities).toHaveLength(1);
		expect(activities[0].phrase).toBe("Reading your files");
		expect(activities[0].count).toBe(3);
	});

	it("clubs file-search tools (ls/find/grep) together", () => {
		const activities = clubActivities([tc("ls"), tc("grep"), tc("find")]);
		expect(activities).toHaveLength(1);
		expect(activities[0].count).toBe(3);
		expect(activities[0].phrase).toBe("Looking through files");
	});

	it("renders a browser session as domain → read → act activities", () => {
		const activities = clubActivities([
			tc("browser_navigate", "completed", "a", { url: "https://example.com" }),
			tc("browser_snapshot", "completed", "b"),
			tc("browser_extract", "completed", "c"),
			tc("browser_click", "running", "d"),
		]);
		// snapshot + extract both map to "Reading the page" and club together.
		expect(activities.map((a) => a.phrase)).toEqual([
			"Browsing example.com",
			"Reading the page",
			"Clicking on the page",
		]);
		expect(activities[1].count).toBe(2);
	});

	it("keeps distinct phrases as separate ordered activities", () => {
		const activities = clubActivities([tc("read"), tc("read"), tc("write"), tc("read")]);
		expect(activities.map((a) => a.phrase)).toEqual([
			"Reading your files",
			"Creating a document",
			"Reading your files",
		]);
		expect(activities[0].count).toBe(2);
		expect(activities[2].count).toBe(1);
	});

	it("aggregates status: error wins, then running, then completed", () => {
		expect(clubActivities([tc("read", "completed"), tc("read", "error")])[0].status).toBe("error");
		expect(clubActivities([tc("read", "completed"), tc("read", "running")])[0].status).toBe(
			"running",
		);
		expect(clubActivities([tc("read", "completed"), tc("read", "completed")])[0].status).toBe(
			"completed",
		);
	});

	it("returns empty array for no tool calls", () => {
		expect(clubActivities([])).toEqual([]);
	});

	it("produces stable unique keys", () => {
		const activities = clubActivities([tc("read"), tc("write"), tc("read")]);
		const keys = activities.map((a) => a.key);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe("headlineActivity", () => {
	it("returns null when no tools", () => {
		expect(headlineActivity([])).toBeNull();
	});

	it("prefers the running activity", () => {
		const headline = headlineActivity([tc("read", "completed"), tc("web_search", "running")]);
		expect(headline?.phrase).toBe("Searching the web");
		expect(headline?.status).toBe("running");
	});

	it("falls back to the most recent activity when nothing is running", () => {
		const headline = headlineActivity([tc("read", "completed"), tc("write", "completed")]);
		expect(headline?.phrase).toBe("Creating a document");
	});
});
