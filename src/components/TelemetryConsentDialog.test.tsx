import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TelemetryConsentDialog } from "./TelemetryConsentDialog";

describe("TelemetryConsentDialog", () => {
	it("renders the title", () => {
		render(<TelemetryConsentDialog onEnable={vi.fn()} onDismiss={vi.fn()} />);
		expect(screen.getByText("Help improve Zosma Cowork")).toBeInTheDocument();
	});

	it("renders both action buttons", () => {
		render(<TelemetryConsentDialog onEnable={vi.fn()} onDismiss={vi.fn()} />);
		expect(screen.getByText("Not Now")).toBeInTheDocument();
		expect(screen.getByText("Enable Telemetry")).toBeInTheDocument();
	});

	it("calls onEnable when Enable Telemetry is clicked", async () => {
		const onEnable = vi.fn();
		render(<TelemetryConsentDialog onEnable={onEnable} onDismiss={vi.fn()} />);
		await userEvent.click(screen.getByText("Enable Telemetry"));
		expect(onEnable).toHaveBeenCalledOnce();
	});

	it("calls onDismiss when Not Now is clicked", async () => {
		const onDismiss = vi.fn();
		render(<TelemetryConsentDialog onEnable={vi.fn()} onDismiss={onDismiss} />);
		await userEvent.click(screen.getByText("Not Now"));
		expect(onDismiss).toHaveBeenCalledOnce();
	});

	it("shows privacy bullet points", () => {
		render(<TelemetryConsentDialog onEnable={vi.fn()} onDismiss={vi.fn()} />);
		expect(screen.getByText(/No personal data collected/i)).toBeInTheDocument();
		expect(screen.getByText(/No user IDs or cookies/i)).toBeInTheDocument();
	});

	it("shows footer note about settings", () => {
		render(<TelemetryConsentDialog onEnable={vi.fn()} onDismiss={vi.fn()} />);
		expect(screen.getByText(/You can change this anytime in Settings/i)).toBeInTheDocument();
	});
});
