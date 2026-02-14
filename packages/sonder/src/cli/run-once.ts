import { join } from "node:path";
import type { Writable } from "node:stream";
import { AuthStorage } from "@mariozechner/pi-coding-agent";
import { SonderApp } from "../app/index.js";
import { type AskResponder, createCodexResponder, createStubResponder } from "../runtime/index.js";

interface ParsedCliArgs {
	rootDir: string;
	command: string;
}

export interface RunCommandOnceOptions {
	env?: NodeJS.ProcessEnv;
	createResponder?: (env: NodeJS.ProcessEnv) => AskResponder;
}

const DEFAULT_ROOT_DIR = ".sonder";

function parseCliArgs(args: string[]): ParsedCliArgs | null {
	let rootDir = DEFAULT_ROOT_DIR;
	const remaining: string[] = [];

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--root") {
			const value = args[index + 1];
			if (!value) {
				return null;
			}
			rootDir = value;
			index++;
			continue;
		}
		remaining.push(arg);
	}

	const command = remaining.join(" ").trim();
	if (!command) {
		return null;
	}

	return { rootDir, command };
}

function usage(): string {
	return [
		"Usage:",
		"  sonder [--root <dir>] <command>",
		"",
		"Examples:",
		"  sonder --root ./.sonder-data /save https://lucumr.pocoo.org/2026/2/9/a-language-for-agents '#agents'",
		"  sonder --root ./.sonder-data /list",
		'  sonder --root ./.sonder-data /ask <itemId> "what is the thesis?"',
		"",
		"Responder modes:",
		"  SONDER_RESPONDER=stub (default)",
		"  SONDER_RESPONDER=codex with either:",
		"    - SONDER_CODEX_TOKEN=<token>",
		"    - or pi OAuth credentials in .pi/auth.json (or SONDER_AUTH_PATH)",
	].join("\n");
}

function createCodexTokenResolver(env: NodeJS.ProcessEnv): () => Promise<string | undefined> {
	const explicitToken = env.SONDER_CODEX_TOKEN;
	if (explicitToken) {
		return async () => explicitToken;
	}

	const localAuthPath = env.SONDER_AUTH_PATH ?? join(process.cwd(), ".pi", "auth.json");
	const localAuthStorage = new AuthStorage(localAuthPath);
	const useGlobalAuth = env.SONDER_DISABLE_GLOBAL_AUTH !== "1";
	const globalAuthStorage = useGlobalAuth ? new AuthStorage() : null;

	return async () => {
		const localToken = await localAuthStorage.getApiKey("openai-codex");
		if (localToken) {
			return localToken;
		}
		if (!globalAuthStorage) {
			return undefined;
		}
		return globalAuthStorage.getApiKey("openai-codex");
	};
}

function createResponderFromEnv(env: NodeJS.ProcessEnv): AskResponder {
	const mode = (env.SONDER_RESPONDER ?? "stub").toLowerCase();
	if (mode === "codex") {
		const reasoning = env.SONDER_CODEX_REASONING;
		const modelId = env.SONDER_CODEX_MODEL;
		return createCodexResponder({
			getToken: createCodexTokenResolver(env),
			modelId,
			reasoning:
				reasoning === "minimal" || reasoning === "low" || reasoning === "medium" || reasoning === "high"
					? reasoning
					: undefined,
		});
	}
	return createStubResponder();
}

export async function runCommandOnce(
	args: string[],
	stdout: Writable,
	stderr: Writable,
	options: RunCommandOnceOptions = {},
): Promise<number> {
	const parsed = parseCliArgs(args);
	if (!parsed) {
		stderr.write(`${usage()}\n`);
		return 1;
	}

	const env = options.env ?? process.env;
	const responderFactory = options.createResponder ?? createResponderFromEnv;

	let app: SonderApp;
	try {
		app = new SonderApp({
			paths: { rootDir: parsed.rootDir },
			responder: responderFactory(env),
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		stderr.write(`${message}\n`);
		return 1;
	}

	try {
		const result = await app.processCommand(parsed.command);
		const output = result.ok ? result.value : result.error;
		stdout.write(`${JSON.stringify(output, null, 2)}\n`);
		return result.ok ? 0 : 1;
	} finally {
		app.close();
	}
}
