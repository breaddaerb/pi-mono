import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { runTelegramMode } from "../src/cli/run-telegram.js";

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
});
