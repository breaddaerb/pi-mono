import { describe, expect, it } from "vitest";
import { injectOverlayIntoSnapshotHtml } from "../src/viewer/overlay.js";

describe("viewer overlay", () => {
	it("injects overlay script/style and annotation endpoint for item", () => {
		const html = "<html><body><article>hello world</article></body></html>";
		const output = injectOverlayIntoSnapshotHtml(html, "item-1");

		expect(output).toContain('id="sonder-overlay-style"');
		expect(output).toContain('id="sonder-overlay-script"');
		expect(output).toContain("/viewer/api/items/item-1/annotations");
		expect(output).toContain("window.__sonderOverlayStatus");
		expect(output).toContain("findRangeAcrossTextNodesNormalized");
	});

	it("sanitizes snapshot html before overlay injection", () => {
		const html =
			'<html><body onload="boom()"><script>alert(1)</script><a href="javascript:alert(1)">bad</a></body></html>';
		const output = injectOverlayIntoSnapshotHtml(html, "item-2");

		expect(output).not.toContain("<script>alert(1)</script>");
		expect(output).not.toContain("onload=");
		expect(output).not.toContain("javascript:alert");
		expect(output).toContain("sonder-overlay-script");
	});
});
