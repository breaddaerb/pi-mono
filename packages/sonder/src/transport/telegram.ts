import type { Writable } from "node:stream";
import { type Dispatcher, ProxyAgent, fetch as undiciFetch } from "undici";
import type { SonderApp } from "../app/index.js";

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

export class TelegramBotRunner {
	private offset = 0;
	private readonly longPollSeconds: number;
	private readonly idleDelayMs: number;
	private readonly stderr: Writable;

	constructor(
		private readonly api: TelegramApi,
		private readonly app: SonderApp,
		options: TelegramRunnerOptions = {},
	) {
		this.longPollSeconds = options.longPollSeconds ?? 30;
		this.idleDelayMs = options.idleDelayMs ?? 250;
		this.stderr = options.stderr ?? process.stderr;
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

	private async handleMessage(chatId: number, text: string): Promise<void> {
		if (!text.startsWith("/")) {
			await this.api.sendMessage(chatId, "Send one of: /save <url>, /list, /ask <itemId> <question>");
			return;
		}

		const result = await this.app.processCommand(text);
		const output = result.ok ? result.value : result.error;
		await this.api.sendMessage(chatId, JSON.stringify(output, null, 2));
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
