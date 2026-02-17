import { describe, expect, it } from "vitest";
import { TelegramHttpApi } from "../src/transport/telegram.js";

describe("TelegramHttpApi", () => {
	it("calls setMyCommands endpoint with command payload", async () => {
		const requests: Array<{ url: string; body: string }> = [];
		const api = new TelegramHttpApi(
			"token",
			async (url, init) => {
				requests.push({ url, body: init.body });
				return new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			},
			{},
		);

		await api.setMyCommands([
			{ command: "save", description: "Save URL" },
			{ command: "find", description: "Find items" },
		]);

		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toContain("/setMyCommands");
		expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({
			commands: [
				{ command: "save", description: "Save URL" },
				{ command: "find", description: "Find items" },
			],
		});
	});
});
