import type { AnnotationsRepo } from "../storage/annotations-repo.js";
import type { ItemContentRepo } from "../storage/item-content-repo.js";
import type { ItemsRepo } from "../storage/items-repo.js";
import type { ItemSourceType } from "../types.js";

export interface DiscoveryListItem {
	id: string;
	createdAt: string;
	sourceType: ItemSourceType;
	originalUrl: string;
	tags: string[];
}

export interface DiscoveryFindItem {
	id: string;
	createdAt: string;
	sourceType: ItemSourceType;
	originalUrl: string;
	tags: string[];
	score: number;
	reasons: string[];
	snippets: string[];
}

export interface DiscoveryServiceOptions {
	itemsRepo: ItemsRepo;
	itemContentRepo: ItemContentRepo;
	annotationsRepo: AnnotationsRepo;
}

export class DiscoveryService {
	constructor(private readonly options: DiscoveryServiceOptions) {}

	listItems(limit: number): DiscoveryListItem[] {
		return this.options.itemsRepo.listRecent(limit).map((item) => ({
			id: item.id,
			createdAt: item.createdAt,
			sourceType: item.sourceType,
			originalUrl: item.originalUrl,
			tags: item.tags,
		}));
	}

	findItems(query: string, limit: number): DiscoveryFindItem[] {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery) {
			return [];
		}
		const queryTerms = this.extractQueryTerms(normalizedQuery);
		if (queryTerms.length === 0) {
			return [];
		}
		const items = this.options.itemsRepo.listRecent(500);
		const scored: DiscoveryFindItem[] = [];

		for (const item of items) {
			let score = 0;
			const reasonSet = new Set<string>();
			const snippets: string[] = [];

			const urlMatches = this.collectMatchedTerms(item.originalUrl.toLowerCase(), queryTerms);
			if (urlMatches.length > 0) {
				score += urlMatches.length * 5;
				if (item.originalUrl.toLowerCase().includes(normalizedQuery)) {
					score += 3;
				}
				reasonSet.add("url");
				this.pushSnippet(snippets, "url", item.originalUrl, urlMatches);
			}

			const tagsText = item.tags.join(" ");
			const tagMatches = this.collectMatchedTerms(tagsText.toLowerCase(), queryTerms);
			if (tagMatches.length > 0) {
				score += tagMatches.length * 7;
				reasonSet.add("tags");
				this.pushSnippet(snippets, "tags", tagsText, tagMatches);
			}

			const noteText = [item.whyNote, item.topic, item.space]
				.filter((part): part is string => Boolean(part))
				.join(" ");
			if (noteText.length > 0) {
				const noteMatches = this.collectMatchedTerms(noteText.toLowerCase(), queryTerms);
				if (noteMatches.length > 0) {
					score += noteMatches.length * 6;
					reasonSet.add("item-note");
					this.pushSnippet(snippets, "item-note", noteText, noteMatches);
				}
			}

			const annotations = this.options.annotationsRepo.listByItemId(item.id);
			for (const annotation of annotations) {
				const annotationText = `${annotation.text ?? ""} ${annotation.comment ?? ""}`.trim();
				if (annotationText.length > 0) {
					const annotationMatches = this.collectMatchedTerms(annotationText.toLowerCase(), queryTerms);
					if (annotationMatches.length > 0) {
						score += annotationMatches.length * 10;
						reasonSet.add("annotations");
						this.pushSnippet(snippets, "annotations", annotationText, annotationMatches);
					}
				}

				const annotationTagText = annotation.tags.join(" ");
				if (annotationTagText.length > 0) {
					const annotationTagMatches = this.collectMatchedTerms(annotationTagText.toLowerCase(), queryTerms);
					if (annotationTagMatches.length > 0) {
						score += annotationTagMatches.length * 8;
						reasonSet.add("annotation-tags");
						this.pushSnippet(snippets, "annotation-tags", annotationTagText, annotationTagMatches);
					}
				}
			}

			const canonicalContent = this.readCanonicalTextForItem(item.id);
			if (canonicalContent.length > 0) {
				const contentMatches = this.collectMatchedTerms(canonicalContent.toLowerCase(), queryTerms);
				if (contentMatches.length > 0) {
					score += contentMatches.length * 2;
					if (canonicalContent.toLowerCase().includes(normalizedQuery)) {
						score += 2;
					}
					reasonSet.add("content");
					this.pushSnippet(snippets, "content", canonicalContent, contentMatches);
				}
			}

			if (score <= 0) {
				continue;
			}

			scored.push({
				id: item.id,
				createdAt: item.createdAt,
				sourceType: item.sourceType,
				originalUrl: item.originalUrl,
				tags: item.tags,
				score,
				reasons: [...reasonSet],
				snippets,
			});
		}

		scored.sort(
			(left, right) =>
				right.score - left.score ||
				right.originalUrl.localeCompare(left.originalUrl) ||
				right.id.localeCompare(left.id),
		);
		return scored.slice(0, Math.max(1, Math.floor(limit)));
	}

	private readCanonicalTextForItem(itemId: string): string {
		const content = this.options.itemContentRepo.findByItemId(itemId);
		if (!content) {
			return "";
		}
		return content.canonicalMd;
	}

	private extractQueryTerms(query: string): string[] {
		const tokens = query
			.toLowerCase()
			.split(/[^\p{L}\p{N}_-]+/u)
			.map((token) => token.trim())
			.filter((token) => token.length >= 2);
		return [...new Set(tokens)];
	}

	private collectMatchedTerms(textLower: string, queryTerms: string[]): string[] {
		return queryTerms.filter((term) => textLower.includes(term));
	}

	private pushSnippet(snippets: string[], label: string, sourceText: string, matchedTerms: string[]): void {
		if (snippets.length >= 3 || matchedTerms.length === 0) {
			return;
		}
		const snippet = this.buildSnippet(sourceText, matchedTerms);
		if (!snippet) {
			return;
		}
		snippets.push(`${label}: ${snippet}`);
	}

	private buildSnippet(sourceText: string, matchedTerms: string[]): string | null {
		const compact = sourceText.replace(/\s+/g, " ").trim();
		if (!compact) {
			return null;
		}

		const lower = compact.toLowerCase();
		let matchIndex = -1;
		let matchLength = 0;
		for (const term of matchedTerms) {
			const index = lower.indexOf(term.toLowerCase());
			if (index >= 0) {
				matchIndex = index;
				matchLength = term.length;
				break;
			}
		}

		if (matchIndex < 0) {
			return compact.length <= 96 ? compact : `${compact.slice(0, 93)}...`;
		}

		const start = Math.max(0, matchIndex - 28);
		const end = Math.min(compact.length, matchIndex + matchLength + 48);
		const window = compact.slice(start, end).trim();
		const prefixed = start > 0 ? `...${window}` : window;
		const suffixed = end < compact.length ? `${prefixed}...` : prefixed;
		return suffixed.length <= 100 ? suffixed : `${suffixed.slice(0, 97)}...`;
	}
}
