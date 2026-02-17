import type { Writable } from "node:stream";
import { SonderApp } from "../app/index.js";
import { type TelegramBotCommand, TelegramBotRunner, TelegramHttpApi } from "../transport/telegram.js";
import { startViewerServer } from "../viewer/index.js";
import { createRuntimeResponderFromEnv } from "./responder-from-env.js";

interface ParsedTelegramArgs {
	rootDir: string;
}

type TelegramFetchOverride = (
	url: string,
	init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<Response>;

export interface RunTelegramOptions {
	fetchImpl?: TelegramFetchOverride;
}

const DEFAULT_ROOT_DIR = ".sonder";

export const DEFAULT_TELEGRAM_COMMAND_SUGGESTIONS: TelegramBotCommand[] = [
	{ command: "save", description: "Save URL with optional tags/text" },
	{ command: "find", description: "Search saved items" },
	{ command: "list", description: "List recent items" },
	{ command: "open", description: "Open item mode or general chat" },
	{ command: "sessions", description: "Show item dialogue sessions" },
	{ command: "history", description: "Show dialogue history" },
	{ command: "where", description: "Show active mode/session" },
	{ command: "models", description: "Switch Codex model" },
	{ command: "exit", description: "Exit active mode" },
];

function formatErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

export async function configureTelegramCommandSuggestions(
	api: { setMyCommands: (commands: TelegramBotCommand[]) => Promise<void> },
	stderr: Writable,
): Promise<void> {
	try {
		await api.setMyCommands(DEFAULT_TELEGRAM_COMMAND_SUGGESTIONS);
		stderr.write(`[telegram] command suggestions registered (${DEFAULT_TELEGRAM_COMMAND_SUGGESTIONS.length})\n`);
	} catch (error) {
		stderr.write(`[telegram] setMyCommands failed: ${formatErrorMessage(error)}\n`);
	}
}

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
		"  sonder --telegram-check",
		"",
		"Environment:",
		"  SONDER_TELEGRAM_BOT_TOKEN=<bot-token>",
		"  SONDER_TELEGRAM_PROXY=<proxy-url> (optional)",
		"  SONDER_VIEWER_PORT=<port> (optional, local snapshot viewer)",
	].join("\n");
}

function getProxyUrl(env: NodeJS.ProcessEnv): string | undefined {
	return env.SONDER_TELEGRAM_PROXY || env.HTTPS_PROXY || env.HTTP_PROXY || env.ALL_PROXY;
}

export async function runTelegramCheckMode(
	args: string[],
	stdout: Writable,
	stderr: Writable,
	options: RunTelegramOptions = {},
): Promise<number> {
	const parsed = parseArgs(args);
	if (!parsed) {
		stderr.write(`${usage()}\n`);
		return 1;
	}

	const token = process.env.SONDER_TELEGRAM_BOT_TOKEN;
	if (!token) {
		stderr.write("SONDER_TELEGRAM_BOT_TOKEN is required for --telegram-check mode.\n");
		return 1;
	}

	const proxyUrl = getProxyUrl(process.env);
	const api = new TelegramHttpApi(token, options.fetchImpl, { proxyUrl });
	try {
		const me = await api.getMe();
		const updates = await api.getUpdates(0, 1);
		stdout.write(
			`${JSON.stringify(
				{
					ok: true,
					bot: me,
					proxy: proxyUrl ?? null,
					updatesReceived: updates.length,
				},
				null,
				2,
			)}\n`,
		);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		stderr.write(`[telegram-check] ${message}\n`);
		return 1;
	}
}

export async function runTelegramMode(
	args: string[],
	stdout: Writable,
	stderr: Writable,
	options: RunTelegramOptions = {},
): Promise<number> {
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

	const runtimeResponder = createRuntimeResponderFromEnv(process.env);
	const app = new SonderApp({
		paths: { rootDir: parsed.rootDir },
		responder: runtimeResponder.responder,
	});

	const proxyUrl = getProxyUrl(process.env);
	const viewerPortRaw = process.env.SONDER_VIEWER_PORT;
	const viewerPort = viewerPortRaw ? Number.parseInt(viewerPortRaw, 10) : undefined;
	const viewerServer = await startViewerServer({
		app,
		port: Number.isFinite(viewerPort) ? viewerPort : undefined,
	});

	stderr.write("[telegram] polling started\n");
	stderr.write(`[viewer] started at ${viewerServer.baseUrl}\n`);
	if (proxyUrl) {
		stderr.write(`[telegram] using proxy: ${proxyUrl}\n`);
	}
	const api = new TelegramHttpApi(token, options.fetchImpl, { proxyUrl });
	await configureTelegramCommandSuggestions(api, stderr);
	const runner = new TelegramBotRunner(api, app, {
		stderr,
		getViewerItemUrl: viewerServer.getItemUrl,
		modelSelector: runtimeResponder.modelSelector,
	});

	try {
		await runner.runForever();
		return 0;
	} finally {
		await viewerServer.close();
		app.close();
		stdout.write("[telegram] stopped\n");
	}
}
