function stripInlineEventHandlers(html: string): string {
	return html.replaceAll(/\son[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function stripDangerousUrlAttributes(html: string): string {
	let sanitized = html;
	sanitized = sanitized.replaceAll(
		/\s(?:href|src|xlink:href|formaction|action)\s*=\s*"\s*(?:javascript|vbscript):[^"]*"/gi,
		"",
	);
	sanitized = sanitized.replaceAll(
		/\s(?:href|src|xlink:href|formaction|action)\s*=\s*'\s*(?:javascript|vbscript):[^']*'/gi,
		"",
	);
	sanitized = sanitized.replaceAll(
		/\s(?:href|src|xlink:href|formaction|action)\s*=\s*(?:javascript|vbscript):[^\s>]+/gi,
		"",
	);
	return sanitized;
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
