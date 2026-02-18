import { describe, expect, it } from "vitest";
import { formatDisplayTime } from "../src/transport/telegram-display-time.js";

describe("telegram display time", () => {
	it("formats ISO timestamp using UTC+8 suffix", () => {
		expect(formatDisplayTime("2026-02-18T00:00:00.000Z")).toContain("(UTC+8)");
	});

	it("returns original input for invalid timestamp", () => {
		expect(formatDisplayTime("not-a-date")).toBe("not-a-date");
	});
});
