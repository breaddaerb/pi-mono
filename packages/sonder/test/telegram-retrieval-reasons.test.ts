import { describe, expect, it } from "vitest";
import {
	formatDiscoveryReasonLabel,
	formatDiscoveryReasonSummary,
} from "../src/transport/telegram-retrieval-reasons.js";

describe("telegram retrieval reasons", () => {
	it("maps known internal reason codes to user-facing labels", () => {
		expect(formatDiscoveryReasonLabel("url")).toBe("URL");
		expect(formatDiscoveryReasonLabel("item-note")).toBe("Item notes");
		expect(formatDiscoveryReasonLabel("annotation-tags")).toBe("Annotation tags");
		expect(formatDiscoveryReasonLabel("content")).toBe("Extracted content");
	});

	it("normalizes unknown reasons and formats summary", () => {
		expect(formatDiscoveryReasonLabel("custom_signal_reason")).toBe("Custom signal reason");
		expect(formatDiscoveryReasonSummary(["tags", "custom_signal_reason"])).toBe("Item tags, Custom signal reason");
	});
});
