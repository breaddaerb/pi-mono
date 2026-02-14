import type { Writable } from "node:stream";
import { SonderApp } from "../app/index.js";
import type { AskResponder } from "../runtime/index.js";
import { createResponderFromEnv } from "./responder-from-env.js";

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
		"  sonder --root ./.sonder-data /list [limit]",
		"  sonder --root ./.sonder-data /find <query> [limit]",
		'  sonder --root ./.sonder-data /ask <itemId> "what is the thesis?"',
		'  sonder --root ./.sonder-data /annotate <itemId> "key quote" #thesis',
		"  sonder --root ./.sonder-data /ann list <itemId>",
		"  sonder --root ./.sonder-data /ann del <annotationId>",
		"",
		"Responder modes:",
		"  SONDER_RESPONDER=stub (default)",
		"  SONDER_RESPONDER=codex with either:",
		"    - SONDER_CODEX_TOKEN=<token>",
		"    - or pi OAuth credentials in .pi/auth.json (or SONDER_AUTH_PATH)",
	].join("\n");
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
