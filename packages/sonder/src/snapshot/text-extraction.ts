const TAGS_TO_REMOVE = ["script", "style", "noscript", "svg"];

function decodeHtmlEntities(input: string): string {
	return input
		.replaceAll(/&nbsp;/g, " ")
		.replaceAll(/&amp;/g, "&")
		.replaceAll(/&lt;/g, "<")
		.replaceAll(/&gt;/g, ">")
		.replaceAll(/&quot;/g, '"')
		.replaceAll(/&#39;/g, "'");
}

export function extractReadableTextFromHtml(html: string): string {
	let text = html;

	for (const tag of TAGS_TO_REMOVE) {
		const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
		text = text.replaceAll(pattern, " ");
	}

	text = text.replaceAll(/<[^>]+>/g, " ");
	text = decodeHtmlEntities(text);
	text = text.replaceAll(/\s+/g, " ").trim();
	return text;
}
