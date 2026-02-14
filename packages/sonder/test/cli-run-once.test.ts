import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { runCommandOnce } from "../src/cli/run-once.js";

class MemoryWritable extends Writable {
	private chunks: string[] = [];

	_write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
		this.chunks.push(Buffer.from(chunk as Buffer).toString("utf8"));
		callback();
	}

	getText(): string {
		return this.chunks.join("");
	}
}

interface TestServer {
	baseUrl: string;
	close: () => Promise<void>;
}

async function withServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<TestServer> {
	const server = createServer(handler);
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Server address is unavailable");
	}

	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) reject(error);
					else resolve();
				});
			}),
	};
}

describe("runCommandOnce", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const directory of tempDirs) {
			rmSync(directory, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("supports save then ask via CLI runner", async () => {
		const server = await withServer((_request, response) => {
			response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			response.end("<html><body><h1>Test Article</h1><p>Body text</p></body></html>");
		});

		const root = mkdtempSync(join(tmpdir(), "sonder-cli-"));
		tempDirs.push(root);
		const stdout = new MemoryWritable();
		const stderr = new MemoryWritable();

		try {
			const saveExitCode = await runCommandOnce(
				["--root", root, "/save", `${server.baseUrl}/article`, "#agents"],
				stdout,
				stderr,
			);
			expect(saveExitCode).toBe(0);
			const saveOutput = JSON.parse(stdout.getText().trim()) as { type: string; itemId: string };
			expect(saveOutput.type).toBe("save");

			const listStdout = new MemoryWritable();
			const listExitCode = await runCommandOnce(["--root", root, "/list"], listStdout, stderr);
			expect(listExitCode).toBe(0);
			const listOutput = JSON.parse(listStdout.getText().trim()) as { type: string; items: Array<{ id: string }> };
			expect(listOutput.type).toBe("list");
			expect(listOutput.items[0].id).toBe(saveOutput.itemId);

			const askStdout = new MemoryWritable();
			const askExitCode = await runCommandOnce(
				["--root", root, "/ask", saveOutput.itemId, "what is this about?"],
				askStdout,
				stderr,
			);
			expect(askExitCode).toBe(0);
			const askOutput = JSON.parse(askStdout.getText().trim()) as { type: string; answer: string };
			expect(askOutput.type).toBe("ask");
			expect(askOutput.answer).toContain("Stub response");
		} finally {
			await server.close();
		}
	});

	it("returns usage error when command is missing", async () => {
		const stdout = new MemoryWritable();
		const stderr = new MemoryWritable();

		const exitCode = await runCommandOnce([], stdout, stderr);
		expect(exitCode).toBe(1);
		expect(stderr.getText()).toContain("Usage:");
	});

	it("returns runtime error when codex mode has no token or oauth credential", async () => {
		const server = await withServer((_request, response) => {
			response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			response.end("<html><body><h1>Test Article</h1><p>Body text</p></body></html>");
		});

		const root = mkdtempSync(join(tmpdir(), "sonder-cli-"));
		tempDirs.push(root);
		const saveStdout = new MemoryWritable();
		const stderr = new MemoryWritable();

		try {
			const saveExitCode = await runCommandOnce(
				["--root", root, "/save", `${server.baseUrl}/article`],
				saveStdout,
				stderr,
				{
					env: {
						SONDER_RESPONDER: "codex",
						SONDER_AUTH_PATH: join(root, "missing-auth.json"),
						SONDER_DISABLE_GLOBAL_AUTH: "1",
					},
				},
			);
			expect(saveExitCode).toBe(0);
			const saveOutput = JSON.parse(saveStdout.getText().trim()) as { itemId: string };

			const askStdout = new MemoryWritable();
			const askExitCode = await runCommandOnce(["--root", root, "/ask", saveOutput.itemId, "q"], askStdout, stderr, {
				env: {
					SONDER_RESPONDER: "codex",
					SONDER_AUTH_PATH: join(root, "missing-auth.json"),
					SONDER_DISABLE_GLOBAL_AUTH: "1",
				},
			});
			expect(askExitCode).toBe(1);
			const askError = JSON.parse(askStdout.getText().trim()) as { code: string; message: string };
			expect(askError.code).toBe("RUNTIME_ERROR");
			expect(askError.message).toContain("No Codex token available");
		} finally {
			await server.close();
		}
	});
});
