import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
	configureTelegramCommandSuggestions,
	DEFAULT_TELEGRAM_COMMAND_SUGGESTIONS,
	runTelegramCheckMode,
	runTelegramMode,
} from "../src/cli/run-telegram.js";

class MemoryWritable extends Writable {
	private chunks: string[] = [];

	_write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
		this.chunks.push(Buffer.from(chunk as Buffer).toString("utf8"));
		callback();
	}

	getText(): string {
		return this.chunks.join("");
	}
}

describe("runTelegramMode", () => {
	it("returns error when token env is missing", async () => {
		const originalToken = process.env.SONDER_TELEGRAM_BOT_TOKEN;
		delete process.env.SONDER_TELEGRAM_BOT_TOKEN;

		try {
			const stdout = new MemoryWritable();
			const stderr = new MemoryWritable();
			const exitCode = await runTelegramMode(["--root", ".tmp"], stdout, stderr);

			expect(exitCode).toBe(1);
			expect(stderr.getText()).toContain("SONDER_TELEGRAM_BOT_TOKEN is required");
		} finally {
			if (originalToken) {
				process.env.SONDER_TELEGRAM_BOT_TOKEN = originalToken;
			}
		}
	});

	it("telegram check mode returns bot connectivity info", async () => {
		const originalToken = process.env.SONDER_TELEGRAM_BOT_TOKEN;
		process.env.SONDER_TELEGRAM_BOT_TOKEN = "token";

		const fetchImpl = async (url: string) => {
			if (url.includes("/getMe")) {
				return new Response(
					JSON.stringify({ ok: true, result: { id: 1, username: "sonder", first_name: "Sonder" } }),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}
			if (url.includes("/getUpdates")) {
				return new Response(JSON.stringify({ ok: true, result: [] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return new Response("not found", { status: 404 });
		};

		try {
			const stdout = new MemoryWritable();
			const stderr = new MemoryWritable();
			const exitCode = await runTelegramCheckMode([], stdout, stderr, { fetchImpl });

			expect(exitCode).toBe(0);
			expect(stderr.getText()).toBe("");
			expect(stdout.getText()).toContain('"ok": true');
			expect(stdout.getText()).toContain('"username": "sonder"');
		} finally {
			if (originalToken) {
				process.env.SONDER_TELEGRAM_BOT_TOKEN = originalToken;
			} else {
				delete process.env.SONDER_TELEGRAM_BOT_TOKEN;
			}
		}
	});

	it("registers telegram command suggestions via setMyCommands", async () => {
		const stderr = new MemoryWritable();
		let receivedCommands: Array<{ command: string; description: string }> = [];
		await configureTelegramCommandSuggestions(
			{
				setMyCommands: async (commands) => {
					receivedCommands = commands;
				},
			},
			stderr,
		);

		expect(receivedCommands).toEqual(DEFAULT_TELEGRAM_COMMAND_SUGGESTIONS);
		expect(stderr.getText()).toContain("command suggestions registered");
	});

	it("logs setMyCommands failures and continues", async () => {
		const stderr = new MemoryWritable();
		await configureTelegramCommandSuggestions(
			{
				setMyCommands: async () => {
					throw new Error("forbidden");
				},
			},
			stderr,
		);
		expect(stderr.getText()).toContain("setMyCommands failed: forbidden");
	});
});
