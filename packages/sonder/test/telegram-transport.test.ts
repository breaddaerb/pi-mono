import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SonderApp } from "../src/app/index.js";
import { type TelegramApi, TelegramBotRunner, type TelegramRuntimeModelSelector } from "../src/transport/index.js";

class FakeModelSelector implements TelegramRuntimeModelSelector {
	constructor(
		private readonly modelIds: string[],
		private selectedModelId: string,
	) {}

	listModels(): Array<{ id: string }> {
		return this.modelIds.map((id) => ({ id }));
	}

	getSelectedModelId(): string {
		return this.selectedModelId;
	}

	setSelectedModelId(modelId: string): boolean {
		if (!this.modelIds.includes(modelId)) {
			return false;
		}
		this.selectedModelId = modelId;
		return true;
	}
}

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
		expect(api.sent[0].text).toContain("🔎 Find: language");
		expect(api.sent[0].text).toContain("Filters: Time=All");
		expect(api.sent[0].text).toContain("reasons:");
		expect(api.sent[0].text).toContain("match:");
		expect(api.sent[0].text).not.toContain("item_find");
		expect(api.sent[0].inlineKeyboard?.[0]?.[0]?.text).toBe("1 Open");
		expect(api.sent[0].inlineKeyboard?.[1]?.[0]?.text).toContain("Time:");
		expect(api.sent[0].inlineKeyboard?.[1]?.[1]?.text).toContain("Source:");
		expect(api.sent[0].inlineKeyboard?.[3]?.[1]?.text).toBe("Prev");
		expect(api.sent[0].inlineKeyboard?.[0]?.[0]?.callbackData).toMatch(/^sx:v1:find_open:/);
		app.close();
	});

	it("supports discovery filter callbacks and find-empty fallback to list", async () => {
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
			id: "item_filter",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com/language-filter",
			whyNote: null,
			tags: ["agents"],
			topic: null,
			space: null,
		});

		const api = new FakeTelegramApi([
			{ updateId: 1, type: "message", chatId: 41, text: "/find" },
			{ updateId: 2, type: "message", chatId: 41, text: "/find language" },
		]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent[0].text).toContain("🗂 Recent items");
		const timeFilterData = api.sent[1].inlineKeyboard?.[1]?.[0]?.callbackData;
		if (!timeFilterData) {
			throw new Error("Expected time filter callback data");
		}

		api.enqueueUpdates([
			{ updateId: 3, type: "callback", chatId: 41, callbackQueryId: "cb_filter_open", data: timeFilterData },
		]);
		await runner.pollOnce();

		expect(api.sent[2].text).toContain("Select time filter");
		const time7dData = api.sent[2].inlineKeyboard?.[0]?.[1]?.callbackData;
		if (!time7dData) {
			throw new Error("Expected 7d callback data");
		}

		api.enqueueUpdates([
			{ updateId: 4, type: "callback", chatId: 41, callbackQueryId: "cb_filter_set", data: time7dData },
		]);
		await runner.pollOnce();

		expect(api.sent[3].text).toContain("Filters: Time=Last 7d");

		const tagFilterData = api.sent[3].inlineKeyboard?.[2]?.[0]?.callbackData;
		if (!tagFilterData) {
			throw new Error("Expected tag filter callback data");
		}
		api.enqueueUpdates([
			{ updateId: 5, type: "callback", chatId: 41, callbackQueryId: "cb_tag_open", data: tagFilterData },
		]);
		await runner.pollOnce();
		expect(api.sent[4].text).toContain("Select tag filter");

		expect(api.answeredCallbackIds).toEqual(
			expect.arrayContaining(["cb_filter_open", "cb_filter_set", "cb_tag_open"]),
		);
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

	it("supports delete callback from discovery menu without exposing item id", async () => {
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
			id: "item_find_del",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com/delete-me",
			whyNote: null,
			tags: ["tmp"],
			topic: null,
			space: null,
		});

		const api = new FakeTelegramApi([{ updateId: 1, type: "message", chatId: 78, text: "/list" }]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		const deleteCallbackData = api.sent[0].inlineKeyboard?.[0]?.[1]?.callbackData;
		if (!deleteCallbackData) {
			throw new Error("Expected delete callback data");
		}

		api.enqueueUpdates([
			{ updateId: 2, type: "callback", chatId: 78, callbackQueryId: "cb_del", data: deleteCallbackData },
		]);
		await runner.pollOnce();

		expect(api.answeredCallbackIds).toContain("cb_del");
		expect(api.sent[1].text).toContain("Item deleted");
		expect(api.sent[2].text).toContain("No results match current filters");
		expect(app.itemsRepo.findById("item_find_del")).toBeNull();
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
		expect(api.sent[0].inlineKeyboard?.[0]?.[1]?.text).toBe("1 Delete");
		expect(api.sent[0].inlineKeyboard?.[0]?.[1]?.callbackData).toMatch(/^sx:v1:list_del:/);
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
						sourcePlatform: "web",
						sourceAcquisitionMethod: "direct_fetch",
						sourceStatus: "ok",
						sourceStatusReason: null,
						evidenceType: "snapshot",
						needsUserEvidence: false,
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

	it("bounds persisted general history size in chat mode state", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-telegram-"));
		tempDirs.push(root);

		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async (input) => ({
				answer: `General: ${input.question} :: ${"x".repeat(800)}`,
				model: "stub",
				provider: "stub",
				citations: [],
			}),
		});

		const chatId = 81;
		const updates: Array<{ updateId: number; type: "message"; chatId: number; text: string }> = [
			{ updateId: 1, type: "message", chatId, text: "/open" },
		];
		for (let index = 0; index < 20; index++) {
			updates.push({ updateId: index + 2, type: "message", chatId, text: `msg-${index}` });
		}

		const api = new FakeTelegramApi(updates);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		const state = app.loadChatModeState(chatId);
		expect(state).not.toBeNull();
		if (!state || state.mode !== "general") {
			throw new Error("Expected persisted general mode state");
		}
		expect(state.history.length).toBeLessThanOrEqual(24);
		const totalChars = state.history.reduce((sum, turn) => sum + turn.content.length, 0);
		expect(totalChars).toBeLessThanOrEqual(12_000);
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

	it("auto-heals invalid persisted item mode state on restore", async () => {
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
			id: "item_invalid_mode",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		app.saveChatModeState(
			{
				chatId: 66,
				mode: "item",
				itemId: "item_invalid_mode",
				sessionId: "missing-session",
				history: [],
			},
			new Date().toISOString(),
		);

		const api = new FakeTelegramApi([{ updateId: 1, type: "message", chatId: 66, text: "hello" }]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent[0].text).toContain("No active dialogue");
		expect(app.loadChatModeState(66)).toBeNull();
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

	it("renders failed assistant turns in item history", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-telegram-"));
		tempDirs.push(root);

		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async (input) => {
				if (input.question === "fail now") {
					throw new Error("provider timeout");
				}
				return {
					answer: `Item answer: ${input.question}`,
					model: "stub",
					provider: "stub",
					citations: [],
				};
			},
		});

		app.itemsRepo.create({
			id: "item_hist_failed",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com/hist-failed",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		app.artifactsRepo.create({
			id: "art_hist_failed",
			itemId: "item_hist_failed",
			kind: "extracted-text",
			path: join(root, "missing-hist-failed.txt"),
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});

		const api = new FakeTelegramApi([
			{ updateId: 1, type: "message", chatId: 64, text: "/open item_hist_failed" },
			{ updateId: 2, type: "message", chatId: 64, text: "fail now" },
			{ updateId: 3, type: "message", chatId: 64, text: "/history" },
		]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent[1].text).toContain("provider timeout");
		expect(api.sent[2].text).toContain("[failed]");
		expect(api.sent[2].text).toContain("failed: provider timeout");

		const sessionId = app.listItemDialogues("item_hist_failed")[0]?.sessionId;
		if (!sessionId) {
			throw new Error("Expected history session");
		}
		const turns = app.dialogueRepo.listTurnsBySessionId(sessionId);
		expect(turns).toHaveLength(2);
		expect(turns[1].status).toBe("failed");
		expect(turns[1].errorMessage).toContain("provider timeout");
		app.close();
	});

	it("renders failed turns after runner restart from persisted history", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-telegram-"));
		tempDirs.push(root);

		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async (input) => {
				if (input.question === "fail restart") {
					throw new Error("transient provider error");
				}
				return {
					answer: `Item answer: ${input.question}`,
					model: "stub",
					provider: "stub",
					citations: [],
				};
			},
		});

		app.itemsRepo.create({
			id: "item_hist_failed_restart",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com/hist-failed-restart",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		app.artifactsRepo.create({
			id: "art_hist_failed_restart",
			itemId: "item_hist_failed_restart",
			kind: "extracted-text",
			path: join(root, "missing-hist-failed-restart.txt"),
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});

		const firstApi = new FakeTelegramApi([
			{ updateId: 1, type: "message", chatId: 65, text: "/open item_hist_failed_restart" },
			{ updateId: 2, type: "message", chatId: 65, text: "fail restart" },
		]);
		const firstRunner = new TelegramBotRunner(firstApi, app);
		await firstRunner.pollOnce();
		expect(firstApi.sent[1].text).toContain("transient provider error");

		const sessionId = app.listItemDialogues("item_hist_failed_restart")[0]?.sessionId;
		if (!sessionId) {
			throw new Error("Expected persisted failed session");
		}

		const secondApi = new FakeTelegramApi([
			{ updateId: 3, type: "message", chatId: 65, text: `/history ${sessionId}` },
		]);
		const secondRunner = new TelegramBotRunner(secondApi, app);
		await secondRunner.pollOnce();
		expect(secondApi.sent[0].text).toContain("[failed]");
		expect(secondApi.sent[0].text).toContain("failed: transient provider error");
		app.close();
	});

	it("supports /models command and callback-based model switching", async () => {
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

		const modelSelector = new FakeModelSelector(["gpt-5.2", "gpt-5.2-mini"], "gpt-5.2");
		const api = new FakeTelegramApi([{ updateId: 1, type: "message", chatId: 62, text: "/models" }]);
		const runner = new TelegramBotRunner(api, app, { modelSelector });
		await runner.pollOnce();

		expect(api.sent[0].text).toContain("Models (Codex)");
		expect(api.sent[0].text).toContain("Current: gpt-5.2");
		const switchData = api.sent[0].inlineKeyboard?.[1]?.[0]?.callbackData;
		if (!switchData) {
			throw new Error("Expected model switch callback data");
		}

		api.enqueueUpdates([
			{ updateId: 2, type: "callback", chatId: 62, callbackQueryId: "cb_model", data: switchData },
			{ updateId: 3, type: "message", chatId: 62, text: "/where" },
		]);
		await runner.pollOnce();

		expect(api.sent[1].text).toContain("Current: gpt-5.2-mini");
		expect(api.sent[2].text).toContain("Model: gpt-5.2-mini");
		expect(modelSelector.getSelectedModelId()).toBe("gpt-5.2-mini");
		app.close();
	});

	it("shows /models unavailable guidance without codex selector", async () => {
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

		const api = new FakeTelegramApi([{ updateId: 1, type: "message", chatId: 63, text: "/models" }]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent[0].text).toContain("codex responder mode only");
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

	it("shows history with pagination and per-turn full buttons in item mode", async () => {
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
		const fullData = api.sent[1].inlineKeyboard?.[1]?.[0]?.callbackData;
		if (!fullData) {
			throw new Error("Expected full history callback data");
		}
		const nextData = api.sent[1].inlineKeyboard?.[0]?.[1]?.callbackData;
		if (!nextData) {
			throw new Error("Expected next history callback data");
		}

		api.enqueueUpdates([
			{ updateId: 3, type: "callback", chatId: 27, callbackQueryId: "cb_full", data: fullData },
			{ updateId: 4, type: "callback", chatId: 27, callbackQueryId: "cb_next", data: nextData },
		]);
		await runner.pollOnce();

		expect(api.sent[2].text).toContain("History turn 1");
		expect(api.sent[2].text).toContain("Role:");
		expect(api.sent[3].text).toContain("History for");
		expect(api.answeredCallbackIds).toEqual(expect.arrayContaining(["cb_full", "cb_next"]));
		app.close();
	});

	it("clamps history page transitions at boundaries", async () => {
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
			id: "item_hist_clamp",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com/hist-clamp",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		app.artifactsRepo.create({
			id: "art_hist_clamp",
			itemId: "item_hist_clamp",
			kind: "extracted-text",
			path: join(root, "missing-hist-clamp.txt"),
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});
		const opened = app.openItemDialogue("item_hist_clamp");
		for (let index = 0; index < 10; index++) {
			await app.askInItemDialogue("item_hist_clamp", opened.sessionId, `q${index}`);
		}

		const api = new FakeTelegramApi([
			{ updateId: 1, type: "message", chatId: 82, text: "/open item_hist_clamp" },
			{ updateId: 2, type: "message", chatId: 82, text: "/history" },
		]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		let nextData = api.sent[1].inlineKeyboard?.[0]?.[1]?.callbackData;
		let prevData = api.sent[1].inlineKeyboard?.[0]?.[0]?.callbackData;
		if (!nextData || !prevData) {
			throw new Error("Expected history navigation callbacks");
		}

		for (let index = 0; index < 5; index++) {
			api.enqueueUpdates([
				{
					updateId: 3 + index,
					type: "callback",
					chatId: 82,
					callbackQueryId: `cb_clamp_next_${index}`,
					data: nextData,
				},
			]);
			await runner.pollOnce();
			const latest = api.sent[api.sent.length - 1];
			nextData = latest.inlineKeyboard?.[0]?.[1]?.callbackData;
			prevData = latest.inlineKeyboard?.[0]?.[0]?.callbackData;
			if (!nextData || !prevData) {
				throw new Error("Expected next/prev callbacks on paged history message");
			}
		}

		const endPageText = api.sent[api.sent.length - 1]?.text ?? "";
		expect(endPageText).toContain("page 3/3");

		api.enqueueUpdates([
			{ updateId: 100, type: "callback", chatId: 82, callbackQueryId: "cb_clamp_prev", data: prevData },
		]);
		await runner.pollOnce();
		const afterPrevText = api.sent[api.sent.length - 1]?.text ?? "";
		expect(afterPrevText).toContain("page 2/3");
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

		expect(api.sent[0].inlineKeyboard?.[0]?.[0]?.text).toBe("Delete Item");
		expect(api.sent[0].inlineKeyboard?.[0]?.[1]?.text).toBe("Exit");
		expect(api.sent[0].text).toContain("Session: active");
		expect(api.sent[0].text).toContain("Recent activity:");
		expect(api.sent[0].text).toContain("(UTC+8)");
		expect(api.sent[1].text).toContain("🧠 In: item_panel");
		expect(api.sent[1].text).toContain("Item answer: hello panel");
		expect(api.sent[2].text).toContain("Exited active dialogue mode");
		expect(api.answeredCallbackIds).toEqual(expect.arrayContaining(["cb_ctx_exit"]));
		app.close();
	});

	it("supports delete action from item mode panel", async () => {
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
			id: "item_panel_delete",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com/panel-delete",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		app.artifactsRepo.create({
			id: "art_panel_delete",
			itemId: "item_panel_delete",
			kind: "extracted-text",
			path: join(root, "missing-panel-delete.txt"),
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});

		const api = new FakeTelegramApi([
			{ updateId: 1, type: "message", chatId: 35, text: "/open item_panel_delete" },
			{ updateId: 2, type: "callback", chatId: 35, callbackQueryId: "cb_ctx_del", data: "sx:v1:ctx_del:ctx:0" },
			{ updateId: 3, type: "message", chatId: 35, text: "hello" },
		]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent[1].text).toContain("Item deleted");
		expect(api.sent[2].text).toContain("No active dialogue");
		expect(app.itemsRepo.findById("item_panel_delete")).toBeNull();
		expect(api.answeredCallbackIds).toContain("cb_ctx_del");
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

	it("supports /save with pasted evidence text when source fetch fails", async () => {
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
			snapshotFetchImpl: async () => {
				throw new Error("fetch failed");
			},
		});

		const api = new FakeTelegramApi([
			{
				updateId: 1,
				type: "message",
				chatId: 72,
				text: "/save https://x.com/foo/status/5 #x this is pasted evidence",
			},
			{ updateId: 2, type: "message", chatId: 72, text: "follow up" },
		]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent[0].text).toContain("pasted-text evidence mode");
		expect(api.sent[1].text).toContain("Item mode opened with pasted-text evidence");
		expect(api.sent[2].text).toContain("Item answer: follow up");
		app.close();
	});

	it("saves url+text message as pasted evidence when fetch fails", async () => {
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
			snapshotFetchImpl: async () => {
				throw new Error("fetch failed");
			},
		});

		const api = new FakeTelegramApi([
			{
				updateId: 1,
				type: "message",
				chatId: 70,
				text: "https://x.com/foo/status/1 this is pasted fallback evidence",
			},
			{ updateId: 2, type: "message", chatId: 70, text: "follow up" },
		]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent[0].text).toContain("pasted-text evidence mode");
		expect(api.sent[1].text).toContain("Item mode opened with pasted-text evidence");
		expect(api.sent[2].text).toContain("Item answer: follow up");
		app.close();
	});

	it("keeps chat inactive when source fallback needs pasted evidence", async () => {
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
			snapshotFetchImpl: async () => {
				throw new Error("fetch failed");
			},
		});

		const api = new FakeTelegramApi([
			{ updateId: 1, type: "message", chatId: 71, text: "https://x.com/foo/status/2" },
			{ updateId: 2, type: "message", chatId: 71, text: "hello" },
		]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent[0].text).toContain("Link usability: not usable for reliable evidence");
		expect(api.sent[0].text).toContain("Source:");
		expect(api.sent[1].text).toContain("No active dialogue");
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
