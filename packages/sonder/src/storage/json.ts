export function toJsonString(value: string[]): string {
	return JSON.stringify(value);
}

export function parseStringArray(json: string): string[] {
	const parsed: unknown = JSON.parse(json);
	if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
		throw new Error("Expected JSON string array");
	}
	return parsed;
}
