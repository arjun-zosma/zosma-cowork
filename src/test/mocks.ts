import { vi } from "vitest";

/**
 * Mock Tauri `invoke` function.
 * Provide an optional implementation for specific commands.
 */
export function mockInvoke(impl?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>) {
	const mock = vi.fn();
	if (impl) mock.mockImplementation(impl);
	vi.mock("@tauri-apps/api/core", () => ({
		invoke: mock,
	}));
	return mock;
}

/**
 * Mock @tauri-apps/plugin-fs readTextFile.
 */
export function mockReadTextFile(impl?: (path: string) => Promise<string>) {
	const mock = vi.fn();
	if (impl) mock.mockImplementation(impl);
	vi.mock("@tauri-apps/plugin-fs", () => ({
		readTextFile: mock,
	}));
	return mock;
}

/**
 * Mock @tauri-apps/plugin-fs readFile (binary).
 */
export function mockReadFile(impl?: (path: string) => Promise<Uint8Array>) {
	const mock = vi.fn();
	if (impl) mock.mockImplementation(impl);
	vi.mock("@tauri-apps/plugin-fs", () => ({
		readFile: mock,
	}));
	return mock;
}

/**
 * Restore all Vitest mocks.
 */
export function cleanupMocks() {
	vi.restoreAllMocks();
}
