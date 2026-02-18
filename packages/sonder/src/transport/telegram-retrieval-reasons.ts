const DISCOVERY_REASON_LABELS: Record<string, string> = {
	url: "URL",
	tags: "Item tags",
	"item-note": "Item notes",
	annotations: "Annotations",
	"annotation-tags": "Annotation tags",
	content: "Extracted content",
};

function normalizeUnknownReason(reason: string): string {
	const compact = reason.replaceAll(/[-_]+/g, " ").trim();
	if (!compact) {
		return "Unknown";
	}
	return compact.slice(0, 1).toUpperCase() + compact.slice(1);
}

export function formatDiscoveryReasonLabel(reason: string): string {
	return DISCOVERY_REASON_LABELS[reason] ?? normalizeUnknownReason(reason);
}

export function formatDiscoveryReasonSummary(reasons: string[]): string {
	return reasons.map((reason) => formatDiscoveryReasonLabel(reason)).join(", ");
}
