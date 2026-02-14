import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import { type Dispatcher, ProxyAgent, fetch as undiciFetch } from "undici";
import type { SonderApp } from "../app/index.js";
import { ChatModeStateRepo } from "../storage/index.js";

interface TelegramGetUpdatesResponse {
	ok: boolean;
	result: Array<{
		update_id: number;
		message?: {
			chat?: { id?: number };
			text?: string;
		};
	}>;
}

interface TelegramGetMeResponse {
	ok: boolean;
	result?: {
		id: number;
		username?: string;
		first_name?: string;
	};
}

interface TelegramSendMessageResponse {
	ok: boolean;
}

interface TelegramFetchInit {
	method: "POST";
	headers: Record<string, string>;
	body: string;
	dispatcher?: Dispatcher;
}

type TelegramFetch = (url: string, init: TelegramFetchInit) => Promise<Response>;

export interface TelegramApi {
	getMe(): Promise<{ id: number; username?: string; firstName?: string }>;
	getUpdates(
		offset: number,
		timeoutSeconds: number,
	): Promise<Array<{ updateId: number; chatId: number; text: string }>>;
	sendMessage(chatId: number, text: string): Promise<void>;
}

export interface TelegramRunnerOptions {
	longPollSeconds?: number;
	idleDelayMs?: number;
	stderr?: Writable;
	getViewerItemUrl?: (itemId: string) => string;
}

export interface TelegramHttpApiOptions {
	proxyUrl?: string;
}

export class TelegramHttpApi implements TelegramApi {
	private readonly baseUrl: string;
	private readonly dispatcher: Dispatcher | undefined;

	constructor(
		token: string,
		private readonly fetchImpl: TelegramFetch = undiciFetch as TelegramFetch,
		options: TelegramHttpApiOptions = {},
	) {
		this.baseUrl = `https://api.telegram.org/bot${token}`;
		this.dispatcher = options.proxyUrl ? new ProxyAgent(options.proxyUrl) : undefined;
	}

	private buildRequest(body: unknown): TelegramFetchInit {
		const request: TelegramFetchInit = {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		};
		if (this.dispatcher) {
			request.dispatcher = this.dispatcher;
		}
		return request;
	}

	async getMe(): Promise<{ id: number; username?: string; firstName?: string }> {
		const response = await this.fetchImpl(`${this.baseUrl}/getMe`, this.buildRequest({}));
		if (!response.ok) {
			throw new Error(`Telegram getMe failed: HTTP ${response.status}`);
		}
		const payload = (await response.json()) as TelegramGetMeResponse;
		if (!payload.ok || !payload.result) {
			throw new Error("Telegram getMe returned invalid payload");
		}
		return {
			id: payload.result.id,
			username: payload.result.username,
			firstName: payload.result.first_name,
		};
	}

	async getUpdates(
		offset: number,
		timeoutSeconds: number,
	): Promise<Array<{ updateId: number; chatId: number; text: string }>> {
		const response = await this.fetchImpl(
			`${this.baseUrl}/getUpdates`,
			this.buildRequest({ offset, timeout: timeoutSeconds }),
		);
		if (!response.ok) {
			throw new Error(`Telegram getUpdates failed: HTTP ${response.status}`);
		}
		const payload = (await response.json()) as TelegramGetUpdatesResponse;
		if (!payload.ok) {
			throw new Error("Telegram getUpdates returned ok=false");
		}

		const updates: Array<{ updateId: number; chatId: number; text: string }> = [];
		for (const update of payload.result) {
			const text = update.message?.text;
			const chatId = update.message?.chat?.id;
			if (typeof text !== "string" || typeof chatId !== "number") {
				continue;
			}
			updates.push({ updateId: update.update_id, chatId, text });
		}

		return updates;
	}

	async sendMessage(chatId: number, text: string): Promise<void> {
		const response = await this.fetchImpl(
			`${this.baseUrl}/sendMessage`,
			this.buildRequest({ chat_id: chatId, text }),
		);
		if (!response.ok) {
			throw new Error(`Telegram sendMessage failed: HTTP ${response.status}`);
		}
		const payload = (await response.json()) as TelegramSendMessageResponse;
		if (!payload.ok) {
			throw new Error("Telegram sendMessage returned ok=false");
		}
	}
}

function formatPollingError(error: unknown): string {
	if (!(error instanceof Error)) {
		return String(error);
	}
	const cause = error.cause;
	if (cause && typeof cause === "object") {
		const code = "code" in cause ? String(cause.code) : undefined;
		const message = "message" in cause ? String(cause.message) : undefined;
		if (code || message) {
			return `${error.message}${code || message ? ` (cause: ${[code, message].filter(Boolean).join(" - ")})` : ""}`;
		}
	}
	return error.message;
}

const MAX_TELEGRAM_MESSAGE_LENGTH = 3500;

function truncateMiddle(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}
	const left = Math.floor((maxLength - 3) / 2);
	const right = maxLength - 3 - left;
	return `${text.slice(0, left)}...${text.slice(text.length - right)}`;
}

function splitForTelegram(text: string): string[] {
	if (text.length <= MAX_TELEGRAM_MESSAGE_LENGTH) {
		return [text];
	}
	const chunks: string[] = [];
	let remaining = text;
	while (remaining.length > MAX_TELEGRAM_MESSAGE_LENGTH) {
		const candidate = remaining.slice(0, MAX_TELEGRAM_MESSAGE_LENGTH);
		const splitIndex = candidate.lastIndexOf("\n");
		if (splitIndex > 0) {
			chunks.push(remaining.slice(0, splitIndex));
			remaining = remaining.slice(splitIndex + 1);
			continue;
		}
		chunks.push(candidate);
		remaining = remaining.slice(MAX_TELEGRAM_MESSAGE_LENGTH);
	}
	if (remaining.length > 0) {
		chunks.push(remaining);
	}
	return chunks;
}

interface ChatModeStateItem {
	mode: "item";
	itemId: string;
	sessionId: string;
}

interface ChatModeStateGeneral {
	mode: "general";
	sessionId: string;
	history: Array<{ role: "user" | "assistant"; content: string }>;
}

type ChatModeState = ChatModeStateItem | ChatModeStateGeneral;

type ModeCommand =
	| { type: "open"; itemId?: string }
	| { type: "exit" }
	| { type: "where" }
	| { type: "sessions"; itemId: string }
	| { type: "resume"; sessionId: string }
	| { type: "history"; sessionId?: string };

function parseModeCommand(text: string): ModeCommand | null {
	const parts = text
		.trim()
		.split(/\s+/)
		.filter((part) => part.length > 0);
	if (parts[0] === "/open") {
		return { type: "open", itemId: parts[1] };
	}
	if (parts[0] === "/exit") {
		return { type: "exit" };
	}
	if (parts[0] === "/where") {
		return { type: "where" };
	}
	if (parts[0] === "/sessions" && parts[1]) {
		return { type: "sessions", itemId: parts[1] };
	}
	if (parts[0] === "/resume" && parts[1]) {
		return { type: "resume", sessionId: parts[1] };
	}
	if (parts[0] === "/history") {
		return { type: "history", sessionId: parts[1] };
	}
	return null;
}

function formatCommandResult(result: Awaited<ReturnType<SonderApp["processCommand"]>>): string {
	if (!result.ok) {
		return `Error (${result.error.code}): ${result.error.message}`;
	}

	if (result.value.type === "save") {
		const mode = result.value.usedFallback ? "fallback text mode" : "snapshot mode";
		const tags = result.value.tags.length > 0 ? `\nTags: ${result.value.tags.map((tag) => `#${tag}`).join(" ")}` : "";
		return (
			[
				"Saved item",
				`ID: ${result.value.itemId}`,
				`URL: ${result.value.url}`,
				`Capture: ${mode}`,
				`Artifacts: ${result.value.artifactIds.length}`,
			].join("\n") + tags
		);
	}

	if (result.value.type === "list") {
		if (result.value.items.length === 0) {
			return "No saved items yet. Use /save <url> first.";
		}
		const lines = result.value.items.map((item, index) => {
			const tags = item.tags.length > 0 ? ` ${item.tags.map((tag) => `#${tag}`).join(" ")}` : "";
			const url = truncateMiddle(item.originalUrl, 100);
			return `${index + 1}. ${item.id}\n   ${url}${tags}`;
		});
		return `Recent items (${result.value.items.length})\n\n${lines.join("\n\n")}`;
	}

	if (result.value.type === "annotate") {
		const tags =
			result.value.annotation.tags.length > 0
				? `\nTags: ${result.value.annotation.tags.map((tag) => `#${tag}`).join(" ")}`
				: "";
		return `Annotation saved\nID: ${result.value.annotation.id}\nItem: ${result.value.annotation.itemId}\nText: ${result.value.annotation.text ?? ""}${tags}`;
	}

	if (result.value.type === "ann-list") {
		if (result.value.annotations.length === 0) {
			return `No annotations for item ${result.value.itemId}.`;
		}
		const lines = result.value.annotations.map((annotation, index) => {
			const tags = annotation.tags.length > 0 ? ` ${annotation.tags.map((tag) => `#${tag}`).join(" ")}` : "";
			const preview = truncateMiddle(annotation.text ?? "(empty)", 120);
			return `${index + 1}. ${annotation.id}\n   ${preview}${tags}`;
		});
		return `Annotations for ${result.value.itemId} (${result.value.annotations.length})\n\n${lines.join("\n\n")}`;
	}

	if (result.value.type === "ann-del") {
		return `Annotation deleted\nID: ${result.value.annotationId}`;
	}

	const citations = result.value.citations.length > 0 ? `\n\nCitations: ${result.value.citations.join(" ")}` : "";
	return `Answer for ${result.value.itemId}\n\n${result.value.answer}${citations}`;
}

export class TelegramBotRunner {
	private offset = 0;
	private readonly longPollSeconds: number;
	private readonly idleDelayMs: number;
	private readonly stderr: Writable;
	private readonly getViewerItemUrl?: (itemId: string) => string;
	private readonly chatModes = new Map<number, ChatModeState>();
	private readonly chatModeStateRepo: ChatModeStateRepo;

	constructor(
		private readonly api: TelegramApi,
		private readonly app: SonderApp,
		options: TelegramRunnerOptions = {},
	) {
		this.longPollSeconds = options.longPollSeconds ?? 30;
		this.idleDelayMs = options.idleDelayMs ?? 250;
		this.stderr = options.stderr ?? process.stderr;
		this.getViewerItemUrl = options.getViewerItemUrl;
		this.chatModeStateRepo = new ChatModeStateRepo(this.app.database);
	}

	async pollOnce(): Promise<void> {
		const updates = await this.api.getUpdates(this.offset, this.longPollSeconds);
		for (const update of updates) {
			this.offset = Math.max(this.offset, update.updateId + 1);
			await this.handleMessage(update.chatId, update.text);
		}
	}

	async runForever(signal?: AbortSignal): Promise<void> {
		while (!signal?.aborted) {
			try {
				await this.pollOnce();
			} catch (error) {
				this.stderr.write(`[telegram] polling error: ${formatPollingError(error)}\n`);
			}
			await sleep(this.idleDelayMs, signal);
		}
	}

	private getChatMode(chatId: number): ChatModeState | undefined {
		const memoryMode = this.chatModes.get(chatId);
		if (memoryMode) {
			return memoryMode;
		}

		const stored = this.chatModeStateRepo.findByChatId(chatId);
		if (!stored) {
			return undefined;
		}

		const restored: ChatModeState =
			stored.mode === "item"
				? { mode: "item", itemId: stored.itemId, sessionId: stored.sessionId }
				: { mode: "general", sessionId: stored.sessionId, history: stored.history };
		this.chatModes.set(chatId, restored);
		return restored;
	}

	private setChatMode(chatId: number, mode: ChatModeState): void {
		this.chatModes.set(chatId, mode);
		if (mode.mode === "item") {
			this.chatModeStateRepo.upsert(
				{ chatId, mode: "item", itemId: mode.itemId, sessionId: mode.sessionId, history: [] },
				new Date().toISOString(),
			);
			return;
		}
		this.chatModeStateRepo.upsert(
			{ chatId, mode: "general", itemId: null, sessionId: mode.sessionId, history: mode.history },
			new Date().toISOString(),
		);
	}

	private clearChatMode(chatId: number): boolean {
		const existed = this.chatModes.delete(chatId);
		const existedInDb = this.chatModeStateRepo.deleteByChatId(chatId);
		return existed || existedInDb;
	}

	private async handleMessage(chatId: number, text: string): Promise<void> {
		try {
			const modeCommand = parseModeCommand(text);
			if (modeCommand) {
				await this.handleModeCommand(chatId, modeCommand);
				return;
			}

			if (!text.startsWith("/")) {
				const activeMode = this.getChatMode(chatId);
				if (!activeMode) {
					await this.api.sendMessage(
						chatId,
						"No active dialogue. Use /open <itemId> to discuss an item, or /open for general chat. Use /history <sessionId> to view past turns.",
					);
					return;
				}

				if (activeMode.mode === "item") {
					const askResult = await this.app.askInItemDialogue(activeMode.itemId, activeMode.sessionId, text);
					for (const chunk of splitForTelegram(`Answer for ${askResult.itemId}\n\n${askResult.answer}`)) {
						await this.api.sendMessage(chatId, chunk);
					}
					return;
				}

				const response = await this.app.chatWithoutItem(activeMode.sessionId, text, activeMode.history);
				activeMode.history.push({ role: "user", content: text });
				activeMode.history.push({ role: "assistant", content: response.answer });
				this.setChatMode(chatId, activeMode);
				for (const chunk of splitForTelegram(response.answer)) {
					await this.api.sendMessage(chatId, chunk);
				}
				return;
			}

			const result = await this.app.processCommand(text);
			const responseText = formatCommandResult(result);
			for (const chunk of splitForTelegram(responseText)) {
				await this.api.sendMessage(chatId, chunk);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.api.sendMessage(chatId, `Error (RUNTIME_ERROR): ${message}`);
		}
	}

	private async handleModeCommand(chatId: number, command: ModeCommand): Promise<void> {
		if (command.type === "open") {
			if (!command.itemId) {
				const sessionId = randomUUID();
				this.setChatMode(chatId, {
					mode: "general",
					sessionId,
					history: [],
				});
				await this.api.sendMessage(
					chatId,
					`Opened general dialogue mode. Session: ${sessionId}. Send messages directly, /exit to leave.`,
				);
				return;
			}

			const opened = this.app.openItemDialogue(command.itemId);
			this.setChatMode(chatId, {
				mode: "item",
				itemId: opened.itemId,
				sessionId: opened.sessionId,
			});
			const viewerLine = this.getViewerItemUrl ? `\nViewer: ${this.getViewerItemUrl(opened.itemId)}` : "";
			await this.api.sendMessage(
				chatId,
				`Opened item dialogue\nItem: ${opened.itemId}\nSession: ${opened.sessionId}${viewerLine}\nSend messages directly. /exit to leave.`,
			);
			return;
		}

		if (command.type === "exit") {
			const existed = this.clearChatMode(chatId);
			await this.api.sendMessage(chatId, existed ? "Exited active dialogue mode." : "No active dialogue mode.");
			return;
		}

		if (command.type === "where") {
			const mode = this.getChatMode(chatId);
			if (!mode) {
				await this.api.sendMessage(chatId, "No active dialogue mode.");
				return;
			}
			if (mode.mode === "item") {
				await this.api.sendMessage(
					chatId,
					`Active item dialogue\nItem: ${mode.itemId}\nSession: ${mode.sessionId}`,
				);
				return;
			}
			await this.api.sendMessage(chatId, `Active general dialogue\nSession: ${mode.sessionId}`);
			return;
		}

		if (command.type === "sessions") {
			const sessions = this.app.listItemDialogues(command.itemId);
			if (sessions.length === 0) {
				await this.api.sendMessage(chatId, `No sessions for item ${command.itemId}.`);
				return;
			}
			const lines = sessions.map((session, index) => `${index + 1}. ${session.sessionId} (${session.createdAt})`);
			await this.api.sendMessage(chatId, `Sessions for ${command.itemId}\n\n${lines.join("\n")}`);
			return;
		}

		if (command.type === "history") {
			if (command.sessionId) {
				const turns = this.app.listDialogueHistory(command.sessionId, 20);
				if (turns.length === 0) {
					await this.api.sendMessage(chatId, `No turns in session ${command.sessionId}.`);
					return;
				}
				const lines = turns.map((turn) => `${turn.role}: ${truncateMiddle(turn.content, 280)}`);
				for (const chunk of splitForTelegram(`History for ${command.sessionId}\n\n${lines.join("\n\n")}`)) {
					await this.api.sendMessage(chatId, chunk);
				}
				return;
			}

			const mode = this.getChatMode(chatId);
			if (!mode) {
				await this.api.sendMessage(chatId, "No active dialogue mode and no sessionId provided.");
				return;
			}
			if (mode.mode === "general") {
				if (mode.history.length === 0) {
					await this.api.sendMessage(chatId, `General history is empty for session ${mode.sessionId}.`);
					return;
				}
				const lines = mode.history.map((turn) => `${turn.role}: ${truncateMiddle(turn.content, 280)}`);
				for (const chunk of splitForTelegram(`History for ${mode.sessionId}\n\n${lines.join("\n\n")}`)) {
					await this.api.sendMessage(chatId, chunk);
				}
				return;
			}

			const turns = this.app.listDialogueHistory(mode.sessionId, 20);
			if (turns.length === 0) {
				await this.api.sendMessage(chatId, `No turns in session ${mode.sessionId}.`);
				return;
			}
			const lines = turns.map((turn) => `${turn.role}: ${truncateMiddle(turn.content, 280)}`);
			for (const chunk of splitForTelegram(`History for ${mode.sessionId}\n\n${lines.join("\n\n")}`)) {
				await this.api.sendMessage(chatId, chunk);
			}
			return;
		}

		const resumed = this.app.resumeItemDialogue(command.sessionId);
		this.setChatMode(chatId, {
			mode: "item",
			itemId: resumed.itemId,
			sessionId: resumed.sessionId,
		});
		await this.api.sendMessage(
			chatId,
			`Resumed item dialogue\nItem: ${resumed.itemId}\nSession: ${resumed.sessionId}`,
		);
	}
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Aborted"));
			return;
		}
		const timeout = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(timeout);
			reject(new Error("Aborted"));
		});
	});
}
