export function extractUrlAndPastedText(text: string): { url: string; pastedText: string | null } | null {
	const urlMatch = text.match(/https?:\/\/\S+/i);
	if (!urlMatch) {
		return null;
	}
	const rawUrl = urlMatch[0];
	let normalizedUrl: string;
	try {
		const parsed = new URL(rawUrl);
		normalizedUrl = parsed.toString();
	} catch {
		return null;
	}
	const before = text.slice(0, urlMatch.index ?? 0).trim();
	const after = text.slice((urlMatch.index ?? 0) + rawUrl.length).trim();
	const pastedRaw = [before, after]
		.filter((part) => part.length > 0)
		.join("\n")
		.trim();
	return {
		url: normalizedUrl,
		pastedText: pastedRaw.length > 0 ? pastedRaw : null,
	};
}
