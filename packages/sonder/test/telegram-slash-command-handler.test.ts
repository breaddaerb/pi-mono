import { describe, expect, it } from "vitest";
import type { SonderCommandResult, SonderProcessResult } from "../src/app/index.js";
import {
	handleSlashMessage,
	type SlashMessageHandlerContext,
} from "../src/transport/telegram-slash-command-handler.js";

type SentMessage = {
	chatId: number;
	text: string;
	options?: { inlineKeyboard?: Array<Array<{ text: string; callbackData: string }>> };
};

function createSaveResult(): Extract<SonderCommandResult, { type: "save" }> {
	return {
		type: "save",
		itemId: "item-1",
		usedFallback: false,
		artifactIds: [],
		url: "https://example.com",
		tags: [],
		sourcePlatform: "web",
		sourceAcquisitionMethod: "direct_fetch",
		sourceStatus: "ok",
		sourceStatusReason: null,
		evidenceType: "snapshot",
		needsUserEvidence: false,
	};
}

function createContext(input: { normalizedInput: string; processResult?: SonderProcessResult; menuState?: unknown }): {
	context: SlashMessageHandlerContext;
	sent: SentMessage[];
	marked: number;
	cleared: number;
	processInputs: string[];
	saveForwarded: Array<{ chatId: number; saveResult: Extract<SonderCommandResult, { type: "save" }> }>;
	createdMenus: Array<{ chatId: number; kind: "find" | "list"; query: string | null; entriesLength: number }>;
} {
	const sent: SentMessage[] = [];
	const processInputs: string[] = [];
	const saveForwarded: Array<{ chatId: number; saveResult: Extract<SonderCommandResult, { type: "save" }> }> = [];
	const createdMenus: Array<{ chatId: number; kind: "find" | "list"; query: string | null; entriesLength: number }> =
		[];
	let marked = 0;
	let cleared = 0;

	const context: SlashMessageHandlerContext = {
		chatId: 10,
		normalizedInput: input.normalizedInput,
		markSaveInputPending: () => {
			marked += 1;
		},
		clearPendingSaveInput: () => {
			cleared += 1;
		},
		processCommand: async (commandInput) => {
			processInputs.push(commandInput);
			return input.processResult ?? { ok: true, value: { type: "list", items: [] } };
		},
		sendSaveResultAndMaybeOpenItemMode: async (chatId, saveResult) => {
			saveForwarded.push({ chatId, saveResult });
		},
		createItemMenu: (chatId, kind, entries, query) => {
			createdMenus.push({ chatId, kind, query, entriesLength: entries.length });
			return "menu-1";
		},
		getItemMenu: () => (input.menuState === undefined ? { id: "menu" } : input.menuState),
		buildDiscoveryMenuText: () => "discovery text",
		buildDiscoveryMenuKeyboard: () => [[{ text: "Open", callbackData: "cb" }]],
		splitForTelegram: (text) => [text],
		sendMessage: async (chatId, text, options) => {
			sent.push({ chatId, text, options });
		},
	};

	return {
		context,
		sent,
		get marked() {
			return marked;
		},
		get cleared() {
			return cleared;
		},
		processInputs,
		saveForwarded,
		createdMenus,
	};
}

describe("telegram slash command handler", () => {
	it("handles /ask deprecation guidance", async () => {
		const state = createContext({ normalizedInput: "/ask what is this" });
		await handleSlashMessage(state.context);

		expect(state.cleared).toBe(1);
		expect(state.marked).toBe(0);
		expect(state.sent).toHaveLength(1);
		expect(state.sent[0]?.text).toContain("/ask is deprecated");
	});

	it("marks pending state for bare /save", async () => {
		const state = createContext({ normalizedInput: "/save" });
		await handleSlashMessage(state.context);

		expect(state.marked).toBe(1);
		expect(state.cleared).toBe(0);
		expect(state.sent).toHaveLength(1);
		expect(state.sent[0]?.text).toContain("Send save input in your next message");
	});

	it("maps /find to /list command and opens discovery menu for list results", async () => {
		const state = createContext({
			normalizedInput: "/find",
			processResult: {
				ok: true,
				value: {
					type: "list",
					items: [
						{
							id: "item-1",
							createdAt: "2026-02-18T00:00:00.000Z",
							sourceType: "web",
							originalUrl: "https://example.com/a",
							tags: ["x"],
						},
					],
				},
			},
		});
		await handleSlashMessage(state.context);

		expect(state.cleared).toBe(1);
		expect(state.processInputs).toEqual(["/list"]);
		expect(state.createdMenus).toEqual([{ chatId: 10, kind: "list", query: null, entriesLength: 1 }]);
		expect(state.sent).toHaveLength(1);
		expect(state.sent[0]?.options?.inlineKeyboard?.[0]?.[0]?.callbackData).toBe("cb");
	});

	it("forwards save results to opener flow", async () => {
		const saveResult = createSaveResult();
		const state = createContext({
			normalizedInput: "/save https://example.com",
			processResult: { ok: true, value: saveResult },
		});
		await handleSlashMessage(state.context);

		expect(state.cleared).toBe(1);
		expect(state.saveForwarded).toEqual([{ chatId: 10, saveResult }]);
		expect(state.sent).toHaveLength(0);
	});

	it("renders formatted result chunks when menu result is empty", async () => {
		const state = createContext({
			normalizedInput: "/list",
			processResult: { ok: true, value: { type: "list", items: [] } },
		});
		await handleSlashMessage(state.context);

		expect(state.sent).toHaveLength(1);
		expect(state.sent[0]?.text).toContain("No saved items yet");
	});
});
