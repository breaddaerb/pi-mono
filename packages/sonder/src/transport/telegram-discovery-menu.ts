import type { ItemMenuEntry, ItemMenuState } from "./menu-store.js";
import { buildCallbackPayload } from "./telegram-callback.js";
import { formatSortFilter, formatSourceFilter, formatTimeFilter } from "./telegram-discovery-filters.js";
import { formatDiscoveryReasonSummary } from "./telegram-retrieval-reasons.js";

export interface DiscoveryPage {
	items: ItemMenuEntry[];
	total: number;
	page: number;
	totalPages: number;
}

export type InlineKeyboard = Array<Array<{ text: string; callbackData: string }>>;

export function applyItemMenuFilters(menu: ItemMenuState): ItemMenuEntry[] {
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

export function pagedMenuEntries(menu: ItemMenuState): DiscoveryPage {
	const filtered = applyItemMenuFilters(menu);
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

export function getMenuItemId(menu: ItemMenuState, argument: string): string | null {
	const index = Number.parseInt(argument, 10);
	if (!Number.isFinite(index) || index <= 0) {
		return null;
	}
	const paged = pagedMenuEntries(menu);
	return paged.items[index - 1]?.id ?? null;
}

export function collectMenuTags(menu: ItemMenuState): string[] {
	return Array.from(new Set(menu.entries.flatMap((entry) => entry.tags))).sort();
}

export function parseTagSelection(menu: ItemMenuState, argument: string): string | null {
	const index = Number.parseInt(argument, 10);
	if (!Number.isFinite(index) || index <= 0) {
		return null;
	}
	const tags = collectMenuTags(menu);
	return tags[index - 1] ?? null;
}

export function buildDiscoveryMenuText(
	menu: ItemMenuState,
	options: {
		formatDisplayTime: (timestamp: string) => string;
		truncateMiddle: (text: string, maxLength: number) => string;
	},
): string {
	const paged = pagedMenuEntries(menu);
	if (paged.items.length === 0) {
		const title = menu.kind === "find" ? `🔎 Find: ${menu.query ?? ""}` : "🗂 Recent items";
		return `${title}\n\nNo results match current filters.`;
	}
	const title = menu.kind === "find" ? `🔎 Find: ${menu.query ?? ""}` : "🗂 Recent items";
	const rows = paged.items.map((entry, index) => {
		const tags = entry.tags.length > 0 ? ` ${entry.tags.map((tag) => `#${tag}`).join(" ")}` : "";
		const reasonLine =
			menu.kind === "find" && entry.reasons.length > 0
				? `\n   reasons: ${formatDiscoveryReasonSummary(entry.reasons)}`
				: "";
		const snippetLine =
			menu.kind === "find" && entry.snippets.length > 0
				? `\n   match: ${options.truncateMiddle(entry.snippets[0], 120)}`
				: "";
		return `${index + 1}. ${options.truncateMiddle(entry.originalUrl, 96)}${tags}\n   ${entry.sourceType} · ${options.formatDisplayTime(entry.createdAt)}${reasonLine}${snippetLine}`;
	});
	const filterSummary = `Filters: Time=${formatTimeFilter(menu.time)} | Source=${formatSourceFilter(menu.source)} | Tag=${menu.tag ?? "Any"} | Sort=${formatSortFilter(menu.sort)}`;
	return `${title} (${paged.total}) [page ${paged.page + 1}/${paged.totalPages}]\n${filterSummary}\n\n${rows.join("\n\n")}`;
}

export function buildDiscoveryMenuKeyboard(menuId: string, menu: ItemMenuState): InlineKeyboard {
	const paged = pagedMenuEntries(menu);
	const itemRows: InlineKeyboard = paged.items.map((_, index) => [
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

export function buildTagMenuKeyboard(menuId: string, menu: ItemMenuState): InlineKeyboard {
	const tags = collectMenuTags(menu);
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
	const navRow: Array<{ text: string; callbackData: string }> = [];
	if (totalPages > 1) {
		navRow.push({ text: "Prev", callbackData: buildCallbackPayload("menu_tag_page", menuId, safePage - 1) });
		navRow.push({
			text: `${safePage + 1}/${totalPages}`,
			callbackData: buildCallbackPayload("menu_tag_page", menuId, safePage),
		});
		navRow.push({ text: "Next", callbackData: buildCallbackPayload("menu_tag_page", menuId, safePage + 1) });
	}
	const controls = [
		{ text: "Any", callbackData: buildCallbackPayload("menu_tag_set", menuId, 0) },
		{ text: "Back", callbackData: buildCallbackPayload("menu_back", menuId, 0) },
	];
	return navRow.length > 0 ? [...tagRows, navRow, controls] : [...tagRows, controls];
}
