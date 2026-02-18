import { describe, expect, it } from "vitest";
import {
	formatSortFilter,
	formatSourceFilter,
	formatTimeFilter,
	parseSortFilter,
	parseSourceFilter,
	parseTagPage,
	parseTimeFilter,
} from "../src/transport/telegram-discovery-filters.js";

describe("telegram discovery filters", () => {
	it("formats filter labels", () => {
		expect(formatTimeFilter("all")).toBe("All");
		expect(formatTimeFilter("today")).toBe("Today");
		expect(formatSourceFilter("any")).toBe("Any");
		expect(formatSourceFilter("web")).toBe("Web");
		expect(formatSortFilter("newest")).toBe("Newest");
		expect(formatSortFilter("oldest")).toBe("Oldest");
	});

	it("parses time/source/sort filters", () => {
		expect(parseTimeFilter("0")).toBe("all");
		expect(parseTimeFilter("4")).toBe("year");
		expect(parseTimeFilter("x")).toBeNull();
		expect(parseSourceFilter("0")).toBe("any");
		expect(parseSourceFilter("1")).toBe("web");
		expect(parseSourceFilter("2")).toBeNull();
		expect(parseSortFilter("0")).toBe("newest");
		expect(parseSortFilter("1")).toBe("oldest");
		expect(parseSortFilter("3")).toBeNull();
	});

	it("wraps and clamps tag page selection", () => {
		expect(parseTagPage("-1", 3)).toBe(2);
		expect(parseTagPage("0", 3)).toBe(0);
		expect(parseTagPage("3", 3)).toBe(0);
		expect(parseTagPage("abc", 3)).toBe(0);
		expect(parseTagPage("1", 0)).toBe(0);
	});
});
