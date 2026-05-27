/**
 * OfficeCLI Executor
 *
 * Provides a typed wrapper around the OfficeCLI binary for all document
 * operations. Each method maps to an OfficeCLI subcommand with proper
 * argument escaping, timeout management, and structured error handling.
 *
 * All methods accept an optional AbortSignal for cancellation.
 */

import { type ExecSyncOptions, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { getOfficeCLIResolver } from "./officecli-resolver.js";
import type {
	AddElementParams,
	BatchEditParams,
	BatchEditResult,
	CreateDocumentParams,
	CreateDocumentResult,
	DocumentInfo,
	OfficeCLIResult,
	PreviewDocumentParams,
	ReadDocumentParams,
	RemoveElementParams,
	SetElementParams,
	ToolExecutionContext,
	ValidateDocumentResult,
	ValidationIssue,
} from "./tool-types.js";
import { OfficeCLIError } from "./tool-types.js";

// ─── Constants ───────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;

// ─── Executor ─────────────────────────────────────────────────────────

export class OfficeCLIExecutor {
	private resolver = getOfficeCLIResolver();

	/**
	 * Get the resolved binary path.
	 * Throws if OfficeCLI is not installed and auto-download fails.
	 */
	private getBinaryPath(): string {
		return this.resolver.resolve().binaryPath;
	}

	// ─── Create Document ──────────────────────────────────────────────

	/**
	 * Create a new blank document.
	 * Type is inferred from file extension if not specified.
	 */
	createDocument(params: CreateDocumentParams, ctx?: ToolExecutionContext): CreateDocumentResult {
		const binary = this.getBinaryPath();
		const args = ["create", this.escapePath(params.path, ctx?.cwd)];
		if (params.template) {
			args.push("--template", this.escapePath(params.template, ctx?.cwd));
		}

		const result = this.execute(binary, args, ctx);

		// Determine type from extension or explicit param
		const ext = params.path.split(".").pop()?.toLowerCase() as "docx" | "pptx" | "xlsx" | undefined;
		const type = params.type ?? ext ?? "docx";

		return {
			path: params.path,
			type,
			sizeBytes: existsSync(params.path) ? require("node:fs").statSync(params.path).size : 0,
			created: result.success,
		};
	}

	// ─── Add Element ──────────────────────────────────────────────────

	/**
	 * Add an element to a document at the specified DOM path.
	 */
	addElement(params: AddElementParams, ctx?: ToolExecutionContext): OfficeCLIResult {
		const binary = this.getBinaryPath();
		const args = [
			"add",
			this.escapePath(params.path, ctx?.cwd),
			params.domPath,
			"--element",
			params.element,
		];

		if (params.content) {
			args.push("--content", params.content);
		}
		if (params.properties && Object.keys(params.properties).length > 0) {
			args.push("--properties", JSON.stringify(params.properties));
		}
		if (params.children && params.children.length > 0) {
			args.push("--children", JSON.stringify(params.children));
		}

		return this.execute(binary, args, ctx);
	}

	// ─── Set Element ──────────────────────────────────────────────────

	/**
	 * Set properties and/or content of an existing element.
	 */
	setElement(params: SetElementParams, ctx?: ToolExecutionContext): OfficeCLIResult {
		const binary = this.getBinaryPath();
		const args = [
			"set",
			this.escapePath(params.path, ctx?.cwd),
			params.domPath,
			"--properties",
			JSON.stringify(params.properties),
		];

		if (params.content !== undefined) {
			args.push("--content", params.content);
		}

		return this.execute(binary, args, ctx);
	}

	// ─── Remove Element ───────────────────────────────────────────────

	/**
	 * Remove an element from a document.
	 */
	removeElement(params: RemoveElementParams, ctx?: ToolExecutionContext): OfficeCLIResult {
		const binary = this.getBinaryPath();
		const args = ["remove", this.escapePath(params.path, ctx?.cwd), params.domPath];
		return this.execute(binary, args, ctx);
	}

	// ─── Read Document ────────────────────────────────────────────────

	/**
	 * Read/inspect a document in the specified mode.
	 */
	readDocument(params: ReadDocumentParams, ctx?: ToolExecutionContext): OfficeCLIResult {
		const binary = this.getBinaryPath();
		const args = ["view", this.escapePath(params.path, ctx?.cwd), params.mode];

		if (params.issueType) {
			args.push("--type", params.issueType);
		}
		if (params.limit !== undefined) {
			args.push("--limit", String(params.limit));
		}

		return this.execute(binary, args, ctx);
	}

	// ─── Validate Document ────────────────────────────────────────────

	/**
	 * Validate a document against the OpenXML schema.
	 * Returns structured validation results.
	 */
	validateDocument(params: { path: string }, ctx?: ToolExecutionContext): ValidateDocumentResult {
		const binary = this.getBinaryPath();
		const args = ["validate", this.escapePath(params.path, ctx?.cwd)];

		try {
			const result = this.execute(binary, args, ctx);
			// OfficeCLI outputs JSON for validate commands
			const parsed = JSON.parse(result.stdout) as {
				valid?: boolean;
				schemaValid?: boolean;
				issues?: ValidationIssue[];
			};
			return {
				valid: parsed.valid ?? result.success,
				schemaValid: parsed.schemaValid ?? result.success,
				issues: parsed.issues ?? [],
			};
		} catch (err) {
			if (err instanceof OfficeCLIError) {
				return {
					valid: false,
					schemaValid: false,
					issues: [
						{
							severity: "error",
							message: `Validation command failed: ${err.message}`,
						},
					],
				};
			}
			throw err;
		}
	}

	// ─── Batch Edit ──────────────────────────────────────────────────

	/**
	 * Execute multiple actions in a single save cycle.
	 * More efficient than individual add/set/remove calls.
	 */
	batchEdit(params: BatchEditParams, ctx?: ToolExecutionContext): BatchEditResult {
		const binary = this.getBinaryPath();
		const actionsJson = JSON.stringify({ actions: params.actions });

		// Write batch JSON to a temp file to avoid shell escaping issues
		const tmpFile = this.writeTempFile(actionsJson);

		try {
			const args = ["batch", this.escapePath(params.path, ctx?.cwd), "--actions", `@${tmpFile}`];

			const result = this.execute(binary, args, ctx);

			// Parse batch result from stdout
			const parsed = JSON.parse(result.stdout) as {
				total?: number;
				succeeded?: number;
				failed?: number;
				errors?: Array<{ index: number; action: string; error: string }>;
			};

			return {
				totalActions: parsed.total ?? params.actions.length,
				succeeded: parsed.succeeded ?? 0,
				failed: parsed.failed ?? 0,
				errors: parsed.errors ?? [],
			};
		} finally {
			// Clean up temp file
			try {
				require("node:fs").unlinkSync(tmpFile);
			} catch {
				// non-critical
			}
		}
	}

	// ─── Preview Document ────────────────────────────────────────────

	/**
	 * Start a preview server for the document.
	 * Opens browser if --browser is true (default).
	 * Returns the URL of the preview server.
	 */
	previewDocument(
		params: PreviewDocumentParams,
		ctx?: ToolExecutionContext,
	): { url: string; port: number } {
		const binary = this.getBinaryPath();
		const args = ["watch", this.escapePath(params.path, ctx?.cwd)];

		if (params.browser !== false) {
			args.push("--browser");
		}
		if (params.port) {
			args.push("--port", String(params.port));
		}

		// watch starts a server and returns immediately
		this.execute(binary, args, ctx);

		const port = params.port ?? 26315;
		return {
			url: `http://localhost:${port}`,
			port,
		};
	}

	// ─── Document Info ────────────────────────────────────────────────

	/**
	 * Get basic info about a document (type, size, counts).
	 */
	getDocumentInfo(params: { path: string }, ctx?: ToolExecutionContext): DocumentInfo {
		const binary = this.getBinaryPath();
		const args = ["view", this.escapePath(params.path, ctx?.cwd), "structure"];

		const result = this.execute(binary, args, ctx);

		// Try to parse structured output
		let docInfo: Partial<DocumentInfo> = {};
		try {
			docInfo = JSON.parse(result.stdout) as Partial<DocumentInfo>;
		} catch {
			// Parse information from text output
			docInfo = this.parseDocumentInfo(result.stdout, params.path);
		}

		const ext = params.path.split(".").pop()?.toLowerCase() as "docx" | "pptx" | "xlsx" | undefined;
		let sizeBytes = 0;
		try {
			sizeBytes = require("node:fs").statSync(params.path).size;
		} catch {
			// ignore
		}

		return {
			path: params.path,
			type: docInfo.type ?? ext ?? "docx",
			sizeBytes: docInfo.sizeBytes ?? sizeBytes,
			slideCount: docInfo.slideCount,
			sheetCount: docInfo.sheetCount,
			pageCount: docInfo.pageCount,
		};
	}

	// ─── Private Helpers ──────────────────────────────────────────────

	/**
	 * Execute a command against the OfficeCLI binary.
	 * Provides unified timeout, error handling, and result parsing.
	 */
	private execute(binary: string, args: string[], ctx?: ToolExecutionContext): OfficeCLIResult {
		const cmd = this.buildCommand(binary, args);

		const options: ExecSyncOptions = {
			encoding: "utf-8" as const,
			timeout: DEFAULT_TIMEOUT_MS,
			maxBuffer: 10 * 1024 * 1024, // 10MB
			cwd: ctx?.cwd,
			stdio: "pipe" as const,
		};

		try {
			const stdout = execSync(cmd, options) as string;
			return { stdout, stderr: "", exitCode: 0, success: true };
		} catch (err: unknown) {
			const error = err as {
				status?: number;
				stdout?: string;
				stderr?: string;
				message?: string;
			};
			const exitCode = error.status ?? 1;
			const stderr = error.stderr ?? "";
			const stdout = error.stdout ?? "";

			if (exitCode !== 0) {
				throw new OfficeCLIError(
					`OfficeCLI command failed (exit ${exitCode}): ${error.message ?? "unknown error"}`,
					exitCode,
					stderr,
				);
			}

			return { stdout, stderr, exitCode, success: exitCode === 0 };
		}
	}

	/**
	 * Build a properly escaped shell command string.
	 */
	private buildCommand(binary: string, args: string[]): string {
		const escaped = args.map((a) => this.escapeArg(a)).join(" ");
		return `"${binary}" ${escaped}`;
	}

	/**
	 * Escape a single argument for shell safety.
	 */
	private escapeArg(arg: string): string {
		if (/^[a-zA-Z0-9_./@~-]+$/.test(arg)) {
			return arg; // Safe, no escaping needed
		}
		// Use JSON.stringify for proper escaping
		return JSON.stringify(arg);
	}

	/**
	 * Resolve a path relative to cwd if it's relative.
	 */
	private escapePath(path: string, cwd?: string): string {
		if (!cwd || path.startsWith("/") || /^[A-Za-z]:\\/.test(path)) {
			return path; // absolute
		}
		return require("node:path").join(cwd, path);
	}

	/**
	 * Write a temp file for batch operations.
	 */
	private writeTempFile(content: string): string {
		const { writeFileSync, mkdtempSync } = require("node:fs") as typeof import("node:fs");
		const { join } = require("node:path") as typeof import("node:path");
		const { tmpdir } = require("node:os") as typeof import("node:os");

		const tmpDir = mkdtempSync(join(tmpdir(), "office-docs-"));
		const tmpFile = join(tmpDir, "batch.json");
		writeFileSync(tmpFile, content, "utf-8");
		return tmpFile;
	}

	/**
	 * Parse document info from text/structured output.
	 */
	private parseDocumentInfo(output: string, path: string): Partial<DocumentInfo> {
		const info: Partial<DocumentInfo> = {};

		const slideMatch = output.match(/(\d+)\s+slide[s]?/i);
		if (slideMatch) info.slideCount = Number(slideMatch[1]);

		const sheetMatch = output.match(/(\d+)\s+sheet[s]?/i);
		if (sheetMatch) info.sheetCount = Number(sheetMatch[1]);

		const pageMatch = output.match(/(\d+)\s+page[s]?/i);
		if (pageMatch) info.pageCount = Number(pageMatch[1]);

		return info;
	}
}

// ─── Singleton ───────────────────────────────────────────────────────

let _globalExecutor: OfficeCLIExecutor | null = null;

export function getOfficeCLIExecutor(): OfficeCLIExecutor {
	if (!_globalExecutor) {
		_globalExecutor = new OfficeCLIExecutor();
	}
	return _globalExecutor;
}

export function resetOfficeCLIExecutor(): void {
	_globalExecutor = null;
}
