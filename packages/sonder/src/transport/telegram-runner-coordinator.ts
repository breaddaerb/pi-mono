import type { SonderApp, SonderCommandResult } from "../app/index.js";
import type { ParsedTelegramModeCommand } from "../commands/parse-mode-command.js";
import type {
	HistoryMenuState,
	ItemMenuEntry,
	ItemMenuState,
	MenuKind,
	ModelMenuState,
	SessionMenuState,
	TelegramMenuStore,
} from "./menu-store.js";
import type { TelegramApi, TelegramInlineKeyboard, TelegramRuntimeModelSelector } from "./telegram.js";
import { handleActiveModeMessage } from "./telegram-active-mode-message-handler.js";
import { buildCallbackPayload } from "./telegram-callback.js";
import { routeTelegramCallback } from "./telegram-callback-router.js";
import { parseSortFilter, parseSourceFilter, parseTagPage, parseTimeFilter } from "./telegram-discovery-filters.js";
import {
	buildDiscoveryMenuKeyboard,
	buildDiscoveryMenuText,
	buildTagMenuKeyboard,
	collectMenuTags,
	getMenuItemId,
	pagedMenuEntries,
	parseTagSelection,
} from "./telegram-discovery-menu.js";
import { formatDisplayTime } from "./telegram-display-time.js";
import { extractUrlAndPastedText } from "./telegram-input.js";
import { routeTelegramMessage } from "./telegram-message-router.js";
import { handleModeCommand as handleModeCommandCore } from "./telegram-mode-command-handler.js";
import type { ChatModeState, TelegramChatModeStore } from "./telegram-mode-store.js";
import { handlePlainMessage } from "./telegram-plain-message-handler.js";
import { formatCommandResult, splitForTelegram, truncateMiddle } from "./telegram-renderers.js";
import { handleSlashMessage } from "./telegram-slash-command-handler.js";

type SaveCommandResult = Extract<SonderCommandResult, { type: "save" }>;

export interface TelegramRunnerCoordinatorOptions {
	api: TelegramApi;
	app: SonderApp;
	chatModeStore: TelegramChatModeStore;
	menuStore: TelegramMenuStore;
	getViewerItemUrl?: (itemId: string) => string;
	modelSelector: TelegramRuntimeModelSelector | null;
}

export class TelegramRunnerCoordinator {
	private readonly pendingSaveChats = new Set<number>();

	constructor(private readonly options: TelegramRunnerCoordinatorOptions) {}

	async handleCallback(chatId: number, callbackQueryId: string, data: string): Promise<void> {
		try {
			await routeTelegramCallback({
				chatId,
				data,
				modelSelector: this.options.modelSelector,
				getChatMode: this.getChatMode.bind(this),
				clearChatMode: this.clearChatMode.bind(this),
				deleteItemAndNotify: this.deleteItemAndNotify.bind(this),
				getViewerItemUrl: this.options.getViewerItemUrl,
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
				resumeItemDialogue: this.options.app.resumeItemDialogue.bind(this.options.app),
				createItemDialogue: this.options.app.createItemDialogue.bind(this.options.app),
				openItemDialogue: this.options.app.openItemDialogue.bind(this.options.app),
				setChatMode: this.setChatMode.bind(this),
				sendItemModeOpenedMessage: this.sendItemModeOpenedMessage.bind(this),
				getHistoryMenu: this.getHistoryMenu.bind(this),
				listDialogueHistory: this.options.app.listDialogueHistory.bind(this.options.app),
				getHistoryPage: this.getHistoryPage.bind(this),
				createHistoryMenu: this.createHistoryMenu.bind(this),
				buildHistoryKeyboard: this.buildHistoryKeyboard.bind(this),
				formatDisplayTime,
				splitForTelegram,
				sendMessage: this.options.api.sendMessage.bind(this.options.api),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.options.api.sendMessage(chatId, `Error (RUNTIME_ERROR): ${message}`);
		} finally {
			try {
				await this.options.api.answerCallbackQuery(callbackQueryId);
			} catch {
				// Best-effort ack; avoid failing flow on callback ack issues.
			}
		}
	}

	async handleMessage(chatId: number, text: string): Promise<void> {
		try {
			await routeTelegramMessage({
				chatId,
				text,
				clearPendingSaveInput: this.clearPendingSaveInput.bind(this),
				handleModeCommand: this.handleModeCommand.bind(this),
				handlePlainMessage: this.handlePlainMessageRoute.bind(this),
				handleSlashMessage: this.handleSlashMessageRoute.bind(this),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.options.api.sendMessage(chatId, `Error (RUNTIME_ERROR): ${message}`);
		}
	}

	private getChatMode(chatId: number): ChatModeState | undefined {
		return this.options.chatModeStore.get(chatId);
	}

	private setChatMode(chatId: number, mode: ChatModeState): void {
		this.options.chatModeStore.set(chatId, mode);
	}

	private clearChatMode(chatId: number): boolean {
		return this.options.chatModeStore.clear(chatId);
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
		await this.options.api.sendMessage(chatId, responseText);
		if (saveResult.needsUserEvidence) {
			return;
		}
		const opened = this.options.app.openItemDialogue(saveResult.itemId);
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
		return this.options.menuStore.createItemMenu(chatId, kind, entries, query);
	}

	private getItemMenu(chatId: number, menuId: string): ItemMenuState | null {
		return this.options.menuStore.getItemMenu(chatId, menuId);
	}

	private pagedMenuEntries(menu: ItemMenuState): {
		items: ItemMenuEntry[];
		total: number;
		page: number;
		totalPages: number;
	} {
		return pagedMenuEntries(menu);
	}

	private getMenuItemId(menu: ItemMenuState, argument: string): string | null {
		return getMenuItemId(menu, argument);
	}

	private buildDiscoveryMenuText(menu: ItemMenuState): string {
		return buildDiscoveryMenuText(menu, {
			formatDisplayTime,
			truncateMiddle,
		});
	}

	private buildDiscoveryMenuKeyboard(menuId: string, menu: ItemMenuState): TelegramInlineKeyboard {
		return buildDiscoveryMenuKeyboard(menuId, menu);
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
		return collectMenuTags(menu);
	}

	private buildTagMenuKeyboard(menuId: string, menu: ItemMenuState): TelegramInlineKeyboard {
		return buildTagMenuKeyboard(menuId, menu);
	}

	private parseTagSelection(menu: ItemMenuState, argument: string): string | null {
		return parseTagSelection(menu, argument);
	}

	private createSessionMenu(chatId: number, itemId: string, sessionIds: string[]): string {
		return this.options.menuStore.createSessionMenu(chatId, itemId, sessionIds);
	}

	private getSessionMenu(chatId: number, menuId: string): SessionMenuState | null {
		return this.options.menuStore.getSessionMenu(chatId, menuId);
	}

	private createModelMenu(chatId: number, modelIds: string[]): string {
		return this.options.menuStore.createModelMenu(chatId, modelIds);
	}

	private getModelMenu(chatId: number, menuId: string): ModelMenuState | null {
		return this.options.menuStore.getModelMenu(chatId, menuId);
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
		return this.options.menuStore.createHistoryMenu(chatId, sessionId, page, pageSize);
	}

	private getHistoryMenu(chatId: number, menuId: string): HistoryMenuState | null {
		return this.options.menuStore.getHistoryMenu(chatId, menuId);
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
		const turns = this.options.app.listDialogueHistory(sessionId, 200);
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
		const viewerUrl = this.options.getViewerItemUrl ? this.options.getViewerItemUrl(itemId) : null;
		const viewerLine = viewerUrl ? `\nViewer: ${viewerUrl}` : "";
		const turns = this.options.app.listDialogueHistory(sessionId, 200).length;
		const sessions = this.options.app.listItemDialogues(itemId);
		const sessionsCount = sessions.length;
		const recentAt = sessions.map((session) => session.createdAt).sort((left, right) => right.localeCompare(left))[0];
		const recentLine = recentAt ? `\nRecent activity: ${formatDisplayTime(recentAt)}` : "";
		const summary = `\nSession: active • ${turns} turns\nRecent sessions: ${sessionsCount}${recentLine}`;
		await this.options.api.sendMessage(
			chatId,
			`${header}${summary}${viewerLine}\nSend messages directly. /exit to leave.`,
			{
				inlineKeyboard: this.buildItemModeKeyboard(Boolean(viewerUrl)),
			},
		);
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
		this.options.menuStore.forEachItemMenu(chatId, (menu) => {
			menu.entries = menu.entries.filter((entry) => entry.id !== itemId);
			if (menu.page > 0) {
				const totalPages = Math.max(1, Math.ceil(menu.entries.length / menu.pageSize));
				menu.page = Math.min(menu.page, totalPages - 1);
			}
		});
	}

	private async deleteItemAndNotify(chatId: number, itemId: string): Promise<void> {
		const deleted = this.options.app.deleteItem(itemId);
		if (!deleted.deleted) {
			await this.options.api.sendMessage(chatId, "Item not found or already deleted.");
			return;
		}
		const mode = this.getChatMode(chatId);
		if (mode?.mode === "item" && mode.itemId === itemId) {
			this.clearChatMode(chatId);
		}
		this.deleteItemFromMenus(chatId, itemId);
		await this.options.api.sendMessage(chatId, "Item deleted (including annotations, dialogue, and artifacts).");
	}

	private async handlePlainMessageRoute(chatId: number, text: string, normalizedInput: string): Promise<void> {
		await handlePlainMessage({
			chatId,
			text,
			normalizedInput,
			hasPendingSaveInput: this.hasPendingSaveInput.bind(this),
			clearPendingSaveInput: this.clearPendingSaveInput.bind(this),
			getChatMode: this.getChatMode.bind(this),
			processCommand: this.options.app.processCommand.bind(this.options.app),
			saveFromInput: this.options.app.saveFromInput.bind(this.options.app),
			sendSaveResultAndMaybeOpenItemMode: this.sendSaveResultAndMaybeOpenItemMode.bind(this),
			extractUrlAndPastedText,
			handleActiveModeMessage: async (chatId, text, activeMode) => {
				await handleActiveModeMessage({
					chatId,
					text,
					activeMode,
					askInItemDialogue: this.options.app.askInItemDialogue.bind(this.options.app),
					chatWithoutItem: this.options.app.chatWithoutItem.bind(this.options.app),
					setChatMode: this.setChatMode.bind(this),
					formatContextualAnswer: this.formatContextualAnswer.bind(this),
					splitForTelegram,
					sendMessage: this.options.api.sendMessage.bind(this.options.api),
				});
			},
			sendMessage: this.options.api.sendMessage.bind(this.options.api),
		});
	}

	private async handleSlashMessageRoute(chatId: number, normalizedInput: string): Promise<void> {
		await handleSlashMessage({
			chatId,
			normalizedInput,
			markSaveInputPending: this.markSaveInputPending.bind(this),
			clearPendingSaveInput: this.clearPendingSaveInput.bind(this),
			processCommand: this.options.app.processCommand.bind(this.options.app),
			sendSaveResultAndMaybeOpenItemMode: this.sendSaveResultAndMaybeOpenItemMode.bind(this),
			createItemMenu: this.createItemMenu.bind(this),
			getItemMenu: this.getItemMenu.bind(this),
			buildDiscoveryMenuText: (menu) => this.buildDiscoveryMenuText(menu as ItemMenuState),
			buildDiscoveryMenuKeyboard: (menuId, menu) => this.buildDiscoveryMenuKeyboard(menuId, menu as ItemMenuState),
			splitForTelegram,
			sendMessage: this.options.api.sendMessage.bind(this.options.api),
		});
	}

	private async handleModeCommand(chatId: number, command: ParsedTelegramModeCommand): Promise<void> {
		await handleModeCommandCore({
			chatId,
			command,
			getChatMode: this.getChatMode.bind(this),
			setChatMode: this.setChatMode.bind(this),
			clearChatMode: this.clearChatMode.bind(this),
			modelSelector: this.options.modelSelector,
			sendMessage: this.options.api.sendMessage.bind(this.options.api),
			openItemDialogue: this.options.app.openItemDialogue.bind(this.options.app),
			listItemDialogues: this.options.app.listItemDialogues.bind(this.options.app),
			resumeItemDialogue: this.options.app.resumeItemDialogue.bind(this.options.app),
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
