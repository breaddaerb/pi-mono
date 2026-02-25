import { readFileSync } from "node:fs";
import type { ArtifactsRepo, ItemContentRepo } from "../storage/index.js";
import type { Artifact, Item, ItemContent } from "../types.js";
import { canonicalizeMarkdownV1, htmlToMarkdownV1, plainTextToMarkdownV1 } from "./canonical-markdown.js";

export const CANONICAL_MARKDOWN_VERSION = 1;

interface CanonicalSource {
	rawType: ItemContent["rawType"];
	rawBlobPath: string | null;
	canonicalMd: string;
}

export interface EnsureCanonicalContentOptions {
	item: Item;
	artifactsRepo: ArtifactsRepo;
	itemContentRepo: ItemContentRepo;
	now?: () => Date;
}

export function ensureCanonicalContent(options: EnsureCanonicalContentOptions): ItemContent {
	const existing = options.itemContentRepo.findByItemId(options.item.id);
	if (existing) {
		return existing;
	}

	const artifacts = options.artifactsRepo.listByItemId(options.item.id);
	const source = selectCanonicalSource(options.item, artifacts);
	const generatedAt = (options.now ?? (() => new Date()))().toISOString();
	const content: ItemContent = {
		itemId: options.item.id,
		canonicalMd: source.canonicalMd,
		canonicalVersion: CANONICAL_MARKDOWN_VERSION,
		canonicalGeneratedAt: generatedAt,
		rawType: source.rawType,
		rawBlobPath: source.rawBlobPath,
		rawUrl: options.item.originalUrl,
		fetchedAt: options.item.createdAt,
	};
	options.itemContentRepo.upsert(content);
	return content;
}

export function generateCanonicalContentForItem(item: Item, artifacts: Artifact[]): ItemContent {
	const source = selectCanonicalSource(item, artifacts);
	return {
		itemId: item.id,
		canonicalMd: source.canonicalMd,
		canonicalVersion: CANONICAL_MARKDOWN_VERSION,
		canonicalGeneratedAt: item.createdAt,
		rawType: source.rawType,
		rawBlobPath: source.rawBlobPath,
		rawUrl: item.originalUrl,
		fetchedAt: item.createdAt,
	};
}

function selectCanonicalSource(item: Item, artifacts: Artifact[]): CanonicalSource {
	const evidenceArtifact = artifacts.find((artifact) => artifact.kind === "evidence-md") ?? null;
	if (evidenceArtifact) {
		const evidence = readUtf8Safe(evidenceArtifact.path);
		return {
			rawType: "text",
			rawBlobPath: evidenceArtifact.path,
			canonicalMd: canonicalizeMarkdownV1(evidence),
		};
	}

	const snapshotArtifact = artifacts.find((artifact) => artifact.kind === "snapshot-html") ?? null;
	if (snapshotArtifact) {
		const html = readUtf8Safe(snapshotArtifact.path);
		return {
			rawType: "html",
			rawBlobPath: snapshotArtifact.path,
			canonicalMd: htmlToMarkdownV1(html, item.originalUrl),
		};
	}

	const extractedArtifact = artifacts.find((artifact) => artifact.kind === "extracted-text") ?? null;
	if (extractedArtifact) {
		const extracted = readUtf8Safe(extractedArtifact.path);
		return {
			rawType: "text",
			rawBlobPath: extractedArtifact.path,
			canonicalMd: plainTextToMarkdownV1(extracted),
		};
	}

	return {
		rawType: "text",
		rawBlobPath: null,
		canonicalMd: "",
	};
}

function readUtf8Safe(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}
