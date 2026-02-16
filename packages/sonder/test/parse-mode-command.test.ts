import { describe, expect, it } from "vitest";
import { parseTelegramModeCommand } from "../src/commands/parse-mode-command.js";

describe("parseTelegramModeCommand", () => {
	it("parses /open with and without item id", () => {
		expect(parseTelegramModeCommand("/open")).toEqual({ type: "open", itemId: undefined });
		expect(parseTelegramModeCommand("/open item_123")).toEqual({ type: "open", itemId: "item_123" });
	});

	it("parses /exit, /where, /models", () => {
		expect(parseTelegramModeCommand("/exit")).toEqual({ type: "exit" });
		expect(parseTelegramModeCommand("/where")).toEqual({ type: "where" });
		expect(parseTelegramModeCommand("/models")).toEqual({ type: "models" });
	});

	it("parses /sessions and /history with optional args", () => {
		expect(parseTelegramModeCommand("/sessions")).toEqual({ type: "sessions", itemId: undefined });
		expect(parseTelegramModeCommand("/sessions item_9")).toEqual({ type: "sessions", itemId: "item_9" });
		expect(parseTelegramModeCommand("/history")).toEqual({ type: "history", sessionId: undefined });
		expect(parseTelegramModeCommand("/history sess_1")).toEqual({ type: "history", sessionId: "sess_1" });
	});

	it("parses /resume only with session id", () => {
		expect(parseTelegramModeCommand("/resume sess_1")).toEqual({ type: "resume", sessionId: "sess_1" });
		expect(parseTelegramModeCommand("/resume")).toBeNull();
	});

	it("returns null for non-mode commands and empty input", () => {
		expect(parseTelegramModeCommand("   ")).toBeNull();
		expect(parseTelegramModeCommand("/save https://example.com")).toBeNull();
		expect(parseTelegramModeCommand("hello")).toBeNull();
	});
});
