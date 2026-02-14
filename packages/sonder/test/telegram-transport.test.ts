import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SonderApp } from "../src/app/index.js";
import { type TelegramApi, TelegramBotRunner } from "../src/transport/index.js";

class FakeTelegramApi implements TelegramApi {
	constructor(private readonly updates: Array<{ updateId: number; chatId: number; text: string }>) {}

	public sent: Array<{ chatId: number; text: string }> = [];

	async getMe(): Promise<{ id: number; username?: string; firstName?: string }> {
		return { id: 1, username: "fake", firstName: "fake" };
	}

	async getUpdates(
		_offset: number,
		_timeoutSeconds: number,
	): Promise<Array<{ updateId: number; chatId: number; text: string }>> {
		const batch = [...this.updates];
		this.updates.length = 0;
		return batch;
	}

	async sendMessage(chatId: number, text: string): Promise<void> {
		this.sent.push({ chatId, text });
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

		const api = new FakeTelegramApi([{ updateId: 1, chatId: 42, text: "/list" }]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent).toHaveLength(1);
		expect(api.sent[0].chatId).toBe(42);
		expect(api.sent[0].text).toContain("No saved items yet");
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

		const api = new FakeTelegramApi([{ updateId: 1, chatId: 9, text: "/ask item_long what?" }]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent.length).toBeGreaterThan(1);
		app.close();
	});

	it("replies with guidance for non-command text", async () => {
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

		const api = new FakeTelegramApi([{ updateId: 1, chatId: 7, text: "hello" }]);
		const runner = new TelegramBotRunner(api, app);
		await runner.pollOnce();

		expect(api.sent).toHaveLength(1);
		expect(api.sent[0].text).toContain("Send one of: /save <url>, /list, /ask");
		app.close();
	});
});
