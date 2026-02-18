export function stripTelegramCommandMention(text: string): string {
	const trimmed = text.trim();
	if (!trimmed.startsWith("/")) {
		return text;
	}
	const firstSpace = trimmed.indexOf(" ");
	const commandToken = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
	const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace);
	const mentionIndex = commandToken.indexOf("@");
	if (mentionIndex === -1) {
		return trimmed;
	}
	const commandWithoutMention = commandToken.slice(0, mentionIndex);
	return `${commandWithoutMention}${rest}`;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Aborted"));
			return;
		}

		let settled = false;
		const onAbort = () => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
			reject(new Error("Aborted"));
		};

		const timeout = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);

		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
