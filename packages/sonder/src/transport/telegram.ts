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
		callback_query?: {
			id?: string;
			data?: string;
			message?: {
				chat?: { id?: number };
			};
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

export interface TelegramInlineButton {
	text: string;
	callbackData: string;
}

export type TelegramInlineKeyboard = TelegramInlineButton[][];

export interface TelegramSendMessageOptions {
	inlineKeyboard?: TelegramInlineKeyboard;
}

export type TelegramUpdate =
	| {
			updateId: number;
			type: "message";
			chatId: number;
			text: string;
	  }
	| {
			updateId: number;
			type: "callback";
			chatId: number;
			callbackQueryId: string;
			data: string;
	  };

export interface TelegramApi {
	getMe(): Promise<{ id: number; username?: string; firstName?: string }>;
	getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]>;
	sendMessage(chatId: number, text: string, options?: TelegramSendMessageOptions): Promise<void>;
	answerCallbackQuery(callbackQueryId: string): Promise<void>;
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

	async getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]> {
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

		const updates: TelegramUpdate[] = [];
		for (const update of payload.result) {
			const text = update.message?.text;
			const chatId = update.message?.chat?.id;
			if (typeof text === "string" && typeof chatId === "number") {
				updates.push({ updateId: update.update_id, type: "message", chatId, text });
				continue;
			}

			const callbackId = update.callback_query?.id;
			const callbackData = update.callback_query?.data;
			const callbackChatId = update.callback_query?.message?.chat?.id;
			if (typeof callbackId === "string" && typeof callbackData === "string" && typeof callbackChatId === "number") {
				updates.push({
					updateId: update.update_id,
					type: "callback",
					chatId: callbackChatId,
					callbackQueryId: callbackId,
					data: callbackData,
				});
			}
		}

		return updates;
	}

	async sendMessage(chatId: number, text: string, options?: TelegramSendMessageOptions): Promise<void> {
		const inlineKeyboard = options?.inlineKeyboard?.map((row) =>
			row.map((button) => ({ text: button.text, callback_data: button.callbackData })),
		);
		const response = await this.fetchImpl(
			`${this.baseUrl}/sendMessage`,
			this.buildRequest({
				chat_id: chatId,
				text,
				reply_markup: inlineKeyboard ? { inline_keyboard: inlineKeyboard } : undefined,
			}),
		);
		if (!response.ok) {
			throw new Error(`Telegram sendMessage failed: HTTP ${response.status}`);
		}
		const payload = (await response.json()) as TelegramSendMessageResponse;
		if (!payload.ok) {
			throw new Error("Telegram sendMessage returned ok=false");
		}
	}

	async answerCallbackQuery(callbackQueryId: string): Promise<void> {
		const response = await this.fetchImpl(
			`${this.baseUrl}/answerCallbackQuery`,
			this.buildRequest({ callback_query_id: callbackQueryId }),
		);
		if (!response.ok) {
			throw new Error(`Telegram answerCallbackQuery failed: HTTP ${response.status}`);
		}
		const payload = (await response.json()) as TelegramSendMessageResponse;
		if (!payload.ok) {
			throw new Error("Telegram answerCallbackQuery returned ok=false");
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

const FIND_MENU_TTL_MS = 15 * 60 * 1000;

type MenuKind = "find" | "list";

interface ItemMenuState {
	kind: MenuKind;
	itemIds: string[];
	createdAtMs: number;
	expiresAtMs: number;
}

type CallbackAction = "find_open" | "list_open" | "ctx_exit" | "ctx_viewer";

interface CallbackPayload {
	version: "v1";
	action: CallbackAction;
	menuId: string;
	argument: string;
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

function parseCallbackPayload(data: string): CallbackPayload | null {
	const parts = data.split(":");
	if (parts.length !== 5) {
		return null;
	}
	if (parts[0] !== "sx" || parts[1] !== "v1") {
		return null;
	}
	const action = parts[2];
	if (action !== "find_open" && action !== "list_open" && action !== "ctx_exit" && action !== "ctx_viewer") {
		return null;
	}
	return {
		version: "v1",
		action,
		menuId: parts[3],
		argument: parts[4],
	};
}

function buildCallbackPayload(action: CallbackAction, menuId: string, argument: number): string {
	return `sx:v1:${action}:${menuId}:${argument}`;
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
			return `${index + 1}. ${url}${tags}`;
		});
		return `🗂 Recent items (${result.value.items.length})\n\n${lines.join("\n\n")}`;
	}

	if (result.value.type === "find") {
		if (result.value.items.length === 0) {
			return `No items matched: ${result.value.query}`;
		}
		const lines = result.value.items.map((item, index) => {
			const tags = item.tags.length > 0 ? ` ${item.tags.map((tag) => `#${tag}`).join(" ")}` : "";
			return `${index + 1}. ${truncateMiddle(item.originalUrl, 100)}${tags}\n   reasons: ${item.reasons.join(", ")}`;
		});
		return `🔎 Found ${result.value.items.length} results for: ${result.value.query}\n\n${lines.join("\n\n")}`;
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
	private readonly itemMenus = new Map<number, Map<string, ItemMenuState>>();

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
			if (update.type === "message") {
				await this.handleMessage(update.chatId, update.text);
				continue;
			}
			await this.handleCallback(update.chatId, update.callbackQueryId, update.data);
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

	private createItemMenu(chatId: number, kind: MenuKind, itemIds: string[]): string {
		const chatMenus = this.itemMenus.get(chatId) ?? new Map<string, ItemMenuState>();
		const createdAtMs = Date.now();
		const menuId = randomUUID().slice(0, 8);
		chatMenus.set(menuId, {
			kind,
			itemIds,
			createdAtMs,
			expiresAtMs: createdAtMs + FIND_MENU_TTL_MS,
		});
		this.itemMenus.set(chatId, chatMenus);
		return menuId;
	}

	private getItemMenu(chatId: number, menuId: string): ItemMenuState | null {
		const chatMenus = this.itemMenus.get(chatId);
		if (!chatMenus) {
			return null;
		}
		const menu = chatMenus.get(menuId);
		if (!menu) {
			return null;
		}
		if (Date.now() > menu.expiresAtMs) {
			chatMenus.delete(menuId);
			return null;
		}
		return menu;
	}

	private getMenuItemId(menu: ItemMenuState, argument: string): string | null {
		const index = Number.parseInt(argument, 10);
		if (!Number.isFinite(index) || index <= 0) {
			return null;
		}
		return menu.itemIds[index - 1] ?? null;
	}

	private buildItemModeKeyboard(includeViewer: boolean): TelegramInlineKeyboard {
		const row = includeViewer
			? [
					{ text: "Open Viewer", callbackData: buildCallbackPayload("ctx_viewer", "ctx", 0) },
					{ text: "Exit", callbackData: buildCallbackPayload("ctx_exit", "ctx", 0) },
				]
			: [{ text: "Exit", callbackData: buildCallbackPayload("ctx_exit", "ctx", 0) }];
		return [row];
	}

	private async sendItemModeOpenedMessage(
		chatId: number,
		header: string,
		itemId: string,
		sessionId: string,
	): Promise<void> {
		const viewerUrl = this.getViewerItemUrl ? this.getViewerItemUrl(itemId) : null;
		const viewerLine = viewerUrl ? `\nViewer: ${viewerUrl}` : "";
		const turns = this.app.listDialogueHistory(sessionId, 200).length;
		const sessions = this.app.listItemDialogues(itemId);
		const sessionsCount = sessions.length;
		const recentAt = sessions.map((session) => session.createdAt).sort((left, right) => right.localeCompare(left))[0];
		const recentLine = recentAt ? `\nRecent activity: ${recentAt}` : "";
		const summary = `\nSession: active • ${turns} turns\nRecent sessions: ${sessionsCount}${recentLine}`;
		await this.api.sendMessage(chatId, `${header}${summary}${viewerLine}\nSend messages directly. /exit to leave.`, {
			inlineKeyboard: this.buildItemModeKeyboard(Boolean(viewerUrl)),
		});
	}

	private formatContextualAnswer(chatId: number, answer: string, itemId?: string): string {
		const mode = this.getChatMode(chatId);
		if (!mode) {
			return answer;
		}
		if (mode.mode === "item") {
			const label = itemId ?? mode.itemId;
			return `────────────\n🧠 In: ${label}\n────────────\n\n${answer}`;
		}
		return `────────────\n💬 In: General Chat\n────────────\n\n${answer}`;
	}

	private async handleContextAction(chatId: number, action: CallbackAction): Promise<void> {
		const mode = this.getChatMode(chatId);
		if (!mode) {
			await this.api.sendMessage(chatId, "No active context. Use /find or /list, then open an item.");
			return;
		}

		if (action === "ctx_exit") {
			this.clearChatMode(chatId);
			await this.api.sendMessage(chatId, "Exited active dialogue mode.");
			return;
		}

		if (action === "ctx_viewer") {
			if (mode.mode !== "item") {
				await this.api.sendMessage(chatId, "Viewer is available in item mode only.");
				return;
			}
			if (!this.getViewerItemUrl) {
				await this.api.sendMessage(chatId, "Viewer is not enabled for this run.");
				return;
			}
			await this.api.sendMessage(chatId, this.getViewerItemUrl(mode.itemId));
		}
	}

	private async handleCallback(chatId: number, callbackQueryId: string, data: string): Promise<void> {
		try {
			const payload = parseCallbackPayload(data);
			if (!payload) {
				await this.api.sendMessage(chatId, "Unsupported action. Use /open or /find again.");
				return;
			}
			if (payload.action.startsWith("ctx_")) {
				await this.handleContextAction(chatId, payload.action);
				return;
			}

			const menu = this.getItemMenu(chatId, payload.menuId);
			if (!menu) {
				await this.api.sendMessage(chatId, "This menu expired. Use /open or /find again.");
				return;
			}
			const expectedKind: MenuKind = payload.action.startsWith("list_") ? "list" : "find";
			if (menu.kind !== expectedKind) {
				await this.api.sendMessage(
					chatId,
					"This menu action is no longer valid. Use /open, /list, or /find again.",
				);
				return;
			}
			const itemId = this.getMenuItemId(menu, payload.argument);
			if (!itemId) {
				await this.api.sendMessage(chatId, "Invalid selection. Use /list or /find again.");
				return;
			}

			const opened = this.app.openItemDialogue(itemId);
			this.setChatMode(chatId, {
				mode: "item",
				itemId: opened.itemId,
				sessionId: opened.sessionId,
			});

			const prompt = `🧠 Item mode opened from result #${payload.argument}.`;
			await this.sendItemModeOpenedMessage(chatId, prompt, opened.itemId, opened.sessionId);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.api.sendMessage(chatId, `Error (RUNTIME_ERROR): ${message}`);
		} finally {
			try {
				await this.api.answerCallbackQuery(callbackQueryId);
			} catch {
				// Best-effort ack; avoid failing flow on callback ack issues.
			}
		}
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
					const formatted = this.formatContextualAnswer(chatId, askResult.answer, askResult.itemId);
					for (const chunk of splitForTelegram(formatted)) {
						await this.api.sendMessage(chatId, chunk);
					}
					return;
				}

				const response = await this.app.chatWithoutItem(activeMode.sessionId, text, activeMode.history);
				activeMode.history.push({ role: "user", content: text });
				activeMode.history.push({ role: "assistant", content: response.answer });
				this.setChatMode(chatId, activeMode);
				const formatted = this.formatContextualAnswer(chatId, response.answer);
				for (const chunk of splitForTelegram(formatted)) {
					await this.api.sendMessage(chatId, chunk);
				}
				return;
			}

			if (text.startsWith("/ask")) {
				await this.api.sendMessage(
					chatId,
					"In Telegram, /ask is deprecated. Use /find or /list, tap Open, then ask in plain text.",
				);
				return;
			}

			const result = await this.app.processCommand(text);
			if (result.ok && result.value.type === "save") {
				const responseText = formatCommandResult(result);
				await this.api.sendMessage(chatId, responseText);
				const opened = this.app.openItemDialogue(result.value.itemId);
				this.setChatMode(chatId, {
					mode: "item",
					itemId: opened.itemId,
					sessionId: opened.sessionId,
				});
				await this.sendItemModeOpenedMessage(
					chatId,
					"🧠 Item mode opened for saved item.",
					opened.itemId,
					opened.sessionId,
				);
				return;
			}
			if (
				result.ok &&
				(result.value.type === "find" || result.value.type === "list") &&
				result.value.items.length > 0
			) {
				const menuKind: MenuKind = result.value.type;
				const menuId = this.createItemMenu(
					chatId,
					menuKind,
					result.value.items.map((item) => item.id),
				);
				const responseText = formatCommandResult(result);
				const actionOpen: CallbackAction = menuKind === "find" ? "find_open" : "list_open";
				const inlineKeyboard: TelegramInlineKeyboard = result.value.items.map((_, index) => [
					{
						text: `${index + 1} Open`,
						callbackData: buildCallbackPayload(actionOpen, menuId, index + 1),
					},
				]);
				await this.api.sendMessage(chatId, responseText, { inlineKeyboard });
				return;
			}
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
			await this.sendItemModeOpenedMessage(chatId, "🧠 Item mode opened.", opened.itemId, opened.sessionId);
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
		await this.sendItemModeOpenedMessage(chatId, "🧠 Item dialogue resumed.", resumed.itemId, resumed.sessionId);
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
