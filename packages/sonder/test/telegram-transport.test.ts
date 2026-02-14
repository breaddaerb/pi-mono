import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SonderApp } from "../src/app/index.js";
import { type TelegramApi, TelegramBotRunner } from "../src/transport/index.js";

class FakeTelegramApi implements TelegramApi {
	constructor(
		private readonly updates: Array<
			| { updateId: number; type: "message"; chatId: number; text: string }
			| { updateId: number; type: "callback"; chatId: number; callbackQueryId: string; data: string }
		>,
	) {}

	public sent: Array<{
		chatId: number;
		text: string;
		inlineKeyboard?: Array<Array<{ text: string; callbackData: string }>>;
	}> = [];
	public answeredCallbackIds: string[] = [];

	enqueueUpdates(
		updates: Array<
			| { updateId: number; type: "message"; chatId: number; text: string }
			| { updateId: number; type: "callback"; chatId: number; callbackQueryId: string; data: string }
		>,
	): void {
		this.updates.push(...updates);
	}

	async getMe(): Promise<{ id: number; username?: string; firstName?: string }> {
		return { id: 1, username: "fake", firstName: "fake" };
	}

	async getUpdates(_offset: number, _timeoutSeconds: number) {
		const batch = [...this.updates];
		this.updates.length = 0;
		return batch;
	}

	async sendMessage(
		chatId: number,
		text: string,
		options?: { inlineKeyboard?: Array<Array<{ text: string; callbackData: string }>> },
	): Promise<void> {
		this.sent.push({ chatId, text, inlineKeyboard: options?.inlineKeyboard });
	}

	async answerCallbackQuery(callbackQueryId: string): Promise<void> {
		this.answeredCallbackIds.push(callbackQueryId);
	}
}

describe("TelegramBotRunner", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const directory of tempDirs) {
			rmSync(directory, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("formats /find results with button actions and no id exposure", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-telegram-"));
		tempDirs.push(root);

		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async () => ({
				answer: "stub",
				model: "stub",
				provider: "stub",
				citations: [],
			}),
		});
		app.itemsRepo.create({
			id: "item_find",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com/agent-language",
			whyNote: null,
			tags: ["agents"],
			topic: null,
			space: null,
		});
		app.artifactsRepo.create({
			id: "art_find",
			itemId: "item_find",
			kind: "extracted-text",
			path: join(root, "missing.txt"),
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});
		app.createAnnotation({
			itemId: "item_find",
			type: "note",
			text: "language design",
			comment: null,
			tags: [],
		});

		const api = new FakeTelegramApi([{ updateId: 1, type: "message", chatId: 40, text: "/find language" }]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent).toHaveLength(1);
		expect(api.sent[0].text).toContain("🔎 Found 1 results for: language");
		expect(api.sent[0].text).not.toContain("item_find");
		expect(api.sent[0].inlineKeyboard?.[0]?.[0]?.text).toBe("1 Open");
		expect(api.sent[0].inlineKeyboard?.[0]?.[1]?.text).toBe("1 Ask");
		expect(api.sent[0].inlineKeyboard?.[0]?.[0]?.callbackData).toMatch(/^sx:v1:find_open:/);
		expect(api.sent[0].inlineKeyboard?.[0]?.[1]?.callbackData).toMatch(/^sx:v1:find_ask:/);
		app.close();
	});

	it("handles find callback open action and routes follow-up text in item mode", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-telegram-"));
		tempDirs.push(root);

		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async (input) => ({
				answer: `Item answer: ${input.question}`,
				model: "stub",
				provider: "stub",
				citations: [],
			}),
		});
		app.itemsRepo.create({
			id: "item_find_open",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com/agent-language",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		app.artifactsRepo.create({
			id: "art_find_open",
			itemId: "item_find_open",
			kind: "extracted-text",
			path: join(root, "missing.txt"),
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});

		const api = new FakeTelegramApi([{ updateId: 1, type: "message", chatId: 77, text: "/find language" }]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();
		const callbackData = api.sent[0].inlineKeyboard?.[0]?.[0]?.callbackData;
		if (!callbackData) {
			throw new Error("Expected callback data");
		}

		api.enqueueUpdates([
			{ updateId: 2, type: "callback", chatId: 77, callbackQueryId: "cb_1", data: callbackData },
			{ updateId: 3, type: "message", chatId: 77, text: "what is key" },
		]);
		await runner.pollOnce();

		expect(api.answeredCallbackIds).toContain("cb_1");
		expect(api.sent[1].text).toContain("Item mode opened from search result #1");
		expect(api.sent[2].text).toContain("Item answer: what is key");
		app.close();
	});

	it("returns expired menu guidance for stale find callback", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-telegram-"));
		tempDirs.push(root);

		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async () => ({
				answer: "stub",
				model: "stub",
				provider: "stub",
				citations: [],
			}),
		});

		const api = new FakeTelegramApi([
			{
				updateId: 1,
				type: "callback",
				chatId: 55,
				callbackQueryId: "cb_expired",
				data: "sx:v1:find_open:missing:1",
			},
		]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent[0].text).toContain("This menu expired");
		expect(api.answeredCallbackIds).toContain("cb_expired");
		app.close();
	});

	it("formats /list results with button actions", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-telegram-"));
		tempDirs.push(root);

		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async () => ({
				answer: "stub",
				model: "stub",
				provider: "stub",
				citations: [],
			}),
		});
		app.itemsRepo.create({
			id: "item_list",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com/list-entry",
			whyNote: null,
			tags: ["list"],
			topic: null,
			space: null,
		});

		const api = new FakeTelegramApi([{ updateId: 1, type: "message", chatId: 42, text: "/list 1" }]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent).toHaveLength(1);
		expect(api.sent[0].text).toContain("🗂 Recent items");
		expect(api.sent[0].text).not.toContain("item_list");
		expect(api.sent[0].inlineKeyboard?.[0]?.[0]?.callbackData).toMatch(/^sx:v1:list_open:/);
		expect(api.sent[0].inlineKeyboard?.[0]?.[1]?.callbackData).toMatch(/^sx:v1:list_ask:/);
		app.close();
	});

	it("auto-enters item mode after save", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-telegram-"));
		tempDirs.push(root);

		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async (input) => ({
				answer: `Item answer: ${input.question}`,
				model: "stub",
				provider: "stub",
				citations: [],
			}),
		});

		app.itemsRepo.create({
			id: "item_saved",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com/saved",
			whyNote: null,
			tags: ["saved"],
			topic: null,
			space: null,
		});
		app.artifactsRepo.create({
			id: "art_saved",
			itemId: "item_saved",
			kind: "extracted-text",
			path: join(root, "missing-save.txt"),
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});

		const originalProcessCommand = app.processCommand.bind(app);
		app.processCommand = async (text) => {
			if (text.startsWith("/save")) {
				return {
					ok: true,
					value: {
						type: "save",
						itemId: "item_saved",
						usedFallback: false,
						artifactIds: ["art_saved"],
						url: "https://example.com/saved",
						tags: ["saved"],
					},
				};
			}
			return originalProcessCommand(text);
		};

		const api = new FakeTelegramApi([
			{ updateId: 1, type: "message", chatId: 52, text: "/save https://example.com/saved" },
			{ updateId: 2, type: "message", chatId: 52, text: "continue" },
		]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent[0].text).toContain("Saved item");
		expect(api.sent[1].text).toContain("Item mode opened for saved item");
		expect(api.sent[2].text).toContain("Item answer: continue");
		app.close();
	});

	it("processes command updates and sends formatted response", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-telegram-"));
		tempDirs.push(root);

		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async () => ({
				answer: "stub",
				model: "stub",
				provider: "stub",
				citations: [],
			}),
		});

		const api = new FakeTelegramApi([{ updateId: 1, type: "message", chatId: 42, text: "/list" }]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent).toHaveLength(1);
		expect(api.sent[0].chatId).toBe(42);
		expect(api.sent[0].text).toContain("No saved items yet");
		app.close();
	});

	it("supports general dialogue mode via /open without item id", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-telegram-"));
		tempDirs.push(root);

		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async (input) => ({
				answer: `General: ${input.question}`,
				model: "stub",
				provider: "stub",
				citations: [],
			}),
		});

		const api = new FakeTelegramApi([
			{ updateId: 1, type: "message", chatId: 8, text: "/open" },
			{ updateId: 2, type: "message", chatId: 8, text: "hello there" },
		]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent).toHaveLength(2);
		expect(api.sent[0].text).toContain("Opened general dialogue mode");
		expect(api.sent[1].text).toContain("General: hello there");
		app.close();
	});

	it("restores item dialogue mode from storage across runner restart", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-telegram-"));
		tempDirs.push(root);

		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async (input) => ({
				answer: `Item answer: ${input.question}`,
				model: "stub",
				provider: "stub",
				citations: [],
			}),
		});

		app.itemsRepo.create({
			id: "item_open",
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
			itemId: "item_open",
			kind: "extracted-text",
			path: join(root, "missing.txt"),
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});

		const firstApi = new FakeTelegramApi([{ updateId: 1, type: "message", chatId: 9, text: "/open item_open" }]);
		const firstRunner = new TelegramBotRunner(firstApi, app);
		await firstRunner.pollOnce();
		expect(firstApi.sent[0].text).toContain("Opened item dialogue");

		const secondApi = new FakeTelegramApi([{ updateId: 2, type: "message", chatId: 9, text: "continue" }]);
		const secondRunner = new TelegramBotRunner(secondApi, app);
		await secondRunner.pollOnce();
		expect(secondApi.sent[0].text).toContain("Item answer: continue");
		app.close();
	});

	it("shows history for active and explicit sessions", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-telegram-"));
		tempDirs.push(root);

		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async (input) => ({
				answer: `Item answer: ${input.question}`,
				model: "stub",
				provider: "stub",
				citations: [],
			}),
		});

		app.itemsRepo.create({
			id: "item_hist",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		app.artifactsRepo.create({
			id: "art_hist",
			itemId: "item_hist",
			kind: "extracted-text",
			path: join(root, "missing.txt"),
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});

		const openApi = new FakeTelegramApi([
			{ updateId: 1, type: "message", chatId: 15, text: "/open item_hist" },
			{ updateId: 2, type: "message", chatId: 15, text: "first question" },
			{ updateId: 3, type: "message", chatId: 15, text: "/history" },
		]);
		const runner = new TelegramBotRunner(openApi, app);
		await runner.pollOnce();

		expect(openApi.sent.some((entry) => entry.text.includes("History for"))).toBe(true);

		const sessionId = app.listItemDialogues("item_hist")[0]?.sessionId;
		if (!sessionId) {
			throw new Error("Expected session id");
		}

		const explicitApi = new FakeTelegramApi([
			{ updateId: 4, type: "message", chatId: 99, text: `/history ${sessionId}` },
		]);
		const runner2 = new TelegramBotRunner(explicitApi, app);
		await runner2.pollOnce();
		expect(explicitApi.sent[0].text).toContain("History for");
		app.close();
	});

	it("supports item dialogue mode via /open <itemId>", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-telegram-"));
		tempDirs.push(root);

		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async (input) => ({
				answer: `Item answer: ${input.question}`,
				model: "stub",
				provider: "stub",
				citations: [],
			}),
		});

		app.itemsRepo.create({
			id: "item_open",
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
			itemId: "item_open",
			kind: "extracted-text",
			path: join(root, "missing.txt"),
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});

		const api = new FakeTelegramApi([
			{ updateId: 1, type: "message", chatId: 9, text: "/open item_open" },
			{ updateId: 2, type: "message", chatId: 9, text: "what is key" },
			{ updateId: 3, type: "message", chatId: 9, text: "/where" },
			{ updateId: 4, type: "message", chatId: 9, text: "/exit" },
		]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent).toHaveLength(4);
		expect(api.sent[0].text).toContain("Opened item dialogue");
		expect(api.sent[1].text).toContain("Item answer: what is key");
		expect(api.sent[2].text).toContain("Active item dialogue");
		expect(api.sent[3].text).toContain("Exited active dialogue mode");
		app.close();
	});

	it("splits long ask responses into multiple telegram messages", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-telegram-"));
		tempDirs.push(root);

		const longAnswer = "A".repeat(5000);
		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async () => ({
				answer: longAnswer,
				model: "stub",
				provider: "stub",
				citations: [],
			}),
		});

		app.itemsRepo.create({
			id: "item_long",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});

		const api = new FakeTelegramApi([{ updateId: 1, type: "message", chatId: 9, text: "/ask item_long what?" }]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent.length).toBeGreaterThan(1);
		app.close();
	});

	it("replies with guidance for non-command text without active mode", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-telegram-"));
		tempDirs.push(root);

		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async () => ({
				answer: "stub",
				model: "stub",
				provider: "stub",
				citations: [],
			}),
		});

		const api = new FakeTelegramApi([{ updateId: 1, type: "message", chatId: 7, text: "hello" }]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent).toHaveLength(1);
		expect(api.sent[0].text).toContain("No active dialogue");
		app.close();
	});
});
