export type ParsedTelegramModeCommand =
	| { type: "open"; itemId?: string }
	| { type: "exit" }
	| { type: "where" }
	| { type: "models" }
	| { type: "sessions"; itemId?: string }
	| { type: "resume"; sessionId: string }
	| { type: "history"; sessionId?: string }
	| { type: "context" };

function splitCommandParts(text: string): string[] {
	return text
		.trim()
		.split(/\s+/)
		.filter((part) => part.length > 0);
}

export function parseTelegramModeCommand(text: string): ParsedTelegramModeCommand | null {
	const parts = splitCommandParts(text);
	if (parts.length === 0) {
		return null;
	}

	const command = parts[0];
	if (command === "/open") {
		return { type: "open", itemId: parts[1] };
	}
	if (command === "/exit") {
		return { type: "exit" };
	}
	if (command === "/where") {
		return { type: "where" };
	}
	if (command === "/models") {
		return { type: "models" };
	}
	if (command === "/sessions") {
		return { type: "sessions", itemId: parts[1] };
	}
	if (command === "/resume" && parts[1]) {
		return { type: "resume", sessionId: parts[1] };
	}
	if (command === "/history") {
		return { type: "history", sessionId: parts[1] };
	}
	if (command === "/context") {
		return { type: "context" };
	}
	return null;
}
