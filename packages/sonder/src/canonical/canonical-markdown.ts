const BLOCK_BREAK = "\n\n";

const STRIP_BLOCK_TAGS = ["script", "style", "noscript", "svg", "iframe", "nav", "header", "footer", "aside"];

const BLOCK_LEVEL_TAGS = [
	"html",
	"body",
	"article",
	"section",
	"main",
	"div",
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"li",
	"blockquote",
	"table",
	"thead",
	"tbody",
	"tr",
	"td",
	"th",
	"hr",
];

export function canonicalizeMarkdownV1(input: string): string {
	const normalizedNewlines = input.replace(/\r\n?/g, "\n");
	const withoutTrailingWhitespace = normalizedNewlines
		.split("\n")
		.map((line) => line.replace(/[\t ]+$/g, ""))
		.join("\n");
	const collapsedBlankLines = withoutTrailingWhitespace.replace(/\n{3,}/g, "\n\n");
	return collapsedBlankLines.trim();
}

export function plainTextToMarkdownV1(input: string): string {
	return canonicalizeMarkdownV1(input);
}

export function htmlToMarkdownV1(html: string, baseUrl: string): string {
	let text = html.replace(/\r\n?/g, "\n");
	text = text.replace(/<!--[\s\S]*?-->/g, " ");

	for (const tag of STRIP_BLOCK_TAGS) {
		const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
		text = text.replace(pattern, " ");
	}

	const codeBlocks: string[] = [];
	text = text.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_match, inner: string) => {
		const strippedCode = inner.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "$1");
		const decoded = decodeHtmlEntities(stripTags(strippedCode));
		const normalizedCode = decoded
			.replace(/\u00a0/g, " ")
			.replace(/\r\n?/g, "\n")
			.trim();
		const placeholder = `@@SONDER_CODE_BLOCK_${codeBlocks.length}@@`;
		codeBlocks.push(`\`\`\`\n${normalizedCode}\n\`\`\``);
		return `${BLOCK_BREAK}${placeholder}${BLOCK_BREAK}`;
	});

	text = text.replace(/<br\s*\/?>/gi, "\n");

	text = text.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, attributes: string, inner: string) => {
		const href = parseAttribute(attributes, "href");
		const linkText = normalizeInlineText(inner);
		if (!href) {
			return linkText;
		}
		const resolvedHref = resolveUrl(href, baseUrl);
		const finalText = linkText.length > 0 ? linkText : resolvedHref;
		return `[${escapeMarkdownText(finalText)}](${resolvedHref})`;
	});

	text = text.replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, headingTag: string, inner: string) => {
		const level = Number.parseInt(headingTag.slice(1), 10);
		const headingText = normalizeInlineText(inner);
		if (!headingText) {
			return "";
		}
		const safeLevel = Number.isFinite(level) ? Math.max(1, Math.min(6, level)) : 1;
		return `${BLOCK_BREAK}${"#".repeat(safeLevel)} ${headingText}${BLOCK_BREAK}`;
	});

	text = text.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, inner: string) => {
		const quoted = normalizeInlineText(inner);
		if (!quoted) {
			return "";
		}
		const lines = quoted
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.map((line) => `> ${line}`)
			.join("\n");
		return `${BLOCK_BREAK}${lines}${BLOCK_BREAK}`;
	});

	text = text.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, inner: string) => {
		const item = normalizeInlineText(inner);
		return item.length > 0 ? `\n- ${item}` : "";
	});
	text = text.replace(/<\/?(?:ul|ol)\b[^>]*>/gi, "\n");

	text = text.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_match, inner: string) => {
		const paragraph = normalizeInlineText(inner);
		return paragraph.length > 0 ? `${BLOCK_BREAK}${paragraph}${BLOCK_BREAK}` : "";
	});

	text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, inner: string) => {
		const inlineCode = normalizeInlineText(inner);
		return inlineCode.length > 0 ? `\`${inlineCode}\`` : "";
	});

	text = replaceBlockBoundaries(text);
	text = stripTags(text);
	text = decodeHtmlEntities(text);

	for (const [index, codeBlock] of codeBlocks.entries()) {
		text = text.replace(`@@SONDER_CODE_BLOCK_${index}@@`, codeBlock);
	}

	return canonicalizeMarkdownV1(text);
}

function replaceBlockBoundaries(input: string): string {
	let output = input;
	for (const tag of BLOCK_LEVEL_TAGS) {
		const pattern = new RegExp(`</?${tag}\\b[^>]*>`, "gi");
		output = output.replace(pattern, BLOCK_BREAK);
	}
	return output;
}

function normalizeInlineText(input: string): string {
	const decoded = decodeHtmlEntities(stripTags(input)).replace(/\u00a0/g, " ");
	return decoded.replace(/\s+/g, " ").trim().replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function stripTags(input: string): string {
	return input.replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(input: string): string {
	return input
		.replaceAll(/&#x([0-9a-f]+);?/gi, (_match, hexValue: string) => {
			const codePoint = Number.parseInt(hexValue, 16);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
		})
		.replaceAll(/&#([0-9]+);?/g, (_match, decimalValue: string) => {
			const codePoint = Number.parseInt(decimalValue, 10);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
		})
		.replaceAll(/&nbsp;/gi, " ")
		.replaceAll(/&amp;/gi, "&")
		.replaceAll(/&lt;/gi, "<")
		.replaceAll(/&gt;/gi, ">")
		.replaceAll(/&quot;/gi, '"')
		.replaceAll(/&#39;/gi, "'");
}

function parseAttribute(attributes: string, name: string): string | null {
	const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
	const match = attributes.match(pattern);
	if (!match) {
		return null;
	}
	const value = match[1] ?? match[2] ?? match[3] ?? "";
	const trimmed = decodeHtmlEntities(value).trim();
	return trimmed.length > 0 ? trimmed : null;
}

function resolveUrl(url: string, baseUrl: string): string {
	try {
		return new URL(url, baseUrl).toString();
	} catch {
		return url;
	}
}

function escapeMarkdownText(input: string): string {
	return input.replaceAll("[", "\\[").replaceAll("]", "\\]");
}
