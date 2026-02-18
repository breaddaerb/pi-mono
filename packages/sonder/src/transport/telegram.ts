import type { Writable } from "node:stream";
import { type Dispatcher, ProxyAgent, fetch as undiciFetch } from "undici";
import type { SonderApp } from "../app/index.js";
import { TelegramMenuStore } from "./menu-store.js";
import { TelegramChatModeStore } from "./telegram-mode-store.js";
import { formatPollingError } from "./telegram-renderers.js";
import { TelegramRunnerCoordinator } from "./telegram-runner-coordinator.js";
import { sleep } from "./telegram-utils.js";

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

export class TelegramBotRunner {
	private offset = 0;
	private readonly longPollSeconds: number;
	private readonly idleDelayMs: number;
	private readonly stderr: Writable;
	private readonly coordinator: TelegramRunnerCoordinator;

	constructor(
		private readonly api: TelegramApi,
		app: SonderApp,
		options: TelegramRunnerOptions = {},
	) {
		this.longPollSeconds = options.longPollSeconds ?? 30;
		this.idleDelayMs = options.idleDelayMs ?? 250;
		this.stderr = options.stderr ?? process.stderr;

		const chatModeStore = new TelegramChatModeStore(app);
		const menuStore = new TelegramMenuStore(FIND_MENU_TTL_MS);
		this.coordinator = new TelegramRunnerCoordinator({
			api: this.api,
			app,
			chatModeStore,
			menuStore,
			getViewerItemUrl: options.getViewerItemUrl,
			modelSelector: options.modelSelector ?? null,
		});
	}

	async pollOnce(): Promise<void> {
		const updates = await this.api.getUpdates(this.offset, this.longPollSeconds);
		for (const update of updates) {
			this.offset = Math.max(this.offset, update.updateId + 1);
			if (update.type === "message") {
				await this.coordinator.handleMessage(update.chatId, update.text);
				continue;
			}
			await this.coordinator.handleCallback(update.chatId, update.callbackQueryId, update.data);
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
}
