import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ZosmaRouterAnnouncement } from "./ZosmaRouterAnnouncement";

const renderAnnouncement = (props = {}) =>
	render(
		<ZosmaRouterAnnouncement
			open={true}
			phase="idle"
			onStartTrial={vi.fn()}
			onCancelAuth={vi.fn()}
			onDismiss={vi.fn()}
			{...props}
		/>,
	);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("ZosmaRouterAnnouncement", () => {
	it("renders required copy and logo", () => {
		renderAnnouncement();
		expect(screen.getByText(/Zosma AI Router is here/i)).toBeTruthy();
		expect(screen.getByText(/Mimo v2\.5/i)).toBeTruthy();
		expect(screen.getByText(/DeepSeek V4 Flash/i)).toBeTruthy();
		expect(screen.getByText(/GPT-5\.6 Luna/i)).toBeTruthy();
		expect(screen.getByText(/GPT-5\.6 Terra/i)).toBeTruthy();
		expect(screen.getByText(/100 free requests every day/i)).toBeTruthy();
		expect(screen.getByRole("button", { name: /Start free trial/i })).toBeTruthy();
		expect(screen.getByRole("button", { name: /Not now/i })).toBeTruthy();
		expect(screen.getByAltText(/Zosma/i)).toBeTruthy();
	});

	it("Start free trial calls onStartTrial", () => {
		const onStartTrial = vi.fn();
		render(
			<ZosmaRouterAnnouncement
				open
				phase="idle"
				onStartTrial={onStartTrial}
				onCancelAuth={vi.fn()}
				onDismiss={vi.fn()}
			/>,
		);
		screen.getByRole("button", { name: /Start free trial/i }).click();
		expect(onStartTrial).toHaveBeenCalled();
	});

	it("Not now calls onDismiss", () => {
		const onDismiss = vi.fn();
		render(
			<ZosmaRouterAnnouncement
				open
				phase="idle"
				onStartTrial={vi.fn()}
				onCancelAuth={vi.fn()}
				onDismiss={onDismiss}
			/>,
		);
		screen.getByRole("button", { name: /Not now/i }).click();
		expect(onDismiss).toHaveBeenCalled();
	});

	it("waiting_browser shows browser instruction and Cancel", () => {
		renderAnnouncement({ phase: "waiting_browser" });
		expect(screen.getByText(/Complete sign-in in your browser/i)).toBeTruthy();
		expect(screen.getByRole("button", { name: /Cancel/i })).toBeTruthy();
	});

	it("error shows Try again button and Not now", () => {
		renderAnnouncement({ phase: "error", error: "Sign-in session expired. Please try again." });
		expect(screen.getByRole("button", { name: /Try again/i })).toBeTruthy();
		expect(screen.getByRole("button", { name: /Not now/i })).toBeTruthy();
	});

	it("does not render when not open", () => {
		const { container } = render(
			<ZosmaRouterAnnouncement
				open={false}
				phase="idle"
				onStartTrial={vi.fn()}
				onCancelAuth={vi.fn()}
				onDismiss={vi.fn()}
			/>,
		);
		expect(container.firstChild).toBeNull();
	});

	it("does not leak credential-like strings into the DOM", () => {
		const { container } = renderAnnouncement({
			phase: "error",
			error: "Something went wrong. Please try again.",
		});
		const html = container.innerHTML;
		expect(html).not.toContain("access_token");
		expect(html).not.toContain("refresh_token");
		expect(html).not.toContain("code_verifier");
		expect(html).not.toContain("device_key");
		expect(html).not.toContain("authorization_code");
	});
});
