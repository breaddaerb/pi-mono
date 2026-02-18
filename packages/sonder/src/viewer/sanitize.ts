function stripInlineEventHandlers(html: string): string {
	return html.replaceAll(/\son[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function decodeNumericHtmlEntities(value: string): string {
	return value
		.replaceAll(/&#x([0-9a-f]+);?/gi, (_match, hexValue: string) => {
			const codePoint = Number.parseInt(hexValue, 16);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
		})
		.replaceAll(/&#([0-9]+);?/g, (_match, decimalValue: string) => {
			const codePoint = Number.parseInt(decimalValue, 10);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
		})
		.replaceAll(/&colon;/gi, ":");
}

function isDangerousUrlValue(value: string): boolean {
	const decoded = decodeNumericHtmlEntities(value);
	const normalized = decoded
		.replaceAll(/[\u0000-\u0020\u007f]+/g, "")
		.trim()
		.toLowerCase();
	return normalized.startsWith("javascript:") || normalized.startsWith("vbscript:");
}

function stripDangerousUrlAttributes(html: string): string {
	const urlAttributePattern = /\s(href|src|xlink:href|formaction|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
	return html.replaceAll(
		urlAttributePattern,
		(match, _attributeName: string, doubleQuoted: string, singleQuoted: string, unquoted: string) => {
			const value = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
			return isDangerousUrlValue(value) ? "" : match;
		},
	);
}

export function sanitizeSnapshotHtmlForViewer(html: string): string {
	let sanitized = html;
	sanitized = sanitized.replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
	sanitized = sanitized.replaceAll(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");
	sanitized = sanitized.replaceAll(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "");
	sanitized = sanitized.replaceAll(/<meta\b[^>]*http-equiv=["']?refresh["']?[^>]*>/gi, "");
	sanitized = stripInlineEventHandlers(sanitized);
	sanitized = stripDangerousUrlAttributes(sanitized);
	return sanitized;
}
