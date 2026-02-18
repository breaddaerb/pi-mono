const DISPLAY_TIME_ZONE = "Asia/Shanghai";
const DISPLAY_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
	timeZone: DISPLAY_TIME_ZONE,
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
});

export function formatDisplayTime(timestamp: string): string {
	const parsed = Date.parse(timestamp);
	if (!Number.isFinite(parsed)) {
		return timestamp;
	}
	return `${DISPLAY_TIME_FORMATTER.format(parsed)} (UTC+8)`;
}
