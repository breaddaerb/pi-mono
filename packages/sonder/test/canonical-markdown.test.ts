import { describe, expect, it } from "vitest";
import { canonicalizeMarkdownV1, htmlToMarkdownV1 } from "../src/canonical/index.js";

describe("canonical markdown", () => {
	it("is deterministic and idempotent", () => {
		const input = "Line one\r\n\r\n\r\nLine two   \n\n\nLine three\t";
		const first = canonicalizeMarkdownV1(input);
		const second = canonicalizeMarkdownV1(input);
		const third = canonicalizeMarkdownV1(first);
		expect(first).toBe(second);
		expect(third).toBe(first);
		expect(first).toBe("Line one\n\nLine two\n\nLine three");
	});

	it("converts html into stable markdown with links, lists, and code", () => {
		const html = `
			<html>
				<body>
					<h2>Sample</h2>
					<p>Visit <a href="/docs/start">docs</a> now.</p>
					<ul><li>First item</li><li>Second item</li></ul>
					<pre><code>const a = 1;\nconsole.log(a);</code></pre>
				</body>
			</html>
		`;
		const markdown = htmlToMarkdownV1(html, "https://example.com/page");
		expect(markdown).toContain("## Sample");
		expect(markdown).toContain("Visit [docs](https://example.com/docs/start) now.");
		expect(markdown).toContain("- First item");
		expect(markdown).toContain("- Second item");
		expect(markdown).toContain("```\nconst a = 1;\nconsole.log(a);\n```");
	});

	it("adds stable paragraph/line splits for irregular nested block html", () => {
		const html =
			"<div><span>First line</span></div><div><span>Second line</span></div><section><span>Third line</span></section>";
		const markdown = htmlToMarkdownV1(html, "https://example.com");
		expect(markdown).toContain("First line\n\nSecond line\n\nThird line");
	});

	it("does not collapse whole article wrappers into one line", () => {
		const html = "<article><h1>Title</h1><p>Paragraph one.</p><p>Paragraph two.</p></article>";
		const markdown = htmlToMarkdownV1(html, "https://example.com");
		expect(markdown).toContain("# Title\n\nParagraph one.\n\nParagraph two.");
	});
});
