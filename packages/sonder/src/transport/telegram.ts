import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import { type Dispatcher, ProxyAgent, fetch as undiciFetch } from "undici";
import type { SonderApp, SonderCommandResult } from "../app/index.js";
import type { ParsedTelegramModeCommand } from "../commands/parse-mode-command.js";
import { parseTelegramModeCommand } from "../commands/parse-mode-command.js";
import { handleActiveModeMessage } from "./telegram-active-mode-message-handler.js";
import { buildCallbackPayload } from "./telegram-callback.js";
import { routeTelegramCallback } from "./telegram-callback-router.js";
import {
	formatSortFilter,
	formatSourceFilter,
	formatTimeFilter,
	parseSortFilter,
	parseSourceFilter,
	parseTagPage,
	parseTimeFilter,
	type SortFilter,
	type SourceFilter,
	type TimeFilter,
} from "./telegram-discovery-filters.js";
import { extractUrlAndPastedText } from "./telegram-input.js";
import { handleModeCommand as handleModeCommandCore } from "./telegram-mode-command-handler.js";
import { type ChatModeState, TelegramChatModeStore } from "./telegram-mode-store.js";
import { handlePlainMessage } from "./telegram-plain-message-handler.js";
import { formatCommandResult, formatPollingError, splitForTelegram, truncateMiddle } from "./telegram-renderers.js";
import { handleSlashMessage } from "./telegram-slash-command-handler.js";

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

export interface TelegramBotCommand {
	command: string;
	description: string;
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

export interface TelegramRuntimeModelSelector {
	listModels: () => Array<{ id: string }>;
	getSelectedModelId: () => string;
	setSelectedModelId: (modelId: string) => boolean;
}

export interface TelegramRunnerOptions {
	longPollSeconds?: number;
	idleDelayMs?: number;
	stderr?: Writable;
	getViewerItemUrl?: (itemId: string) => string;
	modelSelector?: TelegramRuntimeModelSelector | null;
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

	async setMyCommands(commands: TelegramBotCommand[]): Promise<void> {
		const response = await this.fetchImpl(
			`${this.baseUrl}/setMyCommands`,
			this.buildRequest({
				commands: commands.map((command) => ({ command: command.command, description: command.description })),
			}),
		);
		if (!response.ok) {
			throw new Error(`Telegram setMyCommands failed: HTTP ${response.status}`);
		}
		const payload = (await response.json()) as TelegramSendMessageResponse;
		if (!payload.ok) {
			throw new Error("Telegram setMyCommands returned ok=false");
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

const FIND_MENU_TTL_MS = 15 * 60 * 1000;
const DISPLAY_TIME_ZONE = "Asia/Shanghai";
const DISPLAY_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
	timeZone: DISPLAY_TIME_ZONE,
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
});

function formatDisplayTime(timestamp: string): string {
	const parsed = Date.parse(timestamp);
	if (!Number.isFinite(parsed)) {
		return timestamp;
	}
	return `${DISPLAY_TIME_FORMATTER.format(parsed)} (UTC+8)`;
}

type MenuKind = "find" | "list";

interface ItemMenuEntry {
	id: string;
	createdAt: string;
	sourceType: string;
	originalUrl: string;
	tags: string[];
	reasons: string[];
	snippets: string[];
}

interface ItemMenuState {
	kind: MenuKind;
	query: string | null;
	entries: ItemMenuEntry[];
	page: number;
	pageSize: number;
	time: TimeFilter;
	source: SourceFilter;
	tag: string | null;
	sort: SortFilter;
	tagPage: number;
	createdAtMs: number;
	expiresAtMs: number;
}

interface SessionMenuState {
	itemId: string;
	sessionIds: string[];
	createdAtMs: number;
	expiresAtMs: number;
}

interface ModelMenuState {
	modelIds: string[];
	createdAtMs: number;
	expiresAtMs: number;
}

interface HistoryMenuState {
	sessionId: string;
	page: number;
	pageSize: number;
	createdAtMs: number;
	expiresAtMs: number;
}

type SaveCommandResult = Extract<SonderCommandResult, { type: "save" }>;

export class TelegramBotRunner {
	private offset = 0;
	private readonly longPollSeconds: number;
	private readonly idleDelayMs: number;
	private readonly stderr: Writable;
	private readonly getViewerItemUrl?: (itemId: string) => string;
	private readonly modelSelector: TelegramRuntimeModelSelector | null;
	private readonly chatModeStore: TelegramChatModeStore;
	private readonly itemMenus = new Map<number, Map<string, ItemMenuState>>();
	private readonly sessionMenus = new Map<number, Map<string, SessionMenuState>>();
	private readonly modelMenus = new Map<number, Map<string, ModelMenuState>>();
	private readonly historyMenus = new Map<number, Map<string, HistoryMenuState>>();
	private readonly pendingSaveChats = new Set<number>();

	constructor(
		private readonly api: TelegramApi,
		private readonly app: SonderApp,
		options: TelegramRunnerOptions = {},
	) {
		this.longPollSeconds = options.longPollSeconds ?? 30;
		this.idleDelayMs = options.idleDelayMs ?? 250;
		this.stderr = options.stderr ?? process.stderr;
		this.getViewerItemUrl = options.getViewerItemUrl;
		this.modelSelector = options.modelSelector ?? null;
		this.chatModeStore = new TelegramChatModeStore(this.app);
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
		return this.chatModeStore.get(chatId);
	}

	private setChatMode(chatId: number, mode: ChatModeState): void {
		this.chatModeStore.set(chatId, mode);
	}

	private clearChatMode(chatId: number): boolean {
		return this.chatModeStore.clear(chatId);
	}

	private markSaveInputPending(chatId: number): void {
		this.pendingSaveChats.add(chatId);
	}

	private clearPendingSaveInput(chatId: number): void {
		this.pendingSaveChats.delete(chatId);
	}

	private hasPendingSaveInput(chatId: number): boolean {
		return this.pendingSaveChats.has(chatId);
	}

	private async sendSaveResultAndMaybeOpenItemMode(chatId: number, saveResult: SaveCommandResult): Promise<void> {
		const responseText = formatCommandResult({ ok: true, value: saveResult });
		await this.api.sendMessage(chatId, responseText);
		if (saveResult.needsUserEvidence) {
			return;
		}
		const opened = this.app.openItemDialogue(saveResult.itemId);
		this.setChatMode(chatId, {
			mode: "item",
			itemId: opened.itemId,
			sessionId: opened.sessionId,
		});
		await this.sendItemModeOpenedMessage(
			chatId,
			saveResult.evidenceType === "pasted_text"
				? "🧠 Item mode opened with pasted-text evidence."
				: "🧠 Item mode opened for saved item.",
			opened.itemId,
			opened.sessionId,
		);
	}

	private createItemMenu(chatId: number, kind: MenuKind, entries: ItemMenuEntry[], query: string | null): string {
		const chatMenus = this.itemMenus.get(chatId) ?? new Map<string, ItemMenuState>();
		const createdAtMs = Date.now();
		const menuId = randomUUID().slice(0, 8);
		chatMenus.set(menuId, {
			kind,
			query,
			entries,
			page: 0,
			pageSize: 5,
			time: "all",
			source: "any",
			tag: null,
			sort: "newest",
			tagPage: 0,
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

	private applyItemMenuFilters(menu: ItemMenuState): ItemMenuEntry[] {
		const now = Date.now();
		let filtered = menu.entries.filter((entry) => {
			if (menu.source !== "any" && entry.sourceType !== menu.source) {
				return false;
			}
			if (menu.tag && !entry.tags.includes(menu.tag)) {
				return false;
			}
			if (menu.time !== "all") {
				const createdAtMs = Date.parse(entry.createdAt);
				const maxAgeMs =
					menu.time === "today"
						? 24 * 60 * 60 * 1000
						: menu.time === "7d"
							? 7 * 24 * 60 * 60 * 1000
							: menu.time === "30d"
								? 30 * 24 * 60 * 60 * 1000
								: 365 * 24 * 60 * 60 * 1000;
				if (!Number.isFinite(createdAtMs) || now - createdAtMs > maxAgeMs) {
					return false;
				}
			}
			return true;
		});

		filtered = [...filtered].sort((left, right) => {
			return menu.sort === "newest"
				? right.createdAt.localeCompare(left.createdAt)
				: left.createdAt.localeCompare(right.createdAt);
		});
		return filtered;
	}

	private pagedMenuEntries(menu: ItemMenuState): {
		items: ItemMenuEntry[];
		total: number;
		page: number;
		totalPages: number;
	} {
		const filtered = this.applyItemMenuFilters(menu);
		const total = filtered.length;
		const totalPages = Math.max(1, Math.ceil(total / menu.pageSize));
		const page = Math.max(0, Math.min(menu.page, totalPages - 1));
		const start = page * menu.pageSize;
		return {
			items: filtered.slice(start, start + menu.pageSize),
			total,
			page,
			totalPages,
		};
	}

	private getMenuItemId(menu: ItemMenuState, argument: string): string | null {
		const index = Number.parseInt(argument, 10);
		if (!Number.isFinite(index) || index <= 0) {
			return null;
		}
		const paged = this.pagedMenuEntries(menu);
		return paged.items[index - 1]?.id ?? null;
	}

	private buildDiscoveryMenuText(menu: ItemMenuState): string {
		const paged = this.pagedMenuEntries(menu);
		if (paged.items.length === 0) {
			const title = menu.kind === "find" ? `🔎 Find: ${menu.query ?? ""}` : "🗂 Recent items";
			return `${title}\n\nNo results match current filters.`;
		}
		const title = menu.kind === "find" ? `🔎 Find: ${menu.query ?? ""}` : "🗂 Recent items";
		const rows = paged.items.map((entry, index) => {
			const tags = entry.tags.length > 0 ? ` ${entry.tags.map((tag) => `#${tag}`).join(" ")}` : "";
			const reasonLine =
				menu.kind === "find" && entry.reasons.length > 0 ? `\n   reasons: ${entry.reasons.join(", ")}` : "";
			const snippetLine =
				menu.kind === "find" && entry.snippets.length > 0
					? `\n   match: ${truncateMiddle(entry.snippets[0], 120)}`
					: "";
			return `${index + 1}. ${truncateMiddle(entry.originalUrl, 96)}${tags}\n   ${entry.sourceType} · ${formatDisplayTime(entry.createdAt)}${reasonLine}${snippetLine}`;
		});
		const filterSummary = `Filters: Time=${formatTimeFilter(menu.time)} | Source=${formatSourceFilter(menu.source)} | Tag=${menu.tag ?? "Any"} | Sort=${formatSortFilter(menu.sort)}`;
		return `${title} (${paged.total}) [page ${paged.page + 1}/${paged.totalPages}]\n${filterSummary}\n\n${rows.join("\n\n")}`;
	}

	private buildDiscoveryMenuKeyboard(menuId: string, menu: ItemMenuState): TelegramInlineKeyboard {
		const paged = this.pagedMenuEntries(menu);
		const itemRows: TelegramInlineKeyboard = paged.items.map((_, index) => [
			{
				text: `${index + 1} Open`,
				callbackData: buildCallbackPayload(menu.kind === "find" ? "find_open" : "list_open", menuId, index + 1),
			},
			{
				text: `${index + 1} Delete`,
				callbackData: buildCallbackPayload(menu.kind === "find" ? "find_del" : "list_del", menuId, index + 1),
			},
		]);
		const tagLabel = menu.tag ? `Tag:${menu.tag}` : "Tag:Any";
		return [
			...itemRows,
			[
				{
					text: `Time:${formatTimeFilter(menu.time)}`,
					callbackData: buildCallbackPayload("menu_time", menuId, 0),
				},
				{
					text: `Source:${formatSourceFilter(menu.source)}`,
					callbackData: buildCallbackPayload("menu_source", menuId, 0),
				},
			],
			[
				{ text: tagLabel, callbackData: buildCallbackPayload("menu_tag", menuId, 0) },
				{
					text: `Sort:${formatSortFilter(menu.sort)}`,
					callbackData: buildCallbackPayload("menu_sort", menuId, 0),
				},
			],
			[
				{ text: "Clear", callbackData: buildCallbackPayload("menu_clear", menuId, 0) },
				{ text: "Prev", callbackData: buildCallbackPayload("menu_prev", menuId, 0) },
				{ text: "Next", callbackData: buildCallbackPayload("menu_next", menuId, 0) },
			],
		];
	}

	private buildTimeMenuKeyboard(menuId: string): TelegramInlineKeyboard {
		return [
			[
				{ text: "Today", callbackData: buildCallbackPayload("menu_time_set", menuId, 1) },
				{ text: "Last 7d", callbackData: buildCallbackPayload("menu_time_set", menuId, 2) },
			],
			[
				{ text: "30d", callbackData: buildCallbackPayload("menu_time_set", menuId, 3) },
				{ text: "This year", callbackData: buildCallbackPayload("menu_time_set", menuId, 4) },
			],
			[
				{ text: "All", callbackData: buildCallbackPayload("menu_time_set", menuId, 0) },
				{ text: "Back", callbackData: buildCallbackPayload("menu_back", menuId, 0) },
			],
		];
	}

	private buildSourceMenuKeyboard(menuId: string): TelegramInlineKeyboard {
		return [
			[
				{ text: "Any", callbackData: buildCallbackPayload("menu_source_set", menuId, 0) },
				{ text: "Web", callbackData: buildCallbackPayload("menu_source_set", menuId, 1) },
			],
			[{ text: "Back", callbackData: buildCallbackPayload("menu_back", menuId, 0) }],
		];
	}

	private buildSortMenuKeyboard(menuId: string): TelegramInlineKeyboard {
		return [
			[
				{ text: "Newest", callbackData: buildCallbackPayload("menu_sort_set", menuId, 0) },
				{ text: "Oldest", callbackData: buildCallbackPayload("menu_sort_set", menuId, 1) },
			],
			[{ text: "Back", callbackData: buildCallbackPayload("menu_back", menuId, 0) }],
		];
	}

	private collectMenuTags(menu: ItemMenuState): string[] {
		return Array.from(new Set(menu.entries.flatMap((entry) => entry.tags))).sort();
	}

	private buildTagMenuKeyboard(menuId: string, menu: ItemMenuState): TelegramInlineKeyboard {
		const tags = this.collectMenuTags(menu);
		if (tags.length === 0) {
			return [[{ text: "Back", callbackData: buildCallbackPayload("menu_back", menuId, 0) }]];
		}
		const pageSize = 6;
		const totalPages = Math.max(1, Math.ceil(tags.length / pageSize));
		const safePage = Math.max(0, Math.min(menu.tagPage, totalPages - 1));
		const start = safePage * pageSize;
		const pageTags = tags.slice(start, start + pageSize);
		const tagRows = pageTags.map((tag, index) => [
			{
				text: tag,
				callbackData: buildCallbackPayload("menu_tag_set", menuId, start + index + 1),
			},
		]);
		const navRow: TelegramInlineButton[] = [];
		if (totalPages > 1) {
			navRow.push({ text: "Prev", callbackData: buildCallbackPayload("menu_tag_page", menuId, safePage - 1) });
			navRow.push({
				text: `${safePage + 1}/${totalPages}`,
				callbackData: buildCallbackPayload("menu_tag_page", menuId, safePage),
			});
			navRow.push({ text: "Next", callbackData: buildCallbackPayload("menu_tag_page", menuId, safePage + 1) });
		}
		const controls: TelegramInlineButton[] = [
			{ text: "Any", callbackData: buildCallbackPayload("menu_tag_set", menuId, 0) },
			{ text: "Back", callbackData: buildCallbackPayload("menu_back", menuId, 0) },
		];
		return navRow.length > 0 ? [...tagRows, navRow, controls] : [...tagRows, controls];
	}

	private parseTagSelection(menu: ItemMenuState, argument: string): string | null {
		const index = Number.parseInt(argument, 10);
		if (!Number.isFinite(index) || index <= 0) {
			return null;
		}
		const tags = this.collectMenuTags(menu);
		return tags[index - 1] ?? null;
	}

	private createSessionMenu(chatId: number, itemId: string, sessionIds: string[]): string {
		const chatMenus = this.sessionMenus.get(chatId) ?? new Map<string, SessionMenuState>();
		const createdAtMs = Date.now();
		const menuId = randomUUID().slice(0, 8);
		chatMenus.set(menuId, {
			itemId,
			sessionIds,
			createdAtMs,
			expiresAtMs: createdAtMs + FIND_MENU_TTL_MS,
		});
		this.sessionMenus.set(chatId, chatMenus);
		return menuId;
	}

	private getSessionMenu(chatId: number, menuId: string): SessionMenuState | null {
		const chatMenus = this.sessionMenus.get(chatId);
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

	private createModelMenu(chatId: number, modelIds: string[]): string {
		const chatMenus = this.modelMenus.get(chatId) ?? new Map<string, ModelMenuState>();
		const createdAtMs = Date.now();
		const menuId = randomUUID().slice(0, 8);
		chatMenus.set(menuId, {
			modelIds,
			createdAtMs,
			expiresAtMs: createdAtMs + FIND_MENU_TTL_MS,
		});
		this.modelMenus.set(chatId, chatMenus);
		return menuId;
	}

	private getModelMenu(chatId: number, menuId: string): ModelMenuState | null {
		const chatMenus = this.modelMenus.get(chatId);
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

	private getModelIdByIndex(menu: ModelMenuState, argument: string): string | null {
		const index = Number.parseInt(argument, 10);
		if (!Number.isFinite(index) || index <= 0) {
			return null;
		}
		return menu.modelIds[index - 1] ?? null;
	}

	private buildModelsMenuText(modelIds: string[], selectedModelId: string): string {
		const lines = modelIds.map(
			(modelId, index) => `${index + 1}. ${modelId}${modelId === selectedModelId ? " ✅" : ""}`,
		);
		return `Models (Codex)\nCurrent: ${selectedModelId}\n\n${lines.join("\n")}`;
	}

	private buildModelsMenuKeyboard(
		menuId: string,
		modelIds: string[],
		selectedModelId: string,
	): TelegramInlineKeyboard {
		return modelIds.map((modelId, index) => [
			{
				text: `${index + 1} Use${modelId === selectedModelId ? " ✅" : ""}`,
				callbackData: buildCallbackPayload("model_set", menuId, index + 1),
			},
		]);
	}

	private createHistoryMenu(chatId: number, sessionId: string, page: number, pageSize: number): string {
		const chatMenus = this.historyMenus.get(chatId) ?? new Map<string, HistoryMenuState>();
		const createdAtMs = Date.now();
		const menuId = randomUUID().slice(0, 8);
		chatMenus.set(menuId, {
			sessionId,
			page,
			pageSize,
			createdAtMs,
			expiresAtMs: createdAtMs + FIND_MENU_TTL_MS,
		});
		this.historyMenus.set(chatId, chatMenus);
		return menuId;
	}

	private getHistoryMenu(chatId: number, menuId: string): HistoryMenuState | null {
		const chatMenus = this.historyMenus.get(chatId);
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

	private getSessionIdByIndex(menu: SessionMenuState, argument: string): string | null {
		const index = Number.parseInt(argument, 10);
		if (!Number.isFinite(index) || index <= 0) {
			return null;
		}
		return menu.sessionIds[index - 1] ?? null;
	}

	private getHistoryPage(
		sessionId: string,
		page: number,
		pageSize: number,
	): {
		text: string;
		pageTurnsCount: number;
		safePage: number;
		totalPages: number;
	} {
		const turns = this.app.listDialogueHistory(sessionId, 200);
		if (turns.length === 0) {
			return {
				text: `History for ${sessionId}\n\n(no turns)`,
				pageTurnsCount: 0,
				safePage: 0,
				totalPages: 1,
			};
		}
		const totalPages = Math.max(1, Math.ceil(turns.length / pageSize));
		const safePage = Math.max(0, Math.min(page, totalPages - 1));
		const start = safePage * pageSize;
		const pageTurns = turns.slice(start, start + pageSize);
		const lines = pageTurns.map((turn, index) => {
			const status = turn.status === "completed" ? "" : ` [${turn.status}]`;
			const preview =
				turn.status === "failed"
					? turn.errorMessage
						? `failed: ${turn.errorMessage}`
						: "(assistant turn failed)"
					: turn.content || "(empty)";
			return `${index + 1}. ${turn.role}${status}: ${truncateMiddle(preview, 280)}`;
		});
		return {
			text: `History for ${sessionId} (page ${safePage + 1}/${totalPages})\n\n${lines.join("\n\n")}`,
			pageTurnsCount: pageTurns.length,
			safePage,
			totalPages,
		};
	}

	private buildHistoryKeyboard(menuId: string, pageTurnsCount: number): TelegramInlineKeyboard {
		const rows: TelegramInlineKeyboard = [
			[
				{ text: "Prev", callbackData: buildCallbackPayload("hist_prev", menuId, 0) },
				{ text: "Next", callbackData: buildCallbackPayload("hist_next", menuId, 0) },
				{ text: "Back", callbackData: buildCallbackPayload("hist_back", menuId, 0) },
			],
		];
		for (let index = 0; index < pageTurnsCount; index++) {
			rows.push([{ text: `${index + 1} Full`, callbackData: buildCallbackPayload("hist_full", menuId, index + 1) }]);
		}
		return rows;
	}

	private buildItemModeKeyboard(includeViewer: boolean): TelegramInlineKeyboard {
		const row = includeViewer
			? [
					{ text: "Open Viewer", callbackData: buildCallbackPayload("ctx_viewer", "ctx", 0) },
					{ text: "Delete Item", callbackData: buildCallbackPayload("ctx_del", "ctx", 0) },
					{ text: "Exit", callbackData: buildCallbackPayload("ctx_exit", "ctx", 0) },
				]
			: [
					{ text: "Delete Item", callbackData: buildCallbackPayload("ctx_del", "ctx", 0) },
					{ text: "Exit", callbackData: buildCallbackPayload("ctx_exit", "ctx", 0) },
				];
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
		const recentLine = recentAt ? `\nRecent activity: ${formatDisplayTime(recentAt)}` : "";
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

	private deleteItemFromMenus(chatId: number, itemId: string): void {
		const itemMenus = this.itemMenus.get(chatId);
		if (!itemMenus) {
			return;
		}
		for (const [, menu] of itemMenus) {
			menu.entries = menu.entries.filter((entry) => entry.id !== itemId);
			if (menu.page > 0) {
				const totalPages = Math.max(1, Math.ceil(menu.entries.length / menu.pageSize));
				menu.page = Math.min(menu.page, totalPages - 1);
			}
		}
	}

	private async deleteItemAndNotify(chatId: number, itemId: string): Promise<void> {
		const deleted = this.app.deleteItem(itemId);
		if (!deleted.deleted) {
			await this.api.sendMessage(chatId, "Item not found or already deleted.");
			return;
		}
		const mode = this.getChatMode(chatId);
		if (mode?.mode === "item" && mode.itemId === itemId) {
			this.clearChatMode(chatId);
		}
		this.deleteItemFromMenus(chatId, itemId);
		await this.api.sendMessage(chatId, "Item deleted (including annotations, dialogue, and artifacts).");
	}

	private async handleCallback(chatId: number, callbackQueryId: string, data: string): Promise<void> {
		try {
			await routeTelegramCallback({
				chatId,
				data,
				modelSelector: this.modelSelector,
				getChatMode: this.getChatMode.bind(this),
				clearChatMode: this.clearChatMode.bind(this),
				deleteItemAndNotify: this.deleteItemAndNotify.bind(this),
				getViewerItemUrl: this.getViewerItemUrl,
				getModelMenu: this.getModelMenu.bind(this),
				getModelIdByIndex: (menu, argument) => this.getModelIdByIndex(menu as ModelMenuState, argument),
				createModelMenu: this.createModelMenu.bind(this),
				buildModelsMenuText: this.buildModelsMenuText.bind(this),
				buildModelsMenuKeyboard: this.buildModelsMenuKeyboard.bind(this),
				getItemMenu: this.getItemMenu.bind(this),
				getMenuItemId: (menu, argument) => this.getMenuItemId(menu as ItemMenuState, argument),
				collectMenuTags: (menu) => this.collectMenuTags(menu as ItemMenuState),
				buildTimeMenuKeyboard: this.buildTimeMenuKeyboard.bind(this),
				buildSourceMenuKeyboard: this.buildSourceMenuKeyboard.bind(this),
				buildSortMenuKeyboard: this.buildSortMenuKeyboard.bind(this),
				buildTagMenuKeyboard: (menuId, menu) => this.buildTagMenuKeyboard(menuId, menu as ItemMenuState),
				buildMenuBackKeyboard: (menuId) => [
					[{ text: "Back", callbackData: buildCallbackPayload("menu_back", menuId, 0) }],
				],
				parseTimeFilter,
				parseSourceFilter,
				parseSortFilter,
				parseTagSelection: (menu, argument) => this.parseTagSelection(menu as ItemMenuState, argument),
				parseTagPage,
				pagedMenuEntries: (menu) => this.pagedMenuEntries(menu as ItemMenuState),
				buildDiscoveryMenuText: (menu) => this.buildDiscoveryMenuText(menu as ItemMenuState),
				buildDiscoveryMenuKeyboard: (menuId, menu) =>
					this.buildDiscoveryMenuKeyboard(menuId, menu as ItemMenuState),
				getSessionMenu: this.getSessionMenu.bind(this),
				getSessionIdByIndex: (menu, argument) => this.getSessionIdByIndex(menu as SessionMenuState, argument),
				resumeItemDialogue: this.app.resumeItemDialogue.bind(this.app),
				createItemDialogue: this.app.createItemDialogue.bind(this.app),
				openItemDialogue: this.app.openItemDialogue.bind(this.app),
				setChatMode: this.setChatMode.bind(this),
				sendItemModeOpenedMessage: this.sendItemModeOpenedMessage.bind(this),
				getHistoryMenu: this.getHistoryMenu.bind(this),
				listDialogueHistory: this.app.listDialogueHistory.bind(this.app),
				getHistoryPage: this.getHistoryPage.bind(this),
				createHistoryMenu: this.createHistoryMenu.bind(this),
				buildHistoryKeyboard: this.buildHistoryKeyboard.bind(this),
				formatDisplayTime,
				splitForTelegram,
				sendMessage: this.api.sendMessage.bind(this.api),
			});
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
			const normalizedInput = stripTelegramCommandMention(text);
			const modeCommand = parseTelegramModeCommand(normalizedInput);
			if (modeCommand) {
				this.clearPendingSaveInput(chatId);
				await this.handleModeCommand(chatId, modeCommand);
				return;
			}

			if (!normalizedInput.startsWith("/")) {
				await handlePlainMessage({
					chatId,
					text,
					normalizedInput,
					hasPendingSaveInput: this.hasPendingSaveInput.bind(this),
					clearPendingSaveInput: this.clearPendingSaveInput.bind(this),
					getChatMode: this.getChatMode.bind(this),
					processCommand: this.app.processCommand.bind(this.app),
					saveFromInput: this.app.saveFromInput.bind(this.app),
					sendSaveResultAndMaybeOpenItemMode: this.sendSaveResultAndMaybeOpenItemMode.bind(this),
					extractUrlAndPastedText,
					handleActiveModeMessage: async (chatId, text, activeMode) => {
						await handleActiveModeMessage({
							chatId,
							text,
							activeMode,
							askInItemDialogue: this.app.askInItemDialogue.bind(this.app),
							chatWithoutItem: this.app.chatWithoutItem.bind(this.app),
							setChatMode: this.setChatMode.bind(this),
							formatContextualAnswer: this.formatContextualAnswer.bind(this),
							splitForTelegram,
							sendMessage: this.api.sendMessage.bind(this.api),
						});
					},
					sendMessage: this.api.sendMessage.bind(this.api),
				});
				return;
			}

			await handleSlashMessage({
				chatId,
				normalizedInput,
				markSaveInputPending: this.markSaveInputPending.bind(this),
				clearPendingSaveInput: this.clearPendingSaveInput.bind(this),
				processCommand: this.app.processCommand.bind(this.app),
				sendSaveResultAndMaybeOpenItemMode: this.sendSaveResultAndMaybeOpenItemMode.bind(this),
				createItemMenu: this.createItemMenu.bind(this),
				getItemMenu: this.getItemMenu.bind(this),
				buildDiscoveryMenuText: (menu) => this.buildDiscoveryMenuText(menu as ItemMenuState),
				buildDiscoveryMenuKeyboard: (menuId, menu) =>
					this.buildDiscoveryMenuKeyboard(menuId, menu as ItemMenuState),
				splitForTelegram,
				sendMessage: this.api.sendMessage.bind(this.api),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.api.sendMessage(chatId, `Error (RUNTIME_ERROR): ${message}`);
		}
	}

	private async handleModeCommand(chatId: number, command: ParsedTelegramModeCommand): Promise<void> {
		await handleModeCommandCore({
			chatId,
			command,
			getChatMode: this.getChatMode.bind(this),
			setChatMode: this.setChatMode.bind(this),
			clearChatMode: this.clearChatMode.bind(this),
			modelSelector: this.modelSelector,
			sendMessage: this.api.sendMessage.bind(this.api),
			openItemDialogue: this.app.openItemDialogue.bind(this.app),
			listItemDialogues: this.app.listItemDialogues.bind(this.app),
			resumeItemDialogue: this.app.resumeItemDialogue.bind(this.app),
			createSessionMenu: this.createSessionMenu.bind(this),
			createModelMenu: this.createModelMenu.bind(this),
			buildModelsMenuText: this.buildModelsMenuText.bind(this),
			buildModelsMenuKeyboard: this.buildModelsMenuKeyboard.bind(this),
			sendItemModeOpenedMessage: this.sendItemModeOpenedMessage.bind(this),
			createHistoryMenu: this.createHistoryMenu.bind(this),
			getHistoryPage: this.getHistoryPage.bind(this),
			buildHistoryKeyboard: this.buildHistoryKeyboard.bind(this),
			splitForTelegram,
			truncateMiddle,
			formatDisplayTime,
		});
	}
}

function stripTelegramCommandMention(text: string): string {
	const trimmed = text.trim();
	if (!trimmed.startsWith("/")) {
		return text;
	}
	const firstSpace = trimmed.indexOf(" ");
	const commandToken = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
	const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace);
	const mentionIndex = commandToken.indexOf("@");
	if (mentionIndex === -1) {
		return trimmed;
	}
	const commandWithoutMention = commandToken.slice(0, mentionIndex);
	return `${commandWithoutMention}${rest}`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Aborted"));
			return;
		}

		let settled = false;
		const onAbort = () => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
			reject(new Error("Aborted"));
		};

		const timeout = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);

		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
