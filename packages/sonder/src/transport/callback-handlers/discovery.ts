import type {
	ChatModeSetter,
	DialogueSessionInfoLike,
	InlineKeyboard,
	ItemMenuStateLike,
	MessageSender,
} from "./types.js";

export type DiscoveryItemCallbackAction = "find_open" | "find_del" | "list_open" | "list_del";

export type DiscoveryMenuFilterAction =
	| "menu_time"
	| "menu_time_set"
	| "menu_source"
	| "menu_source_set"
	| "menu_tag"
	| "menu_tag_set"
	| "menu_tag_page"
	| "menu_sort"
	| "menu_sort_set"
	| "menu_back"
	| "menu_clear"
	| "menu_prev"
	| "menu_next";

export interface DiscoveryItemCallbackContext {
	chatId: number;
	menuId: string;
	action: DiscoveryItemCallbackAction;
	argument: string;
	getItemMenu: (chatId: number, menuId: string) => ItemMenuStateLike | null;
	getMenuItemId: (menu: ItemMenuStateLike, argument: string) => string | null;
	deleteItemAndNotify: (chatId: number, itemId: string) => Promise<void>;
	buildDiscoveryMenuText: (menu: ItemMenuStateLike) => string;
	buildDiscoveryMenuKeyboard: (menuId: string, menu: ItemMenuStateLike) => InlineKeyboard;
	openItemDialogue: (itemId: string) => DialogueSessionInfoLike;
	setChatMode: ChatModeSetter;
	sendItemModeOpenedMessage: (chatId: number, header: string, itemId: string, sessionId: string) => Promise<void>;
	sendMessage: MessageSender;
}

export async function handleDiscoveryItemCallback(context: DiscoveryItemCallbackContext): Promise<boolean> {
	const menu = context.getItemMenu(context.chatId, context.menuId);
	if (!menu) {
		await context.sendMessage(context.chatId, "This menu expired. Use /open or /find again.");
		return true;
	}

	const expectedKind: ItemMenuStateLike["kind"] = context.action.startsWith("list_") ? "list" : "find";
	if (menu.kind !== expectedKind) {
		await context.sendMessage(
			context.chatId,
			"This menu action is no longer valid. Use /open, /list, or /find again.",
		);
		return true;
	}

	const itemId = context.getMenuItemId(menu, context.argument);
	if (!itemId) {
		await context.sendMessage(context.chatId, "Invalid selection. Use /list or /find again.");
		return true;
	}

	if (context.action === "find_del" || context.action === "list_del") {
		await context.deleteItemAndNotify(context.chatId, itemId);
		const refreshedMenu = context.getItemMenu(context.chatId, context.menuId);
		if (refreshedMenu) {
			const responseText = context.buildDiscoveryMenuText(refreshedMenu);
			const inlineKeyboard = context.buildDiscoveryMenuKeyboard(context.menuId, refreshedMenu);
			await context.sendMessage(context.chatId, responseText, { inlineKeyboard });
		}
		return true;
	}

	const opened = context.openItemDialogue(itemId);
	context.setChatMode(context.chatId, {
		mode: "item",
		itemId: opened.itemId,
		sessionId: opened.sessionId,
	});
	const prompt = `🧠 Item mode opened from result #${context.argument}.`;
	await context.sendItemModeOpenedMessage(context.chatId, prompt, opened.itemId, opened.sessionId);
	return true;
}

export interface DiscoveryMenuFilterCallbackContext {
	chatId: number;
	menuId: string;
	action: DiscoveryMenuFilterAction;
	argument: string;
	getItemMenu: (chatId: number, menuId: string) => ItemMenuStateLike | null;
	collectMenuTags: (menu: ItemMenuStateLike) => string[];
	buildTimeMenuKeyboard: (menuId: string) => InlineKeyboard;
	buildSourceMenuKeyboard: (menuId: string) => InlineKeyboard;
	buildSortMenuKeyboard: (menuId: string) => InlineKeyboard;
	buildTagMenuKeyboard: (menuId: string, menu: ItemMenuStateLike) => InlineKeyboard;
	buildMenuBackKeyboard: (menuId: string) => InlineKeyboard;
	parseTimeFilter: (argument: string) => ItemMenuStateLike["time"] | null;
	parseSourceFilter: (argument: string) => ItemMenuStateLike["source"] | null;
	parseSortFilter: (argument: string) => ItemMenuStateLike["sort"] | null;
	parseTagSelection: (menu: ItemMenuStateLike, argument: string) => string | null;
	parseTagPage: (argument: string, totalPages: number) => number;
	pagedMenuEntries: (menu: ItemMenuStateLike) => { page: number; totalPages: number };
	buildDiscoveryMenuText: (menu: ItemMenuStateLike) => string;
	buildDiscoveryMenuKeyboard: (menuId: string, menu: ItemMenuStateLike) => InlineKeyboard;
	sendMessage: MessageSender;
}

function normalizeMenuState(menu: ItemMenuStateLike): void {
	if (!Number.isFinite(menu.page) || menu.page < 0) {
		menu.page = 0;
	}
	if (!Number.isFinite(menu.pageSize) || menu.pageSize < 1) {
		menu.pageSize = 5;
	}
	if (!Number.isFinite(menu.tagPage) || menu.tagPage < 0) {
		menu.tagPage = 0;
	}
	if (
		menu.time !== "all" &&
		menu.time !== "today" &&
		menu.time !== "7d" &&
		menu.time !== "30d" &&
		menu.time !== "year"
	) {
		menu.time = "all";
	}
	if (menu.source !== "any" && menu.source !== "web") {
		menu.source = "any";
	}
	if (menu.sort !== "newest" && menu.sort !== "oldest") {
		menu.sort = "newest";
	}
}

export async function handleDiscoveryMenuFilterCallback(context: DiscoveryMenuFilterCallbackContext): Promise<boolean> {
	const menu = context.getItemMenu(context.chatId, context.menuId);
	if (!menu) {
		await context.sendMessage(context.chatId, "This menu expired. Use /list or /find again.");
		return true;
	}
	normalizeMenuState(menu);

	if (context.action === "menu_time") {
		await context.sendMessage(context.chatId, "Select time filter", {
			inlineKeyboard: context.buildTimeMenuKeyboard(context.menuId),
		});
		return true;
	}
	if (context.action === "menu_source") {
		await context.sendMessage(context.chatId, "Select source filter", {
			inlineKeyboard: context.buildSourceMenuKeyboard(context.menuId),
		});
		return true;
	}
	if (context.action === "menu_tag") {
		menu.tagPage = 0;
		const tags = context.collectMenuTags(menu);
		if (tags.length === 0) {
			await context.sendMessage(context.chatId, "No tags available for this menu.", {
				inlineKeyboard: context.buildMenuBackKeyboard(context.menuId),
			});
			return true;
		}
		await context.sendMessage(context.chatId, "Select tag filter", {
			inlineKeyboard: context.buildTagMenuKeyboard(context.menuId, menu),
		});
		return true;
	}
	if (context.action === "menu_sort") {
		await context.sendMessage(context.chatId, "Select sort order", {
			inlineKeyboard: context.buildSortMenuKeyboard(context.menuId),
		});
		return true;
	}

	if (context.action === "menu_time_set") {
		const next = context.parseTimeFilter(context.argument);
		if (!next) {
			await context.sendMessage(context.chatId, "Invalid time filter selection. Use the menu buttons again.");
			return true;
		}
		menu.time = next;
		menu.page = 0;
	}
	if (context.action === "menu_source_set") {
		const next = context.parseSourceFilter(context.argument);
		if (!next) {
			await context.sendMessage(context.chatId, "Invalid source filter selection. Use the menu buttons again.");
			return true;
		}
		menu.source = next;
		menu.page = 0;
	}
	if (context.action === "menu_sort_set") {
		const next = context.parseSortFilter(context.argument);
		if (!next) {
			await context.sendMessage(context.chatId, "Invalid sort selection. Use the menu buttons again.");
			return true;
		}
		menu.sort = next;
		menu.page = 0;
	}
	if (context.action === "menu_tag_set") {
		if (context.argument === "0") {
			menu.tag = null;
		} else {
			const selectedTag = context.parseTagSelection(menu, context.argument);
			if (!selectedTag) {
				await context.sendMessage(context.chatId, "Invalid tag selection. Use the menu buttons again.", {
					inlineKeyboard: context.buildTagMenuKeyboard(context.menuId, menu),
				});
				return true;
			}
			menu.tag = selectedTag;
		}
		menu.page = 0;
		menu.tagPage = 0;
	}
	if (context.action === "menu_tag_page") {
		const tags = context.collectMenuTags(menu);
		if (tags.length === 0) {
			await context.sendMessage(context.chatId, "No tags available for this menu.", {
				inlineKeyboard: context.buildMenuBackKeyboard(context.menuId),
			});
			return true;
		}
		const totalPages = Math.max(1, Math.ceil(tags.length / 6));
		menu.tagPage = context.parseTagPage(context.argument, totalPages);
		await context.sendMessage(context.chatId, "Select tag filter", {
			inlineKeyboard: context.buildTagMenuKeyboard(context.menuId, menu),
		});
		return true;
	}
	if (context.action === "menu_clear") {
		menu.time = "all";
		menu.source = "any";
		menu.tag = null;
		menu.sort = "newest";
		menu.page = 0;
		menu.tagPage = 0;
	}
	if (context.action === "menu_prev" || context.action === "menu_next") {
		const pageInfo = context.pagedMenuEntries(menu);
		if (pageInfo.totalPages <= 1) {
			menu.page = 0;
		} else if (context.action === "menu_next") {
			menu.page = (pageInfo.page + 1) % pageInfo.totalPages;
		} else {
			menu.page = (pageInfo.page - 1 + pageInfo.totalPages) % pageInfo.totalPages;
		}
	}
	const responseText = context.buildDiscoveryMenuText(menu);
	const keyboard = context.buildDiscoveryMenuKeyboard(context.menuId, menu);
	await context.sendMessage(context.chatId, responseText, { inlineKeyboard: keyboard });
	return true;
}
