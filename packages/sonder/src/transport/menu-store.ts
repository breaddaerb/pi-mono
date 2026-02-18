import { randomUUID } from "node:crypto";
import type { SortFilter, SourceFilter, TimeFilter } from "./telegram-discovery-filters.js";

export type MenuKind = "find" | "list";

export interface ItemMenuEntry {
	id: string;
	createdAt: string;
	sourceType: string;
	originalUrl: string;
	tags: string[];
	reasons: string[];
	snippets: string[];
}

export interface ItemMenuState {
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

export interface SessionMenuState {
	itemId: string;
	sessionIds: string[];
	createdAtMs: number;
	expiresAtMs: number;
}

export interface ModelMenuState {
	modelIds: string[];
	createdAtMs: number;
	expiresAtMs: number;
}

export interface HistoryMenuState {
	sessionId: string;
	page: number;
	pageSize: number;
	createdAtMs: number;
	expiresAtMs: number;
}

interface ExpiringMenuState {
	expiresAtMs: number;
}

export class TelegramMenuStore {
	private readonly itemMenus = new Map<number, Map<string, ItemMenuState>>();
	private readonly sessionMenus = new Map<number, Map<string, SessionMenuState>>();
	private readonly modelMenus = new Map<number, Map<string, ModelMenuState>>();
	private readonly historyMenus = new Map<number, Map<string, HistoryMenuState>>();

	constructor(
		private readonly ttlMs: number,
		private readonly now: () => number = Date.now,
	) {}

	createItemMenu(chatId: number, kind: MenuKind, entries: ItemMenuEntry[], query: string | null): string {
		const chatMenus = this.itemMenus.get(chatId) ?? new Map<string, ItemMenuState>();
		const createdAtMs = this.now();
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
			expiresAtMs: createdAtMs + this.ttlMs,
		});
		this.itemMenus.set(chatId, chatMenus);
		return menuId;
	}

	getItemMenu(chatId: number, menuId: string): ItemMenuState | null {
		return this.getValidMenu(this.itemMenus, chatId, menuId);
	}

	forEachItemMenu(chatId: number, visitor: (menu: ItemMenuState) => void): void {
		const chatMenus = this.itemMenus.get(chatId);
		if (!chatMenus) {
			return;
		}
		for (const [, menu] of chatMenus) {
			visitor(menu);
		}
	}

	createSessionMenu(chatId: number, itemId: string, sessionIds: string[]): string {
		const chatMenus = this.sessionMenus.get(chatId) ?? new Map<string, SessionMenuState>();
		const createdAtMs = this.now();
		const menuId = randomUUID().slice(0, 8);
		chatMenus.set(menuId, {
			itemId,
			sessionIds,
			createdAtMs,
			expiresAtMs: createdAtMs + this.ttlMs,
		});
		this.sessionMenus.set(chatId, chatMenus);
		return menuId;
	}

	getSessionMenu(chatId: number, menuId: string): SessionMenuState | null {
		return this.getValidMenu(this.sessionMenus, chatId, menuId);
	}

	createModelMenu(chatId: number, modelIds: string[]): string {
		const chatMenus = this.modelMenus.get(chatId) ?? new Map<string, ModelMenuState>();
		const createdAtMs = this.now();
		const menuId = randomUUID().slice(0, 8);
		chatMenus.set(menuId, {
			modelIds,
			createdAtMs,
			expiresAtMs: createdAtMs + this.ttlMs,
		});
		this.modelMenus.set(chatId, chatMenus);
		return menuId;
	}

	getModelMenu(chatId: number, menuId: string): ModelMenuState | null {
		return this.getValidMenu(this.modelMenus, chatId, menuId);
	}

	createHistoryMenu(chatId: number, sessionId: string, page: number, pageSize: number): string {
		const chatMenus = this.historyMenus.get(chatId) ?? new Map<string, HistoryMenuState>();
		const createdAtMs = this.now();
		const menuId = randomUUID().slice(0, 8);
		chatMenus.set(menuId, {
			sessionId,
			page,
			pageSize,
			createdAtMs,
			expiresAtMs: createdAtMs + this.ttlMs,
		});
		this.historyMenus.set(chatId, chatMenus);
		return menuId;
	}

	getHistoryMenu(chatId: number, menuId: string): HistoryMenuState | null {
		return this.getValidMenu(this.historyMenus, chatId, menuId);
	}

	private getValidMenu<T extends ExpiringMenuState>(
		menus: Map<number, Map<string, T>>,
		chatId: number,
		menuId: string,
	): T | null {
		const chatMenus = menus.get(chatId);
		if (!chatMenus) {
			return null;
		}
		const menu = chatMenus.get(menuId);
		if (!menu) {
			return null;
		}
		if (this.now() > menu.expiresAtMs) {
			chatMenus.delete(menuId);
			return null;
		}
		return menu;
	}
}
