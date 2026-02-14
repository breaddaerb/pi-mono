import { describe, expect, it } from "vitest";
import { parseTelegramCommand } from "../src/commands/parse-command.js";

describe("parseTelegramCommand", () => {
	it("parses /save with URL and tags", () => {
		const result = parseTelegramCommand("/save https://lucumr.pocoo.org/2026/2/9/a-language-for-agents #agents #llm");

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected save command to parse");
		expect(result.value).toEqual({
			type: "save",
			url: "https://lucumr.pocoo.org/2026/2/9/a-language-for-agents",
			tags: ["agents", "llm"],
		});
	});

	it("rejects /save with non-http protocol", () => {
		const result = parseTelegramCommand("/save ftp://example.com/file");

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected save command to fail");
		expect(result.error.code).toBe("INVALID_URL");
	});

	it("parses /ask with item id and question", () => {
		const result = parseTelegramCommand("/ask item_123 what is the main thesis?");

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected ask command to parse");
		expect(result.value).toEqual({
			type: "ask",
			itemId: "item_123",
			question: "what is the main thesis?",
		});
	});

	it("rejects /ask without question", () => {
		const result = parseTelegramCommand("/ask item_123");

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected ask command to fail");
		expect(result.error.code).toBe("MISSING_ARGUMENTS");
	});

	it("parses /list with default limit", () => {
		const result = parseTelegramCommand("/list");

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected list command to parse");
		expect(result.value).toEqual({ type: "list", limit: 20 });
	});

	it("parses /list with explicit limit", () => {
		const result = parseTelegramCommand("/list 10");

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected list command to parse");
		expect(result.value).toEqual({ type: "list", limit: 10 });
	});

	it("rejects /list with invalid limit", () => {
		const result = parseTelegramCommand("/list ten");

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected list command to fail");
		expect(result.error.code).toBe("MISSING_ARGUMENTS");
	});

	it("rejects unsupported commands", () => {
		const result = parseTelegramCommand("/open item_123");

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected unsupported command to fail");
		expect(result.error.code).toBe("UNSUPPORTED_COMMAND");
	});
});
