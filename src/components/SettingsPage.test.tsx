import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage";

// Mock child components that make Tauri IPC calls to avoid unhandled rejections
vi.mock("./ExtensionPanel", () => ({
	ExtensionPanel: function MockExt() {
		return null;
	},
}));

vi.mock("./SkillsPanel", () => ({
	SkillsPanel: function MockSkills() {
		return null;
	},
}));

vi.mock("./ProviderAuthSection", () => ({
	ProviderAuthSection: function MockAuth() {
		return null;
	},
}));

vi.mock("./CustomInstructions", () => ({
	CustomInstructions: function MockInstructions() {
		return null;
	},
}));

vi.mock("./FeedbackDialog", () => ({
	FeedbackDialog: function MockFeedback({ open }: { open: boolean }) {
		return open ? "FEEDBACK_DIALOG_OPEN" : null;
	},
}));

// Polyfill window.matchMedia for jsdom (needed by getSavedTheme)
beforeAll(() => {
	if (typeof window.matchMedia !== "function") {
		Object.defineProperty(window, "matchMedia", {
			writable: true,
			value: vi.fn().mockImplementation((query: string) => ({
				matches: false,
				media: query,
				onchange: null,
				addListener: vi.fn(),
				removeListener: vi.fn(),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn(),
			})),
		});
	}
});

describe("SettingsPage", () => {
	it("renders the close button", () => {
		const onClose = vi.fn();
		render(<SettingsPage onClose={onClose} />);
		expect(
			screen.getByRole("button", { name: /close/i }),
		).toBeDefined();
	});

	it("calls onClose when close button is clicked", () => {
		const onClose = vi.fn();
		render(<SettingsPage onClose={onClose} />);
		fireEvent.click(screen.getByRole("button", { name: /close/i }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("renders Authentication section heading", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		expect(screen.getByText("Authentication")).toBeDefined();
	});

	it("renders Extensions section heading", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		expect(screen.getByText("Extensions")).toBeDefined();
	});

	it("renders Skills section heading", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		expect(screen.getByText("Skills")).toBeDefined();
	});

	it("renders Theme section heading", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		expect(screen.getByText("Theme")).toBeDefined();
	});

	it("renders Custom Instructions section heading", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		expect(screen.getByText("Custom Instructions")).toBeDefined();
	});

	it("renders Telemetry section when provided", () => {
		render(
			<SettingsPage
				onClose={vi.fn()}
				telemetryEnabled={false}
				onTelemetryToggle={vi.fn()}
			/>,
		);
		expect(screen.getByText("Telemetry")).toBeDefined();
	});

	it("renders About section", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		expect(screen.getByText("About")).toBeDefined();
	});

	it("renders Send Feedback button", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		expect(screen.getByText("Send Feedback")).toBeDefined();
	});

	it("shows FeedbackDialog when Send Feedback is clicked", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		// Before click, no dialog
		expect(screen.queryByText("FEEDBACK_DIALOG_OPEN")).toBeNull();
		fireEvent.click(screen.getByText("Send Feedback"));
		// After click, dialog should be visible
		expect(screen.getByText("FEEDBACK_DIALOG_OPEN")).toBeDefined();
	});

	it("calls onClose when Escape key is pressed", () => {
		const onClose = vi.fn();
		render(<SettingsPage onClose={onClose} />);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
