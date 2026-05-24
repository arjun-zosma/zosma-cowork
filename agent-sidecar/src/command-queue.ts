/**
 * Command Queue — allows the HTTP/WS remote server to inject commands
 * into the sidecar's command processing pipeline.
 *
 * The sidecar's main() function reads from stdin (piped from the Rust
 * backend). The remote server (HTTP/WebSocket) cannot write to our own
 * stdin. This queue bridges that gap: the remote server enqueues commands,
 * and the main loop processes them after each stdin line.
 *
 * Usage:
 *   // Enqueue (from remote-server.ts)
 *   import { commandQueue } from "./command-queue.js";
 *   commandQueue.enqueue({ type: "get_models", id: "http-xxx" });
 *
 *   // Dequeue (in main loop, after processing stdin line)
 *   import { commandQueue } from "./command-queue.js";
 *   while (commandQueue.hasPending()) {
 *     const cmd = commandQueue.dequeue();
 *     processCommand(cmd);
 *   }
 */

export interface QueuedCommand {
	type: string;
	id?: string;
	[key: string]: unknown;
}

class CommandQueue {
	private queue: QueuedCommand[] = [];
	// Max queue size to prevent memory leaks from runaway HTTP requests
	private readonly maxSize = 100;

	/**
	 * Enqueue a command from the remote server.
	 * Accepts any object with a `type` field.
	 * Returns true if queued, false if queue is full.
	 */
	enqueue(cmd: Record<string, unknown>): boolean {
		if (this.queue.length >= this.maxSize) {
			process.stderr.write("[command-queue] Queue full, dropping command\n");
			return false;
		}
		this.queue.push(cmd as QueuedCommand);
		return true;
	}

	/**
	 * Dequeue the next pending command.
	 */
	dequeue(): QueuedCommand | undefined {
		return this.queue.shift();
	}

	/**
	 * Check if there are pending commands.
	 */
	hasPending(): boolean {
		return this.queue.length > 0;
	}

	/**
	 * Number of pending commands.
	 */
	get length(): number {
		return this.queue.length;
	}

	/**
	 * Clear all pending commands.
	 */
	clear(): void {
		this.queue = [];
	}
}

export const commandQueue = new CommandQueue();
