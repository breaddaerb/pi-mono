import { describe, expect, it } from "vitest";
import { sleep, stripTelegramCommandMention } from "../src/transport/telegram-utils.js";

describe("telegram utils", () => {
	it("strips bot mention from slash command token", () => {
		expect(stripTelegramCommandMention("/list@my_bot")).toBe("/list");
		expect(stripTelegramCommandMention("/find@my_bot query")).toBe("/find query");
		expect(stripTelegramCommandMention("hello")).toBe("hello");
	});

	it("rejects sleep when signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(sleep(5, controller.signal)).rejects.toThrow("Aborted");
	});

	it("resolves sleep normally", async () => {
		await expect(sleep(1)).resolves.toBeUndefined();
	});
});
