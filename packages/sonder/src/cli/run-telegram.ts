import type { Writable } from "node:stream";
import { SonderApp } from "../app/index.js";
import { TelegramBotRunner, TelegramHttpApi } from "../transport/telegram.js";
import { createResponderFromEnv } from "./responder-from-env.js";

interface ParsedTelegramArgs {
	rootDir: string;
}

const DEFAULT_ROOT_DIR = ".sonder";

function parseArgs(args: string[]): ParsedTelegramArgs | null {
	let rootDir = DEFAULT_ROOT_DIR;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--root") {
			const value = args[index + 1];
			if (!value) {
				return null;
			}
			rootDir = value;
			index++;
		}
	}
	return { rootDir };
}

function usage(): string {
	return [
		"Usage:",
		"  sonder --telegram [--root <dir>]",
		"",
		"Environment:",
		"  SONDER_TELEGRAM_BOT_TOKEN=<bot-token>",
		"  SONDER_TELEGRAM_PROXY=<proxy-url> (optional)",
	].join("\n");
}

export async function runTelegramMode(args: string[], stdout: Writable, stderr: Writable): Promise<number> {
	const parsed = parseArgs(args);
	if (!parsed) {
		stderr.write(`${usage()}\n`);
		return 1;
	}

	const token = process.env.SONDER_TELEGRAM_BOT_TOKEN;
	if (!token) {
		stderr.write("SONDER_TELEGRAM_BOT_TOKEN is required for --telegram mode.\n");
		return 1;
	}

	const app = new SonderApp({
		paths: { rootDir: parsed.rootDir },
		responder: createResponderFromEnv(process.env),
	});

	const proxyUrl =
		process.env.SONDER_TELEGRAM_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;

	stderr.write("[telegram] polling started\n");
	if (proxyUrl) {
		stderr.write(`[telegram] using proxy: ${proxyUrl}\n`);
	}
	const api = new TelegramHttpApi(token, undefined, { proxyUrl });
	const runner = new TelegramBotRunner(api, app, { stderr });

	try {
		await runner.runForever();
		return 0;
	} finally {
		app.close();
		stdout.write("[telegram] stopped\n");
	}
}
