import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SonderApp } from "../src/app/index.js";

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

describe("SonderApp", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const directory of tempDirs) {
			rmSync(directory, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("executes /save then /ask end-to-end", async () => {
		const server = await withServer((_request, response) => {
			response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			response.end(`
				<html>
					<body>
						<h1>A Language For Agents</h1>
						<p>Local reasoning and explicit flow context are key themes.</p>
					</body>
				</html>
			`);
		});

		const root = mkdtempSync(join(tmpdir(), "sonder-app-"));
		tempDirs.push(root);

		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async (_input) => ({
				answer: `Thesis: optimize for local reasoning. [ann:seed] [art:primary]`,
				model: "gpt-5",
				provider: "openai-codex",
				citations: ["ann:seed", "art:primary"],
				thinking: "hidden",
			}),
		});

		try {
			const saveResult = await app.processCommand(`/save ${server.baseUrl}/article #agents #language`);
			expect(saveResult.ok).toBe(true);
			if (!saveResult.ok || saveResult.value.type !== "save") {
				throw new Error("Expected save result");
			}
			expect(saveResult.value.usedFallback).toBe(false);
			expect(saveResult.value.tags).toEqual(["agents", "language"]);
			expect(saveResult.value.artifactIds.length).toBeGreaterThanOrEqual(3);

			const itemId = saveResult.value.itemId;
			const askResult = await app.processCommand(`/ask ${itemId} what is the thesis?`);
			expect(askResult.ok).toBe(true);
			if (!askResult.ok || askResult.value.type !== "ask") {
				throw new Error("Expected ask result");
			}

			expect(askResult.value.itemId).toBe(itemId);
			expect(askResult.value.answer).toContain("[ann:seed]");
			expect(askResult.value.citations).toEqual(["ann:seed", "art:primary"]);

			const turns = app.dialogueRepo.listTurnsBySessionId(askResult.value.sessionId);
			expect(turns).toHaveLength(2);
			expect(turns[1].thinking).toBeNull();
		} finally {
			app.close();
			await server.close();
		}
	});

	it("lists saved items via /list", async () => {
		const server = await withServer((_request, response) => {
			response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			response.end("<html><body><h1>Item</h1></body></html>");
		});

		const root = mkdtempSync(join(tmpdir(), "sonder-app-"));
		tempDirs.push(root);
		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async () => ({
				answer: "unused",
				model: "gpt-5",
				provider: "openai-codex",
				citations: [],
			}),
		});

		try {
			const saveResult = await app.processCommand(`/save ${server.baseUrl}/article #agents`);
			expect(saveResult.ok).toBe(true);

			const listResult = await app.processCommand("/list");
			expect(listResult.ok).toBe(true);
			if (!listResult.ok || listResult.value.type !== "list") {
				throw new Error("Expected list result");
			}
			expect(listResult.value.items.length).toBe(1);
			expect(listResult.value.items[0].tags).toEqual(["agents"]);
		} finally {
			app.close();
			await server.close();
		}
	});

	it("returns parser errors for unsupported commands", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-app-"));
		tempDirs.push(root);
		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async () => ({
				answer: "unused",
				model: "gpt-5",
				provider: "openai-codex",
				citations: [],
			}),
		});

		try {
			const result = await app.processCommand("/open item_1");
			expect(result.ok).toBe(false);
			if (result.ok) {
				throw new Error("Expected parser error");
			}
			expect(result.error.code).toBe("UNSUPPORTED_COMMAND");
		} finally {
			app.close();
		}
	});
});
