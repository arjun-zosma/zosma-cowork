// ─── OfficeCLI Binary Interface ──────────────────────────────────────

export interface OfficeCLIResult {
	/** stdout content */
	stdout: string;
	/** stderr content */
	stderr: string;
	/** Exit code (0 = success) */
	exitCode: number;
	/** Whether the operation completed without error */
	success: boolean;
}

// ─── Document Creation ───────────────────────────────────────────────

export interface CreateDocumentParams {
	/** Output file path (absolute or relative to cwd) */
	path: string;
	/** Document type (inferred from extension if omitted) */
	type?: "docx" | "pptx" | "xlsx";
	/** Optional template file path to base the document on */
	template?: string;
}

export interface CreateDocumentResult {
	path: string;
	type: "docx" | "pptx" | "xlsx";
	sizeBytes: number;
	created: boolean;
}

// ─── Element Operations ──────────────────────────────────────────────

export interface AddElementParams {
	/** Path to the document */
	path: string;
	/** DOM path (e.g., /slide[1], /document/body/p[3]) */
	domPath: string;
	/** Element type */
	element: string;
	/** Element properties (depends on element type) */
	properties?: Record<string, unknown>;
	/** Content text (for text elements) */
	content?: string;
	/** Child elements (for containers like tables, groups) */
	children?: Array<{
		element: string;
		content?: string;
		properties?: Record<string, unknown>;
	}>;
}

export interface SetElementParams {
	/** Path to the document */
	path: string;
	/** DOM path to the element */
	domPath: string;
	/** Properties to update */
	properties: Record<string, unknown>;
	/** Optional new content text */
	content?: string;
}

export interface RemoveElementParams {
	/** Path to the document */
	path: string;
	/** DOM path to the element */
	domPath: string;
}

// ─── Read / Inspect ──────────────────────────────────────────────────

export type ViewMode =
	| "outline" // Text outline of the document (quick overview)
	| "text" // Full text content
	| "html" // HTML rendering (for visual inspection)
	| "annotated" // Text with formatting annotations
	| "issues" // Quality/formatting issues
	| "structure"; // Document structure tree

export interface ReadDocumentParams {
	/** Path to the document */
	path: string;
	/** View mode */
	mode: ViewMode;
	/** Type filter for issues mode: "format" | "content" | "structure" */
	issueType?: "format" | "content" | "structure";
	/** Max issues to report */
	limit?: number;
}

// ─── Batch Operations ────────────────────────────────────────────────

export interface BatchAction {
	/** Action name: add | set | remove | move | swap */
	action: "add" | "set" | "remove" | "move" | "swap";
	/** DOM path */
	domPath: string;
	/** Target DOM path (for move/swap) */
	targetDomPath?: string;
	/** Element type (for add) */
	element?: string;
	/** Properties */
	properties?: Record<string, unknown>;
	/** Content */
	content?: string;
}

export interface BatchEditParams {
	/** Path to the document */
	path: string;
	/** Array of actions to execute in one save cycle */
	actions: BatchAction[];
}

export interface BatchEditResult {
	totalActions: number;
	succeeded: number;
	failed: number;
	errors: Array<{
		index: number;
		action: string;
		error: string;
	}>;
}

// ─── Preview ─────────────────────────────────────────────────────────

export interface PreviewDocumentParams {
	/** Path to the document */
	path: string;
	/** Whether to open in browser (default: true) */
	browser?: boolean;
	/** Port for the preview server (default: 26315) */
	port?: number;
}

// ─── Validation ──────────────────────────────────────────────────────

export interface ValidationIssue {
	severity: "error" | "warning" | "info";
	message: string;
	element?: string;
	rule?: string;
}

export interface ValidateDocumentResult {
	valid: boolean;
	issues: ValidationIssue[];
	schemaValid: boolean;
}

// ─── Document Info ───────────────────────────────────────────────────

export interface DocumentInfo {
	path: string;
	type: "docx" | "pptx" | "xlsx";
	sizeBytes: number;
	createdAt?: string;
	modifiedAt?: string;
	slideCount?: number; // PPTX only
	sheetCount?: number; // XLSX only
	pageCount?: number; // DOCX only
}

// ─── Error Types ─────────────────────────────────────────────────────

export class OfficeCLIError extends Error {
	constructor(
		message: string,
		public readonly exitCode: number,
		public readonly stderr: string,
	) {
		super(message);
		this.name = "OfficeCLIError";
	}
}

export class OfficeCLIDocumentNotFoundError extends OfficeCLIError {
	constructor(path: string, exitCode: number, stderr: string) {
		super(`Document not found: ${path}`, exitCode, stderr);
		this.name = "OfficeCLIDocumentNotFoundError";
	}
}

export class OfficeCLIValidationError extends OfficeCLIError {
	constructor(
		message: string,
		public readonly issues: ValidationIssue[],
		exitCode: number,
		stderr: string,
	) {
		super(message, exitCode, stderr);
		this.name = "OfficeCLIValidationError";
	}
}

// ─── Tool Execution Context ──────────────────────────────────────────

export interface ToolExecutionContext {
	/** Working directory for file resolution */
	cwd: string;
	/** Optional abort signal */
	signal?: AbortSignal;
}
