import { describe, expect, it } from "vitest";
import type { ParsedTelegramModeCommand } from "../src/commands/parse-mode-command.js";
import { routeTelegramMessage, type TelegramMessageRouterContext } from "../src/transport/telegram-message-router.js";

function createContext(input: { chatId?: number; text: string }): {
	context: TelegramMessageRouterContext;
	cleared: number;
	modeCalls: Array<{ chatId: number; command: ParsedTelegramModeCommand }>;
	plainCalls: Array<{ chatId: number; text: string; normalizedInput: string }>;
	slashCalls: Array<{ chatId: number; normalizedInput: string }>;
} {
	let cleared = 0;
	const modeCalls: Array<{ chatId: number; command: ParsedTelegramModeCommand }> = [];
	const plainCalls: Array<{ chatId: number; text: string; normalizedInput: string }> = [];
	const slashCalls: Array<{ chatId: number; normalizedInput: string }> = [];

	const context: TelegramMessageRouterContext = {
		chatId: input.chatId ?? 8,
		text: input.text,
		clearPendingSaveInput: () => {
			cleared += 1;
		},
		handleModeCommand: async (chatId, command) => {
			modeCalls.push({ chatId, command });
		},
		handlePlainMessage: async (chatId, text, normalizedInput) => {
			plainCalls.push({ chatId, text, normalizedInput });
		},
		handleSlashMessage: async (chatId, normalizedInput) => {
			slashCalls.push({ chatId, normalizedInput });
		},
	};

	return {
		context,
		get cleared() {
			return cleared;
		},
		modeCalls,
		plainCalls,
		slashCalls,
	};
}

describe("telegram message router", () => {
	it("routes mode commands and clears pending save state", async () => {
		const state = createContext({ text: "/open item-1" });
		await routeTelegramMessage(state.context);

		expect(state.cleared).toBe(1);
		expect(state.modeCalls).toEqual([{ chatId: 8, command: { type: "open", itemId: "item-1" } }]);
		expect(state.plainCalls).toHaveLength(0);
		expect(state.slashCalls).toHaveLength(0);
	});

	it("normalizes command mentions before mode command routing", async () => {
		const state = createContext({ text: "/where@sonder_bot" });
		await routeTelegramMessage(state.context);

		expect(state.modeCalls).toEqual([{ chatId: 8, command: { type: "where" } }]);
		expect(state.slashCalls).toHaveLength(0);
	});

	it("routes plain text to plain-message handler", async () => {
		const state = createContext({ text: "hello world" });
		await routeTelegramMessage(state.context);

		expect(state.modeCalls).toHaveLength(0);
		expect(state.plainCalls).toEqual([{ chatId: 8, text: "hello world", normalizedInput: "hello world" }]);
		expect(state.slashCalls).toHaveLength(0);
	});

	it("routes non-mode slash commands to slash handler with normalized token", async () => {
		const state = createContext({ text: "/save@sonder_bot" });
		await routeTelegramMessage(state.context);

		expect(state.modeCalls).toHaveLength(0);
		expect(state.plainCalls).toHaveLength(0);
		expect(state.slashCalls).toEqual([{ chatId: 8, normalizedInput: "/save" }]);
	});
});
