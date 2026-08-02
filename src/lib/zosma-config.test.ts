import { describe, expect, it } from "vitest";
import { normalizeZosmaConfig } from "./zosma-config";

describe("normalizeZosmaConfig", () => {
	it("normalizes HTTPS service URLs", () => {
		expect(
			normalizeZosmaConfig("https://auth.example.test/", "https://router.example.test/v1/"),
		).toEqual({
			authBaseUrl: "https://auth.example.test",
			routerBaseUrl: "https://router.example.test/v1",
		});
	});

	it("allows HTTP only for loopback development", () => {
		expect(normalizeZosmaConfig("http://localhost:3000/", "http://127.0.0.1:3001/v1/")).toEqual({
			authBaseUrl: "http://localhost:3000",
			routerBaseUrl: "http://127.0.0.1:3001/v1",
		});
	});

	it("rejects non-loopback HTTP URLs", () => {
		expect(() =>
			normalizeZosmaConfig("http://auth.example.test", "http://router.example.test/v1"),
		).toThrow("HTTPS");
	});

	it("rejects unexpected paths", () => {
		expect(() =>
			normalizeZosmaConfig("https://auth.example.test/api", "https://router.example.test/v1"),
		).toThrow("base URL");
	});
});
