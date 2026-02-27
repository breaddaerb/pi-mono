export type ParsedTelegramCommand =
	| ParsedSaveCommand
	| ParsedAskCommand
	| ParsedListCommand
	| ParsedFindCommand
	| ParsedAnnotateCommand
	| ParsedAnnotationListCommand
	| ParsedAnnotationDeleteCommand
	| ParsedAuthListCommand
	| ParsedAuthLoginCommand
	| ParsedAuthDoneCommand
	| ParsedAuthCancelCommand
	| ParsedAuthStatusCommand
	| ParsedAuthLogoutCommand
	| ParsedAuthLoginFileCommand;

export interface ParsedSaveCommand {
	type: "save";
	url: string;
	tags: string[];
	pastedText: string | null;
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

export interface ParsedFindCommand {
	type: "find";
	query: string;
	limit: number;
}

export interface ParsedAnnotateCommand {
	type: "annotate";
	itemId: string;
	text: string;
	tags: string[];
}

export interface ParsedAnnotationListCommand {
	type: "ann-list";
	itemId: string;
}

export interface ParsedAnnotationDeleteCommand {
	type: "ann-del";
	annotationId: string;
}

export interface ParsedAuthListCommand {
	type: "auth-list";
	limit: number;
}

export interface ParsedAuthLoginCommand {
	type: "auth-login";
	domain: string;
}

export interface ParsedAuthDoneCommand {
	type: "auth-done";
	domain: string;
}

export interface ParsedAuthCancelCommand {
	type: "auth-cancel";
	domain: string;
}

export interface ParsedAuthStatusCommand {
	type: "auth-status";
	domain: string;
}

export interface ParsedAuthLogoutCommand {
	type: "auth-logout";
	domain: string;
}

export interface ParsedAuthLoginFileCommand {
	type: "auth-login-file";
	domain: string;
	storageStatePath: string;
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
	const pastedTokens: string[] = [];
	for (const token of remainder) {
		if (token.startsWith("#") && token.length > 1) {
			tags.push(token.slice(1));
			continue;
		}
		pastedTokens.push(token);
	}
	const pastedText = pastedTokens.join(" ").trim();

	return {
		ok: true,
		value: {
			type: "save",
			url: normalizedUrl,
			tags,
			pastedText: pastedText.length > 0 ? pastedText : null,
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

function parseFindCommand(input: string): ParseTelegramCommandResult {
	const raw = input.trim();
	const body = raw.slice("/find".length).trim();
	if (!body) {
		return {
			ok: false,
			error: { code: "MISSING_ARGUMENTS", message: "Expected: /find <query> [limit]" },
		};
	}

	const segments = body.split(/\s+/).filter((segment) => segment.length > 0);
	let limit = 10;
	let querySegments = segments;
	const last = segments[segments.length - 1];
	if (last && /^\d+$/.test(last)) {
		limit = Number.parseInt(last, 10);
		querySegments = segments.slice(0, -1);
	}
	const query = querySegments.join(" ").trim();
	if (!query) {
		return {
			ok: false,
			error: { code: "MISSING_ARGUMENTS", message: "Expected: /find <query> [limit]" },
		};
	}

	return {
		ok: true,
		value: {
			type: "find",
			query,
			limit,
		},
	};
}

function parseAnnotateCommand(input: string): ParseTelegramCommandResult {
	const raw = input.trim();
	const body = raw.slice("/annotate".length).trim();
	if (!body) {
		return {
			ok: false,
			error: { code: "MISSING_ARGUMENTS", message: "Expected: /annotate <itemId> <text> [#tags...]" },
		};
	}

	const segments = body.split(/\s+/).filter((segment) => segment.length > 0);
	if (segments.length < 2) {
		return {
			ok: false,
			error: { code: "MISSING_ARGUMENTS", message: "Expected: /annotate <itemId> <text> [#tags...]" },
		};
	}

	const itemId = segments[0];
	const tags: string[] = [];
	const textTokens: string[] = [];
	for (const token of segments.slice(1)) {
		if (token.startsWith("#") && token.length > 1) {
			tags.push(token.slice(1));
			continue;
		}
		textTokens.push(token);
	}

	const text = textTokens.join(" ").trim();
	if (!itemId || !text) {
		return {
			ok: false,
			error: { code: "MISSING_ARGUMENTS", message: "Expected: /annotate <itemId> <text> [#tags...]" },
		};
	}

	return {
		ok: true,
		value: {
			type: "annotate",
			itemId,
			text,
			tags,
		},
	};
}

function parseAnnotationCommand(input: string): ParseTelegramCommandResult {
	const raw = input.trim();
	const body = raw.slice("/ann".length).trim();
	if (!body) {
		return {
			ok: false,
			error: { code: "MISSING_ARGUMENTS", message: "Expected: /ann list <itemId> | /ann del <annotationId>" },
		};
	}

	const segments = body.split(/\s+/).filter((segment) => segment.length > 0);
	const action = segments[0];
	if (action === "list") {
		if (segments.length !== 2) {
			return {
				ok: false,
				error: { code: "MISSING_ARGUMENTS", message: "Expected: /ann list <itemId>" },
			};
		}
		return {
			ok: true,
			value: {
				type: "ann-list",
				itemId: segments[1],
			},
		};
	}

	if (action === "del") {
		if (segments.length !== 2) {
			return {
				ok: false,
				error: { code: "MISSING_ARGUMENTS", message: "Expected: /ann del <annotationId>" },
			};
		}
		return {
			ok: true,
			value: {
				type: "ann-del",
				annotationId: segments[1],
			},
		};
	}

	return {
		ok: false,
		error: { code: "UNSUPPORTED_COMMAND", message: "Supported: /ann list <itemId>, /ann del <annotationId>" },
	};
}

function parseAuthCommand(input: string): ParseTelegramCommandResult {
	const raw = input.trim();
	const body = raw.slice("/auth".length).trim();
	if (!body) {
		return {
			ok: false,
			error: {
				code: "MISSING_ARGUMENTS",
				message: [
					"Expected: /auth login <domain> | /auth done <domain> | /auth cancel <domain>",
					"| /auth list [limit] | /auth status <domain> | /auth logout <domain>",
					"| /auth login-file <domain> <storageStatePath>",
				].join(" "),
			},
		};
	}

	const segments = body.split(/\s+/).filter((segment) => segment.length > 0);
	const action = segments[0];

	if (action === "list") {
		if (segments.length === 1) {
			return {
				ok: true,
				value: {
					type: "auth-list",
					limit: 20,
				},
			};
		}
		if (segments.length !== 2) {
			return {
				ok: false,
				error: { code: "MISSING_ARGUMENTS", message: "Expected: /auth list [limit]" },
			};
		}
		const parsedLimit = Number.parseInt(segments[1], 10);
		if (!Number.isFinite(parsedLimit) || String(parsedLimit) !== segments[1] || parsedLimit <= 0) {
			return {
				ok: false,
				error: { code: "MISSING_ARGUMENTS", message: "Expected: /auth list [limit]" },
			};
		}
		return {
			ok: true,
			value: {
				type: "auth-list",
				limit: parsedLimit,
			},
		};
	}

	if (action === "status") {
		if (segments.length !== 2) {
			return {
				ok: false,
				error: { code: "MISSING_ARGUMENTS", message: "Expected: /auth status <domain>" },
			};
		}
		return {
			ok: true,
			value: {
				type: "auth-status",
				domain: segments[1],
			},
		};
	}

	if (action === "login") {
		if (segments.length !== 2) {
			return {
				ok: false,
				error: { code: "MISSING_ARGUMENTS", message: "Expected: /auth login <domain>" },
			};
		}
		return {
			ok: true,
			value: {
				type: "auth-login",
				domain: segments[1],
			},
		};
	}

	if (action === "done") {
		if (segments.length !== 2) {
			return {
				ok: false,
				error: { code: "MISSING_ARGUMENTS", message: "Expected: /auth done <domain>" },
			};
		}
		return {
			ok: true,
			value: {
				type: "auth-done",
				domain: segments[1],
			},
		};
	}

	if (action === "cancel") {
		if (segments.length !== 2) {
			return {
				ok: false,
				error: { code: "MISSING_ARGUMENTS", message: "Expected: /auth cancel <domain>" },
			};
		}
		return {
			ok: true,
			value: {
				type: "auth-cancel",
				domain: segments[1],
			},
		};
	}

	if (action === "logout") {
		if (segments.length !== 2) {
			return {
				ok: false,
				error: { code: "MISSING_ARGUMENTS", message: "Expected: /auth logout <domain>" },
			};
		}
		return {
			ok: true,
			value: {
				type: "auth-logout",
				domain: segments[1],
			},
		};
	}

	if (action === "login-file") {
		if (segments.length !== 3) {
			return {
				ok: false,
				error: {
					code: "MISSING_ARGUMENTS",
					message: "Expected: /auth login-file <domain> <storageStatePath>",
				},
			};
		}
		return {
			ok: true,
			value: {
				type: "auth-login-file",
				domain: segments[1],
				storageStatePath: segments[2],
			},
		};
	}

	return {
		ok: false,
		error: {
			code: "UNSUPPORTED_COMMAND",
			message: [
				"Supported: /auth login <domain>, /auth done <domain>, /auth cancel <domain>,",
				"/auth list [limit], /auth status <domain>, /auth logout <domain>,",
				"/auth login-file <domain> <storageStatePath>",
			].join(" "),
		},
	};
}

export function parseTelegramCommand(input: string): ParseTelegramCommandResult {
	const raw = input.trim();
	const [command] = raw.split(/\s+/, 1);

	if (command === "/save") {
		return parseSaveCommand(raw);
	}
	if (command === "/ask") {
		return parseAskCommand(raw);
	}
	if (command === "/list") {
		return parseListCommand(raw);
	}
	if (command === "/find") {
		return parseFindCommand(raw);
	}
	if (command === "/annotate") {
		return parseAnnotateCommand(raw);
	}
	if (command === "/ann") {
		return parseAnnotationCommand(raw);
	}
	if (command === "/auth") {
		return parseAuthCommand(raw);
	}
	return {
		ok: false,
		error: {
			code: "UNSUPPORTED_COMMAND",
			message: "Only /save, /ask, /list, /find, /annotate, /ann, and /auth are supported in MVP.",
		},
	};
}
