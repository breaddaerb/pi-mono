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

	it("formats /find results with open button and no id exposure", async () => {
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
		expect(api.sent[0].inlineKeyboard?.[0]?.[1]).toBeUndefined();
		expect(api.sent[0].inlineKeyboard?.[0]?.[0]?.callbackData).toMatch(/^sx:v1:find_open:/);
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
		expect(api.sent[1].text).toContain("Item mode opened from result #1");
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
		expect(api.sent[0].inlineKeyboard?.[0]?.[1]).toBeUndefined();
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
		expect(firstApi.sent[0].text).toContain("Item mode opened");

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
		expect(api.sent[0].text).toContain("Item mode opened");
		expect(api.sent[1].text).toContain("Item answer: what is key");
		expect(api.sent[2].text).toContain("Active item dialogue");
		expect(api.sent[3].text).toContain("Exited active dialogue mode");
		app.close();
	});

	it("shows sessions buttons and supports resume/new session callbacks", async () => {
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
			id: "item_sessions",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com/sessions",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		app.artifactsRepo.create({
			id: "art_sessions",
			itemId: "item_sessions",
			kind: "extracted-text",
			path: join(root, "missing-sessions.txt"),
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});

		const preOpened = app.openItemDialogue("item_sessions");
		await app.askInItemDialogue("item_sessions", preOpened.sessionId, "first turn");

		const api = new FakeTelegramApi([
			{ updateId: 1, type: "message", chatId: 26, text: "/open item_sessions" },
			{ updateId: 2, type: "message", chatId: 26, text: "/sessions" },
		]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent[1].text).toContain("Sessions");
		const resumeData = api.sent[1].inlineKeyboard?.[0]?.[0]?.callbackData;
		const newSessionData = api.sent[1].inlineKeyboard?.[api.sent[1].inlineKeyboard.length - 1]?.[0]?.callbackData;
		if (!resumeData || !newSessionData) {
			throw new Error("Expected session callback data");
		}

		api.enqueueUpdates([
			{ updateId: 3, type: "callback", chatId: 26, callbackQueryId: "cb_resume", data: resumeData },
			{ updateId: 4, type: "callback", chatId: 26, callbackQueryId: "cb_new", data: newSessionData },
		]);
		await runner.pollOnce();

		expect(api.sent[2].text).toContain("Item dialogue resumed");
		expect(api.sent[3].text).toContain("New item session started");
		app.close();
	});

	it("shows history with pagination buttons in item mode", async () => {
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
			id: "item_hist_btn",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com/hist",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		app.artifactsRepo.create({
			id: "art_hist_btn",
			itemId: "item_hist_btn",
			kind: "extracted-text",
			path: join(root, "missing-hist-btn.txt"),
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});
		const opened = app.openItemDialogue("item_hist_btn");
		for (let index = 0; index < 10; index++) {
			await app.askInItemDialogue("item_hist_btn", opened.sessionId, `q${index}`);
		}

		const api = new FakeTelegramApi([
			{ updateId: 1, type: "message", chatId: 27, text: "/open item_hist_btn" },
			{ updateId: 2, type: "message", chatId: 27, text: "/history" },
		]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent[1].text).toContain("page 1/");
		const nextData = api.sent[1].inlineKeyboard?.[0]?.[1]?.callbackData;
		if (!nextData) {
			throw new Error("Expected next history callback data");
		}

		api.enqueueUpdates([{ updateId: 3, type: "callback", chatId: 27, callbackQueryId: "cb_next", data: nextData }]);
		await runner.pollOnce();

		expect(api.sent[2].text).toContain("History for");
		expect(api.answeredCallbackIds).toContain("cb_next");
		app.close();
	});

	it("supports item mode panel callbacks and contextual banner", async () => {
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
			id: "item_panel",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		app.artifactsRepo.create({
			id: "art_panel",
			itemId: "item_panel",
			kind: "extracted-text",
			path: join(root, "missing-panel.txt"),
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});

		const api = new FakeTelegramApi([
			{ updateId: 1, type: "message", chatId: 25, text: "/open item_panel" },
			{ updateId: 2, type: "message", chatId: 25, text: "hello panel" },
			{ updateId: 3, type: "callback", chatId: 25, callbackQueryId: "cb_ctx_exit", data: "sx:v1:ctx_exit:ctx:0" },
		]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent[0].inlineKeyboard?.[0]?.[0]?.text).toBe("Exit");
		expect(api.sent[0].inlineKeyboard?.[0]?.[1]).toBeUndefined();
		expect(api.sent[0].text).toContain("Session: active");
		expect(api.sent[0].text).toContain("Recent activity:");
		expect(api.sent[1].text).toContain("🧠 In: item_panel");
		expect(api.sent[1].text).toContain("Item answer: hello panel");
		expect(api.sent[2].text).toContain("Exited active dialogue mode");
		expect(api.answeredCallbackIds).toEqual(expect.arrayContaining(["cb_ctx_exit"]));
		app.close();
	});

	it("returns /ask deprecation guidance in telegram mode", async () => {
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

		const api = new FakeTelegramApi([{ updateId: 1, type: "message", chatId: 9, text: "/ask item_long what?" }]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent).toHaveLength(1);
		expect(api.sent[0].text).toContain("/ask is deprecated");
		app.close();
	});

	it("splits long active-item responses into multiple telegram messages", async () => {
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
		app.artifactsRepo.create({
			id: "art_long",
			itemId: "item_long",
			kind: "extracted-text",
			path: join(root, "missing-long.txt"),
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});

		const api = new FakeTelegramApi([
			{ updateId: 1, type: "message", chatId: 9, text: "/open item_long" },
			{ updateId: 2, type: "message", chatId: 9, text: "what?" },
		]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent.length).toBeGreaterThan(2);
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
