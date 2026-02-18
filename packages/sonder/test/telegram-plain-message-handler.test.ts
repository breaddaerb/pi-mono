import { describe, expect, it } from "vitest";
import type { SonderCommandResult, SonderProcessResult } from "../src/app/index.js";
import type { ChatModeState } from "../src/transport/telegram-mode-store.js";
import {
	type ExtractedUrlInput,
	handlePlainMessage,
	type PlainMessageHandlerContext,
} from "../src/transport/telegram-plain-message-handler.js";

type SentMessage = { chatId: number; text: string };

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

function createContext(input: {
	pendingSave?: boolean;
	activeMode?: ChatModeState;
	processResult?: SonderProcessResult;
	extractedUrl?: ExtractedUrlInput | null;
	saveResult?: Extract<SonderCommandResult, { type: "save" }>;
}): {
	context: PlainMessageHandlerContext;
	sent: SentMessage[];
	clearCalls: number;
	sendSaveCalls: Array<{ chatId: number; saveResult: Extract<SonderCommandResult, { type: "save" }> }>;
	saveFromInputCalls: Array<{ url: string; tags?: string[]; pastedText?: string | null }>;
	activeModeCalls: Array<{ chatId: number; text: string; mode: ChatModeState }>;
} {
	const sent: SentMessage[] = [];
	const sendSaveCalls: Array<{ chatId: number; saveResult: Extract<SonderCommandResult, { type: "save" }> }> = [];
	const saveFromInputCalls: Array<{ url: string; tags?: string[]; pastedText?: string | null }> = [];
	const activeModeCalls: Array<{ chatId: number; text: string; mode: ChatModeState }> = [];
	let clearCalls = 0;

	const context: PlainMessageHandlerContext = {
		chatId: 5,
		text: "hello",
		normalizedInput: "hello",
		hasPendingSaveInput: () => input.pendingSave ?? false,
		clearPendingSaveInput: () => {
			clearCalls += 1;
		},
		getChatMode: () => input.activeMode,
		processCommand: async () => input.processResult ?? { ok: true, value: { type: "list", items: [] } },
		saveFromInput: async (payload) => {
			saveFromInputCalls.push(payload);
			return input.saveResult ?? createSaveResult();
		},
		sendSaveResultAndMaybeOpenItemMode: async (chatId, saveResult) => {
			sendSaveCalls.push({ chatId, saveResult });
		},
		extractUrlAndPastedText: () => (input.extractedUrl === undefined ? null : input.extractedUrl),
		handleActiveModeMessage: async (chatId, text, mode) => {
			activeModeCalls.push({ chatId, text, mode });
		},
		sendMessage: async (chatId, text) => {
			sent.push({ chatId, text });
		},
	};

	return {
		context,
		sent,
		get clearCalls() {
			return clearCalls;
		},
		sendSaveCalls,
		saveFromInputCalls,
		activeModeCalls,
	};
}

describe("telegram plain message handler", () => {
	it("keeps waiting state and sends guidance when pending save parsing fails", async () => {
		const state = createContext({
			pendingSave: true,
			processResult: { ok: true, value: { type: "list", items: [] } },
		});
		await handlePlainMessage(state.context);

		expect(state.clearCalls).toBe(0);
		expect(state.sendSaveCalls).toHaveLength(0);
		expect(state.sent).toHaveLength(2);
		expect(state.sent[1]?.text).toContain("Still waiting for save input");
	});

	it("consumes pending save input when parsed as save command", async () => {
		const saveResult = createSaveResult();
		const state = createContext({
			pendingSave: true,
			processResult: { ok: true, value: saveResult },
		});
		await handlePlainMessage(state.context);

		expect(state.clearCalls).toBe(1);
		expect(state.sendSaveCalls).toEqual([{ chatId: 5, saveResult }]);
		expect(state.sent).toHaveLength(0);
	});

	it("saves extracted URL when no active mode", async () => {
		const state = createContext({
			extractedUrl: { url: "https://example.com/post", pastedText: "evidence" },
		});
		await handlePlainMessage(state.context);

		expect(state.saveFromInputCalls).toEqual([{ url: "https://example.com/post", tags: [], pastedText: "evidence" }]);
		expect(state.sendSaveCalls).toHaveLength(1);
	});

	it("shows no-active-dialogue guidance when plain text has no URL and no mode", async () => {
		const state = createContext({ extractedUrl: null });
		await handlePlainMessage(state.context);

		expect(state.sent).toHaveLength(1);
		expect(state.sent[0]?.text).toContain("No active dialogue");
		expect(state.activeModeCalls).toHaveLength(0);
	});

	it("delegates to active-mode handler when mode is active", async () => {
		const activeMode: ChatModeState = { mode: "general", sessionId: "session-1", history: [] };
		const state = createContext({ activeMode });
		await handlePlainMessage(state.context);

		expect(state.clearCalls).toBe(1);
		expect(state.activeModeCalls).toEqual([{ chatId: 5, text: "hello", mode: activeMode }]);
		expect(state.sent).toHaveLength(0);
	});
});
