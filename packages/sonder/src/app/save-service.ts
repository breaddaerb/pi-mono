import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CANONICAL_MARKDOWN_VERSION, htmlToMarkdownV1, plainTextToMarkdownV1 } from "../canonical/index.js";
import {
	captureFromSource,
	isAuthEligibleDomain,
	normalizeAuthDomain,
	type SourceAcquisitionMethod,
	type SourcePlatform,
	type SourceStatus,
} from "../sources/index.js";
import { cleanExtractedTextForPlatform } from "../sources/utils.js";
import type { ArtifactsRepo } from "../storage/artifacts-repo.js";
import type { CaptureAttemptRepo } from "../storage/capture-attempt-repo.js";
import type { ItemContentRepo } from "../storage/item-content-repo.js";
import type { ItemProvenanceRepo } from "../storage/item-provenance-repo.js";
import type { ItemsRepo } from "../storage/items-repo.js";
import type { Artifact, CaptureAttempt, EvidenceConfidence, Item, ItemContent, ItemProvenance } from "../types.js";

export type SaveSourceStatus = SourceStatus;
export type SaveSourceAcquisitionMethod = SourceAcquisitionMethod;
export type SaveSourcePlatform = SourcePlatform;
export type SaveEvidenceType = "snapshot" | "pasted_text" | "fallback_text";

export interface SaveInput {
	url: string;
	tags: string[];
	pastedText: string | null;
}

export interface SaveResult {
	itemId: string;
	usedFallback: boolean;
	artifactIds: string[];
	url: string;
	tags: string[];
	sourcePlatform: SaveSourcePlatform;
	sourceAcquisitionMethod: SaveSourceAcquisitionMethod;
	sourceStatus: SaveSourceStatus;
	sourceStatusReason: string | null;
	evidenceType: SaveEvidenceType;
	needsUserEvidence: boolean;
}

export interface SaveServiceOptions {
	database: DatabaseSync;
	itemsRepo: ItemsRepo;
	artifactsRepo: ArtifactsRepo;
	captureAttemptRepo: CaptureAttemptRepo;
	itemProvenanceRepo: ItemProvenanceRepo;
	itemContentRepo: ItemContentRepo;
	dataRootDir: string;
	now?: () => Date;
	snapshotFetchImpl?: typeof fetch;
	loadAuthStorageStateForDomain?: (domain: string) => string | null;
}

export class SaveService {
	constructor(private readonly options: SaveServiceOptions) {}

	async save(input: SaveInput): Promise<SaveResult> {
		const now = this.getNowIsoString();
		const itemId = randomUUID();
		const item: Item = {
			id: itemId,
			createdAt: now,
			sourceType: "web",
			originalUrl: input.url,
			whyNote: null,
			tags: input.tags,
			topic: null,
			space: null,
		};
		const itemDirectory = join(this.options.dataRootDir, "items", itemId);

		try {
			const authStorageStateJson = this.resolveAuthStorageStateForUrl(input.url);
			const sourceCapture = await captureFromSource({
				itemId,
				url: input.url,
				dataRootDir: this.options.dataRootDir,
				fetchImpl: this.options.snapshotFetchImpl,
				authStorageStateJson,
			});
			const snapshot = sourceCapture.snapshot;
			const acquisitionReportPath = join(snapshot.itemDirectory, "acquisition-report.json");
			writeFileSync(
				acquisitionReportPath,
				JSON.stringify(
					{
						itemId,
						inputUrl: input.url,
						platform: sourceCapture.platform,
						winnerMethod: sourceCapture.acquisitionMethod,
						winnerStatus: sourceCapture.status,
						attempts: sourceCapture.attempts,
					},
					null,
					2,
				),
				"utf8",
			);

			const normalizedPastedText = this.normalizePastedText(input.pastedText);
			const autoDerivedEvidenceText = this.deriveAutoEvidenceText({
				platform: sourceCapture.platform,
				usable: sourceCapture.usable,
				extractedTextPath: snapshot.extractedTextPath,
			});
			const effectiveEvidenceText = normalizedPastedText ?? autoDerivedEvidenceText;
			const usePastedEvidence =
				Boolean(effectiveEvidenceText) &&
				(!sourceCapture.usable || this.shouldPreferPastedEvidenceForPlatform(sourceCapture.platform));

			let extractedTextPath = snapshot.extractedTextPath;
			let evidenceMdPath: string | null = null;
			if (usePastedEvidence && effectiveEvidenceText) {
				evidenceMdPath = join(snapshot.itemDirectory, "evidence.md");
				extractedTextPath = join(snapshot.itemDirectory, "evidence-extracted.txt");
				writeFileSync(evidenceMdPath, effectiveEvidenceText, "utf8");
				writeFileSync(extractedTextPath, effectiveEvidenceText, "utf8");
			}

			const artifactsToPersist: Artifact[] = [];
			artifactsToPersist.push(
				this.createArtifact(itemId, "snapshot-assets", snapshot.snapshotAssetsDirectory, "application/json"),
			);
			artifactsToPersist.push(this.createArtifact(itemId, "extracted-text", extractedTextPath, "text/plain"));
			artifactsToPersist.push(
				this.createArtifact(itemId, "acquisition-report", acquisitionReportPath, "application/json"),
			);

			if (snapshot.snapshotHtmlPath && !usePastedEvidence) {
				artifactsToPersist.push(
					this.createArtifact(itemId, "snapshot-html", snapshot.snapshotHtmlPath, "text/html"),
				);
			}

			if (evidenceMdPath) {
				artifactsToPersist.push(this.createArtifact(itemId, "evidence-md", evidenceMdPath, "text/markdown"));
			}

			if (snapshot.screenshotFallbackPath && !usePastedEvidence) {
				artifactsToPersist.push(
					this.createArtifact(itemId, "screenshot-fallback", snapshot.screenshotFallbackPath, "text/plain"),
				);
			}
			const evidenceType: SaveEvidenceType = usePastedEvidence
				? "pasted_text"
				: sourceCapture.usable
					? "snapshot"
					: "fallback_text";

			const canonicalContent = this.createCanonicalContent({
				item,
				evidenceMdPath,
				extractedTextPath,
				snapshotHtmlPath: snapshot.snapshotHtmlPath,
			});
			const captureAttempts = this.buildCaptureAttempts(itemId, sourceCapture);
			const itemProvenance = this.buildItemProvenance({
				item,
				sourceCapture,
				evidenceType,
				captureAttempts,
			});

			this.withTransaction(() => {
				this.options.itemsRepo.create(item);
				for (const artifact of artifactsToPersist) {
					this.options.artifactsRepo.create(artifact);
				}
				for (const captureAttempt of captureAttempts) {
					this.options.captureAttemptRepo.create(captureAttempt);
				}
				this.options.itemProvenanceRepo.upsert(itemProvenance);
				this.options.itemContentRepo.upsert(canonicalContent);
			});

			return {
				itemId,
				usedFallback: snapshot.usedFallback,
				artifactIds: artifactsToPersist.map((artifact) => artifact.id),
				url: input.url,
				tags: input.tags,
				sourcePlatform: sourceCapture.platform,
				sourceAcquisitionMethod: sourceCapture.acquisitionMethod,
				sourceStatus: sourceCapture.status,
				sourceStatusReason: sourceCapture.reasonHint ?? sourceCapture.reason,
				evidenceType,
				needsUserEvidence: !sourceCapture.usable && !usePastedEvidence,
			};
		} catch (error) {
			rmSync(itemDirectory, { recursive: true, force: true });
			throw error;
		}
	}

	private shouldPreferPastedEvidenceForPlatform(platform: SaveSourcePlatform): boolean {
		return platform === "twitter" || platform === "wechat";
	}

	private normalizePastedText(text: string | null): string | null {
		if (!text) {
			return null;
		}
		const normalized = text.replace(/\r\n/g, "\n").trim();
		return normalized.length > 0 ? normalized : null;
	}

	private deriveAutoEvidenceText(input: {
		platform: SaveSourcePlatform;
		usable: boolean;
		extractedTextPath: string;
	}): string | null {
		if (input.usable) {
			return null;
		}
		if (input.platform !== "xiaohongshu") {
			return null;
		}
		try {
			const rawText = readFileSync(input.extractedTextPath, "utf8");
			const cleaned = cleanExtractedTextForPlatform(input.platform, rawText).trim();
			if (cleaned.length >= 60) {
				return cleaned;
			}
			const fallbackCleaned = rawText
				.replaceAll(/沪ICP备\d+号?|沪B2-\d+|网信算备\d+号|沪网文\(\d{4}\)\d+-\d+号/gi, " ")
				.replaceAll(/\(沪\)网械平台备字\[\d{4}\]第\d+号|\(沪\)-经营性-\d{4}-\d+/gi, " ")
				.replaceAll(/上海市互联网举报中心|网上有害信息举报专区|行吟信息科技（上海）有限公司/gi, " ")
				.replaceAll(/地址：上海市黄浦区马当路388号C座|电话：\d+-\d+/gi, " ")
				.replaceAll(/©\s*\d{4}\s*-\s*\d{4}/gi, " ")
				.replaceAll(/小红书|创作中心|业务合作|发现|发布|通知|登录|更多/gi, " ")
				.replaceAll(/\s+/g, " ")
				.trim();
			if (fallbackCleaned.length < 60) {
				return null;
			}
			return fallbackCleaned;
		} catch {
			return null;
		}
	}

	private resolveAuthStorageStateForUrl(url: string): string | null {
		if (!this.options.loadAuthStorageStateForDomain) {
			return null;
		}
		if (!isAuthEligibleDomain(url)) {
			return null;
		}
		const domain = normalizeAuthDomain(url);
		if (!domain) {
			return null;
		}
		try {
			return this.options.loadAuthStorageStateForDomain(domain);
		} catch {
			return null;
		}
	}

	private buildCaptureAttempts(
		itemId: string,
		sourceCapture: {
			attempts: Array<{
				method: SaveSourceAcquisitionMethod;
				inputUrl: string;
				effectiveUrl: string;
				status: SaveSourceStatus;
				reasonCode: string | null;
				reasonHint: string | null;
				artifacts: { text?: string; markdown?: string; html?: string };
				debug: {
					httpStatus: number | null;
					contentType: string | null;
					finalUrl: string | null;
					redirectChain: string[];
				} | null;
			}>;
		},
	): CaptureAttempt[] {
		return sourceCapture.attempts.map((attempt, index) => ({
			id: randomUUID(),
			itemId,
			attemptOrder: index + 1,
			attemptType: attempt.method,
			requestUrl: attempt.effectiveUrl,
			status: attempt.status,
			reason: attempt.reasonHint ?? attempt.reasonCode,
			httpStatus: attempt.debug?.httpStatus ?? null,
			latencyMs: null,
			metaJson: JSON.stringify({
				inputUrl: attempt.inputUrl,
				effectiveUrl: attempt.effectiveUrl,
				reasonCode: attempt.reasonCode,
				reasonHint: attempt.reasonHint,
				artifacts: attempt.artifacts,
				debug: attempt.debug,
			}),
			createdAt: this.getNowIsoString(),
		}));
	}

	private buildItemProvenance(input: {
		item: Item;
		sourceCapture: {
			acquisitionMethod: SaveSourceAcquisitionMethod;
			status: SaveSourceStatus;
		};
		evidenceType: SaveEvidenceType;
		captureAttempts: CaptureAttempt[];
	}): ItemProvenance {
		const winnerAttempt =
			input.captureAttempts.find((attempt) => attempt.attemptType === input.sourceCapture.acquisitionMethod) ?? null;
		return {
			itemId: input.item.id,
			originalUrl: input.item.originalUrl,
			captureMethod: input.sourceCapture.acquisitionMethod,
			winnerAttemptId: winnerAttempt?.id ?? null,
			evidenceConfidence: this.classifyEvidenceConfidence(input.evidenceType, input.sourceCapture.acquisitionMethod),
			capturedAt: input.item.createdAt,
		};
	}

	private classifyEvidenceConfidence(
		evidenceType: SaveEvidenceType,
		captureMethod: SaveSourceAcquisitionMethod,
	): EvidenceConfidence {
		if (evidenceType === "pasted_text") {
			return "low";
		}
		if (captureMethod === "direct_fetch") {
			return "high";
		}
		if (captureMethod === "browser_fetch" || captureMethod === "auth_browser_fetch") {
			return "medium";
		}
		if (captureMethod === "reader_proxy") {
			return "medium";
		}
		return "low";
	}

	private createCanonicalContent(input: {
		item: Item;
		evidenceMdPath: string | null;
		extractedTextPath: string;
		snapshotHtmlPath: string | null;
	}): ItemContent {
		let canonicalMd = "";
		let rawType: ItemContent["rawType"] = "text";
		let rawBlobPath: string | null = input.extractedTextPath;

		if (input.evidenceMdPath) {
			canonicalMd = plainTextToMarkdownV1(readFileSync(input.evidenceMdPath, "utf8"));
			rawBlobPath = input.evidenceMdPath;
		} else if (input.snapshotHtmlPath) {
			const html = readFileSync(input.snapshotHtmlPath, "utf8");
			canonicalMd = htmlToMarkdownV1(html, input.item.originalUrl);
			rawType = "html";
			rawBlobPath = input.snapshotHtmlPath;
		} else {
			canonicalMd = plainTextToMarkdownV1(readFileSync(input.extractedTextPath, "utf8"));
		}

		return {
			itemId: input.item.id,
			canonicalMd,
			canonicalVersion: CANONICAL_MARKDOWN_VERSION,
			canonicalGeneratedAt: this.getNowIsoString(),
			rawType,
			rawBlobPath,
			rawUrl: input.item.originalUrl,
			fetchedAt: input.item.createdAt,
		};
	}

	private withTransaction<T>(action: () => T): T {
		this.options.database.exec("BEGIN IMMEDIATE TRANSACTION;");
		try {
			const result = action();
			this.options.database.exec("COMMIT;");
			return result;
		} catch (error) {
			this.options.database.exec("ROLLBACK;");
			throw error;
		}
	}

	private createArtifact(itemId: string, kind: Artifact["kind"], path: string, mimeType: string): Artifact {
		return {
			id: randomUUID(),
			itemId,
			kind,
			path,
			mimeType,
			version: 1,
			createdAt: this.getNowIsoString(),
		};
	}

	private getNowIsoString(): string {
		return (this.options.now ?? (() => new Date()))().toISOString();
	}
}
