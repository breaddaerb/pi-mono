export type TimeFilter = "all" | "today" | "7d" | "30d" | "year";
export type SourceFilter = "any" | "web";
export type SortFilter = "newest" | "oldest";

export function formatTimeFilter(filter: TimeFilter): string {
	if (filter === "today") return "Today";
	if (filter === "7d") return "Last 7d";
	if (filter === "30d") return "Last 30d";
	if (filter === "year") return "This year";
	return "All";
}

export function formatSourceFilter(filter: SourceFilter): string {
	return filter === "web" ? "Web" : "Any";
}

export function formatSortFilter(filter: SortFilter): string {
	return filter === "oldest" ? "Oldest" : "Newest";
}

export function parseTimeFilter(argument: string): TimeFilter | null {
	if (argument === "0") return "all";
	if (argument === "1") return "today";
	if (argument === "2") return "7d";
	if (argument === "3") return "30d";
	if (argument === "4") return "year";
	return null;
}

export function parseSourceFilter(argument: string): SourceFilter | null {
	if (argument === "0") return "any";
	if (argument === "1") return "web";
	return null;
}

export function parseSortFilter(argument: string): SortFilter | null {
	if (argument === "0") return "newest";
	if (argument === "1") return "oldest";
	return null;
}

export function parseTagPage(argument: string, totalPages: number): number {
	const parsed = Number.parseInt(argument, 10);
	if (!Number.isFinite(parsed)) {
		return 0;
	}
	if (totalPages <= 0) {
		return 0;
	}
	if (parsed < 0) {
		return totalPages - 1;
	}
	if (parsed >= totalPages) {
		return 0;
	}
	return parsed;
}
