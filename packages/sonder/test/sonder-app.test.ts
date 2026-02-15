import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

	it("applies xiaohongshu cleanup only for retrieval without mutating stored extracted text", async () => {
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
			id: "item_xhs_find",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://www.xiaohongshu.com/discovery/item/abc",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		const extractedPath = join(root, "xhs-extracted.txt");
		writeFileSync(
			extractedPath,
			"小红书 创作中心 沪ICP备13030189号 沪B2-20150021 (沪)网械平台备字[2019]第00006号 (沪)-经营性-2023-0144 沪网文(2024)1344-086号 网信算备310101216601302230019号 上海市互联网举报中心 网上有害信息举报专区 © 2014-2024 行吟信息科技（上海）有限公司\n真正内容：奖励函数需要防止被 hack。",
			"utf8",
		);
		app.artifactsRepo.create({
			id: "art_xhs_find",
			itemId: "item_xhs_find",
			kind: "extracted-text",
			path: extractedPath,
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});

		try {
			const boilerplateFind = await app.processCommand("/find 沪ICP备 5");
			expect(boilerplateFind.ok).toBe(true);
			if (!boilerplateFind.ok || boilerplateFind.value.type !== "find") {
				throw new Error("Expected find result");
			}
			expect(boilerplateFind.value.items).toHaveLength(0);

			const filingFind = await app.processCommand("/find 沪B2-20150021 5");
			expect(filingFind.ok).toBe(true);
			if (!filingFind.ok || filingFind.value.type !== "find") {
				throw new Error("Expected find result");
			}
			expect(filingFind.value.items).toHaveLength(0);

			const licenseFind = await app.processCommand("/find 营业执照 5");
			expect(licenseFind.ok).toBe(true);
			if (!licenseFind.ok || licenseFind.value.type !== "find") {
				throw new Error("Expected find result");
			}
			expect(licenseFind.value.items).toHaveLength(0);

			const contentFind = await app.processCommand("/find 奖励函数 5");
			expect(contentFind.ok).toBe(true);
			if (!contentFind.ok || contentFind.value.type !== "find") {
				throw new Error("Expected find result");
			}
			expect(contentFind.value.items[0]?.id).toBe("item_xhs_find");

			const storedRaw = readFileSync(extractedPath, "utf8");
			expect(storedRaw).toContain("沪ICP备13030189号");
		} finally {
			app.close();
		}
	});

	it("deletes item with cascading data and artifacts", async () => {
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

		const saved = await app.saveFromInput({
			url: "https://example.com/delete-cascade",
		});
		app.createAnnotation({
			itemId: saved.itemId,
			type: "note",
			text: "delete me",
			tags: ["tmp"],
		});
		const opened = app.openItemDialogue(saved.itemId);
		await app.askInItemDialogue(saved.itemId, opened.sessionId, "question");

		const deleted = app.deleteItem(saved.itemId);
		expect(deleted.deleted).toBe(true);
		expect(app.itemsRepo.findById(saved.itemId)).toBeNull();
		expect(app.artifactsRepo.listByItemId(saved.itemId)).toHaveLength(0);
		expect(app.annotationsRepo.listByItemId(saved.itemId)).toHaveLength(0);
		expect(app.dialogueRepo.listSessionsByItemId(saved.itemId)).toHaveLength(0);
		expect(existsSync(join(root, "data", "items", saved.itemId))).toBe(false);

		const deletedAgain = app.deleteItem(saved.itemId);
		expect(deletedAgain.deleted).toBe(false);
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
			expect(saveResult.sourcePlatform).toBe("twitter");
			expect(saveResult.sourceStatus).toBe("fetch_failed");
			expect(saveResult.sourceStatusReason).toContain("fetch failed");
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

	it("auto-uses cleaned xiaohongshu evidence when source is blocked", async () => {
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
			snapshotFetchImpl: async () =>
				new Response(
					"<html><body>小红书 创作中心 业务合作 沪ICP备13030189号 沪B2-20150021 (沪)网械平台备字[2019]第00006号 (沪)-经营性-2023-0144 沪网文(2024)1344-086号 网信算备310101216601302230019号 上海市互联网举报中心 网上有害信息举报专区 © 2014-2024 行吟信息科技（上海）有限公司 地址：上海市黄浦区马当路388号C座 电话：9501-3888 重复信息 重复信息 重复信息。<p>真正内容：强化学习环境设计要先简后繁，奖励函数需要阶段化并避免被 hack，动作空间应先离散后连续。</p></body></html>",
					{
						status: 200,
						headers: { "content-type": "text/html; charset=utf-8" },
					},
				),
		});

		try {
			const saveResult = await app.saveFromInput({
				url: "https://www.xiaohongshu.com/discovery/item/test-auto-evidence",
			});
			expect(saveResult.sourcePlatform).toBe("xiaohongshu");
			expect(saveResult.sourceStatus).toBe("blocked");
			expect(saveResult.evidenceType).toBe("pasted_text");
			expect(saveResult.needsUserEvidence).toBe(false);

			const artifacts = app.artifactsRepo.listByItemId(saveResult.itemId);
			const evidence = artifacts.find((artifact) => artifact.kind === "evidence-md");
			if (!evidence) {
				throw new Error("Expected evidence artifact");
			}
			const evidenceText = readFileSync(evidence.path, "utf8");
			expect(evidenceText).toContain("真正内容");
			expect(evidenceText).not.toContain("沪ICP备");
		} finally {
			app.close();
		}
	});

	it("marks blocked source as unusable and requests pasted evidence", async () => {
		const server = await withServer((_request, response) => {
			response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			response.end("<html><body><h1>环境异常</h1><p>完成验证后即可继续访问</p><p>去验证</p></body></html>");
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
			const saveResult = await app.saveFromInput({
				url: `${server.baseUrl}/wechat-like`,
			});
			expect(saveResult.sourceStatus).toBe("login_required");
			expect(saveResult.needsUserEvidence).toBe(true);
			expect(saveResult.evidenceType).toBe("fallback_text");
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
