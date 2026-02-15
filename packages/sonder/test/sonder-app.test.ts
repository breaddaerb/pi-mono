import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
				answer: "Thesis: optimize for local reasoning. [ann:seed] [art:primary]",
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

			const listResult = await app.processCommand("/list 1");
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

	it("finds saved items with weighted keyword ranking and snippets", async () => {
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

		app.itemsRepo.create({
			id: "item_find_1",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com/agent-language",
			whyNote: null,
			tags: ["agents"],
			topic: null,
			space: null,
		});
		const extractedPath = join(root, "find-extracted.txt");
		writeFileSync(extractedPath, "language design for agents", "utf8");
		app.artifactsRepo.create({
			id: "art_find_1",
			itemId: "item_find_1",
			kind: "extracted-text",
			path: extractedPath,
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});
		app.createAnnotation({
			itemId: "item_find_1",
			type: "note",
			text: "agent memory",
			comment: "important",
			tags: ["memory"],
		});

		app.itemsRepo.create({
			id: "item_find_2",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com/memory-overview",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		const extractedPath2 = join(root, "find-extracted-2.txt");
		writeFileSync(extractedPath2, "brief notes unrelated", "utf8");
		app.artifactsRepo.create({
			id: "art_find_2",
			itemId: "item_find_2",
			kind: "extracted-text",
			path: extractedPath2,
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});

		const findResult = await app.processCommand("/find memory 10");
		expect(findResult.ok).toBe(true);
		if (!findResult.ok || findResult.value.type !== "find") {
			throw new Error("Expected find result");
		}
		expect(findResult.value.items.length).toBeGreaterThan(1);
		expect(findResult.value.items[0].id).toBe("item_find_1");
		expect(findResult.value.items[0].reasons).toEqual(expect.arrayContaining(["annotations", "annotation-tags"]));
		expect(findResult.value.items[0].snippets.length).toBeGreaterThan(0);
		expect(findResult.value.items[0].snippets.join(" ").toLowerCase()).toContain("memory");
		expect(findResult.value.items[0].score).toBeGreaterThan(findResult.value.items[1].score);

		app.close();
	});

	it("creates lists and deletes annotations via commands", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-app-"));
		tempDirs.push(root);
		let lastPrompt = "";
		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async (input) => {
				lastPrompt = input.prompt;
				return {
					answer: "ok",
					model: "gpt-5",
					provider: "openai-codex",
					citations: [],
				};
			},
		});

		app.itemsRepo.create({
			id: "item_anno",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		app.artifactsRepo.create({
			id: "art_text",
			itemId: "item_anno",
			kind: "extracted-text",
			path: join(root, "missing.txt"),
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});

		try {
			const annotateResult = await app.processCommand("/annotate item_anno A durable claim #thesis");
			expect(annotateResult.ok).toBe(true);
			if (!annotateResult.ok || annotateResult.value.type !== "annotate") {
				throw new Error("Expected annotate result");
			}
			expect(annotateResult.value.annotation.type).toBe("note");
			expect(annotateResult.value.annotation.tags).toEqual(["thesis"]);
			expect(annotateResult.value.annotation.artifactId).toBe("art_text");

			const listResult = await app.processCommand("/ann list item_anno");
			expect(listResult.ok).toBe(true);
			if (!listResult.ok || listResult.value.type !== "ann-list") {
				throw new Error("Expected ann-list result");
			}
			expect(listResult.value.annotations).toHaveLength(1);

			const askResult = await app.processCommand("/ask item_anno what matters?");
			expect(askResult.ok).toBe(true);
			expect(lastPrompt).toContain("A durable claim");

			const deleteResult = await app.processCommand(`/ann del ${annotateResult.value.annotation.id}`);
			expect(deleteResult.ok).toBe(true);
			if (!deleteResult.ok || deleteResult.value.type !== "ann-del") {
				throw new Error("Expected ann-del result");
			}

			const listAfterDelete = await app.processCommand("/ann list item_anno");
			expect(listAfterDelete.ok).toBe(true);
			if (!listAfterDelete.ok || listAfterDelete.value.type !== "ann-list") {
				throw new Error("Expected ann-list result");
			}
			expect(listAfterDelete.value.annotations).toHaveLength(0);
		} finally {
			app.close();
		}
	});

	it("opens lists and resumes item dialogue sessions", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-app-"));
		tempDirs.push(root);
		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async (input) => ({
				answer: `A:${input.question}`,
				model: "gpt-5",
				provider: "openai-codex",
				citations: [],
			}),
		});

		app.itemsRepo.create({
			id: "item_dialogue",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		app.artifactsRepo.create({
			id: "art_dialogue",
			itemId: "item_dialogue",
			kind: "extracted-text",
			path: join(root, "missing.txt"),
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});

		try {
			const opened = app.openItemDialogue("item_dialogue");
			expect(opened.itemId).toBe("item_dialogue");

			const asked = await app.askInItemDialogue("item_dialogue", opened.sessionId, "hello");
			expect(asked.answer).toContain("A:hello");

			const sessions = app.listItemDialogues("item_dialogue");
			expect(sessions.length).toBeGreaterThan(0);

			const resumed = app.resumeItemDialogue(opened.sessionId);
			expect(resumed.sessionId).toBe(opened.sessionId);
		} finally {
			app.close();
		}
	});

	it("uses pasted text evidence when source fetch fails", async () => {
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
			snapshotFetchImpl: async () => {
				throw new Error("fetch failed");
			},
		});

		try {
			const saveResult = await app.saveFromInput({
				url: "https://x.com/example/status/1",
				pastedText: "manual evidence line 1\nmanual evidence line 2",
			});
			expect(saveResult.evidenceType).toBe("pasted_text");
			expect(saveResult.sourceStatus).toBe("fetch_failed");
			expect(saveResult.needsUserEvidence).toBe(false);

			const artifacts = app.artifactsRepo.listByItemId(saveResult.itemId);
			expect(artifacts.some((artifact) => artifact.kind === "evidence-md")).toBe(true);
			const extracted = artifacts.find((artifact) => artifact.kind === "extracted-text");
			if (!extracted) {
				throw new Error("Expected extracted artifact");
			}
			expect(readFileSync(extracted.path, "utf8")).toContain("manual evidence line 1");
		} finally {
			app.close();
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
