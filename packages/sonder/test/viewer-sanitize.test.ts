import { describe, expect, it } from "vitest";
import { sanitizeSnapshotHtmlForViewer } from "../src/viewer/sanitize.js";

describe("viewer sanitize", () => {
	it("removes scriptable elements and inline event handlers", () => {
		const html =
			"<html><head><meta http-equiv='refresh' content='0;url=https://example.com'></head><body onload=\"boom()\"><script>alert(1)</script><iframe src='https://evil.test'></iframe><div onclick='boom()'>x</div></body></html>";

		const sanitized = sanitizeSnapshotHtmlForViewer(html);

		expect(sanitized).not.toContain("<script");
		expect(sanitized).not.toContain("<iframe");
		expect(sanitized).not.toContain("http-equiv='refresh'");
		expect(sanitized).not.toContain("onload=");
		expect(sanitized).not.toContain("onclick=");
	});

	it("strips dangerous javascript/vbscript url attributes", () => {
		const html =
			"<a href=\"javascript:alert(1)\">a</a><img src='vbscript:msgbox(1)'/><form action=javascript:alert(1)></form><button formaction='javascript:alert(1)'>x</button>";

		const sanitized = sanitizeSnapshotHtmlForViewer(html);

		expect(sanitized).not.toContain("javascript:");
		expect(sanitized).not.toContain("vbscript:");
	});
});
