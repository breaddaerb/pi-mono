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
			pastedText: null,
		});
	});

	it("parses /save with pasted evidence text", () => {
		const result = parseTelegramCommand("/save https://x.com/foo/status/1 #x this is pasted evidence");

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected save command to parse");
		expect(result.value).toEqual({
			type: "save",
			url: "https://x.com/foo/status/1",
			tags: ["x"],
			pastedText: "this is pasted evidence",
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

	it("parses /find with default limit", () => {
		const result = parseTelegramCommand("/find language design");

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected find command to parse");
		expect(result.value).toEqual({ type: "find", query: "language design", limit: 10 });
	});

	it("parses /find with explicit limit", () => {
		const result = parseTelegramCommand("/find agent memory 5");

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected find command to parse");
		expect(result.value).toEqual({ type: "find", query: "agent memory", limit: 5 });
	});

	it("parses /annotate with tags", () => {
		const result = parseTelegramCommand("/annotate item_123 key idea from section two #thesis #idea");

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected annotate command to parse");
		expect(result.value).toEqual({
			type: "annotate",
			itemId: "item_123",
			text: "key idea from section two",
			tags: ["thesis", "idea"],
		});
	});

	it("parses /ann list", () => {
		const result = parseTelegramCommand("/ann list item_123");

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected ann list command to parse");
		expect(result.value).toEqual({ type: "ann-list", itemId: "item_123" });
	});

	it("parses /ann del", () => {
		const result = parseTelegramCommand("/ann del ann_123");

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected ann del command to parse");
		expect(result.value).toEqual({ type: "ann-del", annotationId: "ann_123" });
	});

	it("rejects invalid /ann action", () => {
		const result = parseTelegramCommand("/ann tag ann_123 #foo");

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected ann command to fail");
		expect(result.error.code).toBe("UNSUPPORTED_COMMAND");
	});

	it("rejects unsupported commands", () => {
		const result = parseTelegramCommand("/open item_123");

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected unsupported command to fail");
		expect(result.error.code).toBe("UNSUPPORTED_COMMAND");
	});

	it("rejects prefix-like commands that are not exact command tokens", () => {
		const saveLike = parseTelegramCommand("/saveX https://example.com");
		expect(saveLike.ok).toBe(false);
		if (saveLike.ok) throw new Error("Expected /saveX to be unsupported");
		expect(saveLike.error.code).toBe("UNSUPPORTED_COMMAND");

		const annLike = parseTelegramCommand("/annx list item_1");
		expect(annLike.ok).toBe(false);
		if (annLike.ok) throw new Error("Expected /annx to be unsupported");
		expect(annLike.error.code).toBe("UNSUPPORTED_COMMAND");
	});
});
