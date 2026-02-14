import type { Writable } from "node:stream";
import { SonderApp } from "../app/index.js";
import type { AskResponder } from "../runtime/index.js";

interface ParsedCliArgs {
	rootDir: string;
	command: string;
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
	].join("\n");
}

function createStubResponder(): AskResponder {
	return async (input) => {
		const citations = input.context.annotationEvidence.slice(0, 2).map((annotation) => `ann:${annotation.id}`);
		const citationSuffix = citations.length > 0 ? ` ${citations.map((citation) => `[${citation}]`).join(" ")}` : "";
		return {
			answer: `Stub response: ${input.question}.${citationSuffix}`.trim(),
			model: "stub-model",
			provider: "stub-provider",
			citations,
		};
	};
}

export async function runCommandOnce(args: string[], stdout: Writable, stderr: Writable): Promise<number> {
	const parsed = parseCliArgs(args);
	if (!parsed) {
		stderr.write(`${usage()}\n`);
		return 1;
	}

	const app = new SonderApp({
		paths: { rootDir: parsed.rootDir },
		responder: createStubResponder(),
	});

	try {
		const result = await app.processCommand(parsed.command);
		const output = result.ok ? result.value : result.error;
		stdout.write(`${JSON.stringify(output, null, 2)}\n`);
		return result.ok ? 0 : 1;
	} finally {
		app.close();
	}
}
