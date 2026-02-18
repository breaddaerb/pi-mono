import { describe, expect, it } from "vitest";
import type { ItemMenuState } from "../src/transport/menu-store.js";
import {
	buildDiscoveryMenuKeyboard,
	buildDiscoveryMenuText,
	buildTagMenuKeyboard,
	collectMenuTags,
	getMenuItemId,
	pagedMenuEntries,
	parseTagSelection,
} from "../src/transport/telegram-discovery-menu.js";

function createMenu(partial?: Partial<ItemMenuState>): ItemMenuState {
	return {
		kind: "find",
		query: "query",
		entries: [
			{
				id: "item-1",
				createdAt: "2026-02-18T00:00:00.000Z",
				sourceType: "web",
				originalUrl: "https://example.com/alpha",
				tags: ["a", "common"],
				reasons: ["title"],
				snippets: ["alpha snippet"],
			},
			{
				id: "item-2",
				createdAt: "2026-02-17T00:00:00.000Z",
				sourceType: "web",
				originalUrl: "https://example.com/beta",
				tags: ["b", "common"],
				reasons: ["body"],
				snippets: ["beta snippet"],
			},
		],
		page: 0,
		pageSize: 5,
		time: "all",
		source: "any",
		tag: null,
		sort: "newest",
		tagPage: 0,
		createdAtMs: 0,
		expiresAtMs: 60_000,
		...partial,
	};
}

describe("telegram discovery menu", () => {
	it("pages and resolves item ids by index", () => {
		const menu = createMenu();
		const page = pagedMenuEntries(menu);

		expect(page.total).toBe(2);
		expect(page.page).toBe(0);
		expect(getMenuItemId(menu, "1")).toBe("item-1");
		expect(getMenuItemId(menu, "2")).toBe("item-2");
		expect(getMenuItemId(menu, "3")).toBeNull();
	});

	it("builds discovery menu text and action keyboard", () => {
		const menu = createMenu();
		const text = buildDiscoveryMenuText(menu, {
			formatDisplayTime: (timestamp) => timestamp,
			truncateMiddle: (value) => value,
		});
		const keyboard = buildDiscoveryMenuKeyboard("menu-1", menu);

		expect(text).toContain("Find: query");
		expect(text).toContain("Filters: Time=All | Source=Any");
		expect(keyboard[0]?.[0]?.callbackData).toBe("sx:v1:find_open:menu-1:1");
		expect(keyboard[0]?.[1]?.callbackData).toBe("sx:v1:find_del:menu-1:1");
	});

	it("builds tag keyboard and parses tag selections", () => {
		const menu = createMenu();
		const tags = collectMenuTags(menu);
		const keyboard = buildTagMenuKeyboard("menu-1", menu);

		expect(tags).toEqual(["a", "b", "common"]);
		expect(keyboard.at(-1)?.[0]?.callbackData).toBe("sx:v1:menu_tag_set:menu-1:0");
		expect(parseTagSelection(menu, "1")).toBe("a");
		expect(parseTagSelection(menu, "2")).toBe("b");
		expect(parseTagSelection(menu, "99")).toBeNull();
	});
});
