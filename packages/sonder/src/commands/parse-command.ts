export type ParsedTelegramCommand = ParsedSaveCommand | ParsedAskCommand | ParsedListCommand;

export interface ParsedSaveCommand {
	type: "save";
	url: string;
	tags: string[];
}

export interface ParsedAskCommand {
	type: "ask";
	itemId: string;
	question: string;
}

export interface ParsedListCommand {
	type: "list";
	limit: number;
}

export interface ParseTelegramCommandError {
	code: "UNSUPPORTED_COMMAND" | "INVALID_URL" | "MISSING_ARGUMENTS";
	message: string;
}

type ParseTelegramCommandResult =
	| { ok: true; value: ParsedTelegramCommand }
	| { ok: false; error: ParseTelegramCommandError };

function parseSaveCommand(input: string): ParseTelegramCommandResult {
	const raw = input.trim();
	const body = raw.slice("/save".length).trim();
	if (!body) {
		return {
			ok: false,
			error: { code: "MISSING_ARGUMENTS", message: "Expected: /save <url> [#tags...]" },
		};
	}

	const segments = body.split(/\s+/).filter((segment) => segment.length > 0);
	const [urlCandidate, ...remainder] = segments;

	let normalizedUrl: string;
	try {
		const parsedUrl = new URL(urlCandidate);
		if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
			return {
				ok: false,
				error: { code: "INVALID_URL", message: "Only http/https URLs are supported for /save." },
			};
		}
		normalizedUrl = parsedUrl.toString();
	} catch {
		return {
			ok: false,
			error: { code: "INVALID_URL", message: `Invalid URL for /save: ${urlCandidate}` },
		};
	}

	const tags: string[] = [];
	for (const token of remainder) {
		if (token.startsWith("#") && token.length > 1) {
			tags.push(token.slice(1));
		}
	}

	return {
		ok: true,
		value: {
			type: "save",
			url: normalizedUrl,
			tags,
		},
	};
}

function parseAskCommand(input: string): ParseTelegramCommandResult {
	const raw = input.trim();
	const body = raw.slice("/ask".length).trim();
	if (!body) {
		return {
			ok: false,
			error: { code: "MISSING_ARGUMENTS", message: "Expected: /ask <itemId> <question>" },
		};
	}

	const firstSpaceIndex = body.indexOf(" ");
	if (firstSpaceIndex === -1) {
		return {
			ok: false,
			error: { code: "MISSING_ARGUMENTS", message: "Expected both itemId and question for /ask." },
		};
	}

	const itemId = body.slice(0, firstSpaceIndex).trim();
	const question = body.slice(firstSpaceIndex + 1).trim();
	if (!itemId || !question) {
		return {
			ok: false,
			error: { code: "MISSING_ARGUMENTS", message: "Expected both itemId and question for /ask." },
		};
	}

	return {
		ok: true,
		value: {
			type: "ask",
			itemId,
			question,
		},
	};
}

function parseListCommand(input: string): ParseTelegramCommandResult {
	const raw = input.trim();
	const body = raw.slice("/list".length).trim();
	if (body.length === 0) {
		return {
			ok: true,
			value: {
				type: "list",
				limit: 20,
			},
		};
	}

	const parsedLimit = Number.parseInt(body, 10);
	if (!Number.isFinite(parsedLimit) || String(parsedLimit) !== body || parsedLimit <= 0) {
		return {
			ok: false,
			error: { code: "MISSING_ARGUMENTS", message: "Expected: /list [limit]" },
		};
	}

	return {
		ok: true,
		value: {
			type: "list",
			limit: parsedLimit,
		},
	};
}

export function parseTelegramCommand(input: string): ParseTelegramCommandResult {
	const raw = input.trim();
	if (raw.startsWith("/save")) {
		return parseSaveCommand(raw);
	}
	if (raw.startsWith("/ask")) {
		return parseAskCommand(raw);
	}
	if (raw.startsWith("/list")) {
		return parseListCommand(raw);
	}
	return {
		ok: false,
		error: {
			code: "UNSUPPORTED_COMMAND",
			message: "Only /save, /ask, and /list are supported in MVP.",
		},
	};
}
