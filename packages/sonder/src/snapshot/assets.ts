const ASSET_PATTERN = /<(?:img|script|source|video|audio|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi;

function isSkippableAssetUrl(url: string): boolean {
	return url.startsWith("data:") || url.startsWith("javascript:") || url.startsWith("mailto:");
}

export function extractAssetUrls(html: string, pageUrl: string): string[] {
	const found = new Set<string>();
	for (const match of html.matchAll(ASSET_PATTERN)) {
		const candidate = match[1];
		if (!candidate || isSkippableAssetUrl(candidate)) {
			continue;
		}
		try {
			const resolved = new URL(candidate, pageUrl);
			if (resolved.protocol === "http:" || resolved.protocol === "https:") {
				found.add(resolved.toString());
			}
		} catch {
			// Ignore malformed asset URL.
		}
	}
	return [...found];
}
