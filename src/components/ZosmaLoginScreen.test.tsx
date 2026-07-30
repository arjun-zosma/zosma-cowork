import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZosmaLoginScreen } from "./ZosmaLoginScreen";

const mockStart = vi.fn();
const mockCancel = vi.fn();

vi.mock("@/hooks/useZosmaAuth", () => ({
	useZosmaAuth: () => ({
		phase: "idle",
		error: null,
		start: mockStart,
		cancel: mockCancel,
	}),
}));

describe("ZosmaLoginScreen", () => {
	beforeEach(() => {
		mockStart.mockReset();
		mockCancel.mockReset();
	});

	it("starts Google login before loading Cowork", async () => {
		render(<ZosmaLoginScreen onComplete={vi.fn()} />);

		expect(screen.getByRole("heading", { name: "Zosma Cowork" })).toBeInTheDocument();
		expect(screen.getByText(/Your work\. Amplified\./i)).toBeInTheDocument();

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
		});

		expect(mockStart).toHaveBeenCalledOnce();
	});
});
