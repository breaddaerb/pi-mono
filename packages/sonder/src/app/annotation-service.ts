import { randomUUID } from "node:crypto";
import type { AnnotationsRepo } from "../storage/annotations-repo.js";
import type { ArtifactsRepo } from "../storage/artifacts-repo.js";
import type { ItemsRepo } from "../storage/items-repo.js";
import type { Annotation } from "../types.js";

export interface AnnotationServiceOptions {
	annotationsRepo: AnnotationsRepo;
	artifactsRepo: ArtifactsRepo;
	itemsRepo: ItemsRepo;
	now?: () => Date;
}

export class AnnotationService {
	constructor(private readonly options: AnnotationServiceOptions) {}

	create(input: {
		itemId: string;
		type: Annotation["type"];
		text: string | null;
		comment?: string | null;
		color?: string | null;
		tags?: string[];
		anchor?: string;
	}): Annotation {
		this.ensureItemExists(input.itemId);
		const annotationId = randomUUID();
		const now = this.getNowIsoString();
		const artifactId = this.selectAnnotationArtifactId(input.itemId);
		const annotation: Annotation = {
			id: annotationId,
			itemId: input.itemId,
			artifactId,
			type: input.type,
			text: input.text,
			comment: input.comment ?? null,
			color: input.color ?? null,
			tags: input.tags ?? [],
			anchor: input.anchor ?? `item://${input.itemId}#${input.type}:${annotationId}`,
			createdAt: now,
			updatedAt: now,
		};
		this.options.annotationsRepo.create(annotation);
		return annotation;
	}

	list(itemId: string): Annotation[] {
		this.ensureItemExists(itemId);
		return this.options.annotationsRepo.listByItemId(itemId);
	}

	update(input: {
		annotationId: string;
		text?: string | null;
		comment?: string | null;
		color?: string | null;
		tags?: string[];
		anchor?: string;
	}): Annotation {
		const existing = this.options.annotationsRepo.findById(input.annotationId);
		if (!existing) {
			throw new Error(`Annotation not found: ${input.annotationId}`);
		}
		const updated: Annotation = {
			...existing,
			text: input.text !== undefined ? input.text : existing.text,
			comment: input.comment !== undefined ? input.comment : existing.comment,
			color: input.color !== undefined ? input.color : existing.color,
			tags: input.tags ?? existing.tags,
			anchor: input.anchor ?? existing.anchor,
			updatedAt: this.getNowIsoString(),
		};
		this.options.annotationsRepo.updateById(updated);
		return updated;
	}

	delete(annotationId: string): boolean {
		return this.options.annotationsRepo.deleteById(annotationId);
	}

	private selectAnnotationArtifactId(itemId: string): string {
		const artifacts = this.options.artifactsRepo.listByItemId(itemId);
		if (artifacts.length === 0) {
			throw new Error(`No artifacts found for item: ${itemId}`);
		}

		const extractedTextArtifact = artifacts.find((artifact) => artifact.kind === "extracted-text");
		if (extractedTextArtifact) {
			return extractedTextArtifact.id;
		}
		const snapshotHtmlArtifact = artifacts.find((artifact) => artifact.kind === "snapshot-html");
		if (snapshotHtmlArtifact) {
			return snapshotHtmlArtifact.id;
		}
		return artifacts[0].id;
	}

	private ensureItemExists(itemId: string): void {
		if (!this.options.itemsRepo.findById(itemId)) {
			throw new Error(`Item not found: ${itemId}`);
		}
	}

	private getNowIsoString(): string {
		return (this.options.now ?? (() => new Date()))().toISOString();
	}
}
