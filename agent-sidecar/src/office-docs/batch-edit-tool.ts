import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { getOfficeCLIExecutor } from "./officecli-executor.js";
import { OfficeCLIError } from "./tool-types.js";

const BatchAction = Type.Object({
	action: Type.Union(
		[
			Type.Literal("add"),
			Type.Literal("set"),
			Type.Literal("remove"),
			Type.Literal("move"),
			Type.Literal("swap"),
		],
		{ description: "Operation to perform" },
	),
	domPath: Type.String({ description: "Target DOM path" }),
	targetDomPath: Type.Optional(
		Type.String({ description: "Destination DOM path (for move/swap)" }),
	),
	element: Type.Optional(Type.String({ description: "Element type (for add)" })),
	properties: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Element properties",
		}),
	),
	content: Type.Optional(Type.String({ description: "Text content" })),
});

export const BatchEditParams = Type.Object({
	path: Type.String({ description: "Path to the document" }),
	actions: Type.Array(BatchAction, {
		description: [
			"Array of actions to execute in a single save cycle.",
			"More efficient than individual tool calls.",
			"All actions are applied atomically in order.",
		].join("\n"),
		minItems: 1,
		maxItems: 50,
	}),
});

export type TBatchEditParams = Static<typeof BatchEditParams>;

export function createBatchEditTool(): ToolDefinition<typeof BatchEditParams> {
	return {
		name: "batch_edit",
		label: "Batch Edit",
		description: [
			"Execute multiple document operations in a single save cycle.",
			"More efficient than individual add/set/remove calls —",
			"especially for building slides with many elements or",
			"bulk formatting changes.",
			"",
			"Each action specifies an operation and its parameters.",
			"Actions execute in order within one save cycle.",
		].join("\n"),
		promptSnippet: "Execute multiple document operations atomically in one save cycle.",
		promptGuidelines: [
			"Use batch_edit instead of multiple add_element/set_element calls for better performance.",
			"Actions execute in order — later actions can reference earlier additions.",
			"Keep batches under 50 actions for reliability.",
			"After batch_edit, use read_document to verify and validate_document to check integrity.",
		],
		parameters: BatchEditParams,
		execute: async (_toolCallId, params) => {
			const executor = getOfficeCLIExecutor();

			try {
				const result = executor.batchEdit({
					path: params.path,
					actions: params.actions as any,
				});

				if (result.failed > 0) {
					const errorLines = result.errors.map((e) => `  [${e.index}] ${e.action}: ${e.error}`);
					return {
						content: [
							{
								type: "text" as const,
								text: [
									`⚠️ Batch edit: ${result.succeeded}/${result.totalActions} succeeded`,
									...errorLines,
								].join("\n"),
							},
						],
						details: result,
						isError: true,
					};
				}

				return {
					content: [
						{
							type: "text" as const,
							text: `✅ Batch edit complete: ${result.succeeded}/${result.totalActions} actions applied to ${params.path}`,
						},
					],
					details: result,
				};
			} catch (err) {
				if (err instanceof OfficeCLIError) {
					return {
						content: [{ type: "text" as const, text: `Batch edit failed: ${err.message}` }],
						details: { error: err.name, stderr: err.stderr },
						isError: true,
					};
				}
				throw err;
			}
		},
	};
}
