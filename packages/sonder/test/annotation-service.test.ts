import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AnnotationService } from "../src/app/annotation-service.js";
import { AnnotationsRepo, ArtifactsRepo, createDatabase, ItemsRepo } from "../src/storage/index.js";

describe("AnnotationService", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const directory of tempDirs) {
			rmSync(directory, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("creates and lists annotations using extracted-text artifact when available", () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-annotation-service-"));
		tempDirs.push(root);
		const database = createDatabase({ databasePath: join(root, "sonder.sqlite") });
		const itemsRepo = new ItemsRepo(database);
		const artifactsRepo = new ArtifactsRepo(database);
		const annotationsRepo = new AnnotationsRepo(database);
		const service = new AnnotationService({
			itemsRepo,
			artifactsRepo,
			annotationsRepo,
			now: () => new Date("2026-02-18T00:00:00.000Z"),
		});

		try {
			itemsRepo.create({
				id: "item-annotation",
				createdAt: "2026-02-17T00:00:00.000Z",
				sourceType: "web",
				originalUrl: "https://example.com/article",
				whyNote: null,
				tags: [],
				topic: null,
				space: null,
			});
			artifactsRepo.create({
				id: "artifact-snapshot",
				itemId: "item-annotation",
				kind: "snapshot-html",
				path: "/tmp/snapshot.html",
				mimeType: "text/html",
				version: 1,
				createdAt: "2026-02-17T00:00:00.000Z",
			});
			artifactsRepo.create({
				id: "artifact-extracted",
				itemId: "item-annotation",
				kind: "extracted-text",
				path: "/tmp/extracted.txt",
				mimeType: "text/plain",
				version: 1,
				createdAt: "2026-02-17T00:00:00.000Z",
			});

			const created = service.create({
				itemId: "item-annotation",
				type: "highlight",
				text: "evidence fragment",
				comment: null,
				tags: ["key"],
			});
			expect(created.artifactId).toBe("artifact-extracted");
			expect(created.anchor).toContain("item://item-annotation#highlight:");

			const listed = service.list("item-annotation");
			expect(listed).toHaveLength(1);
			expect(listed[0]?.id).toBe(created.id);
			expect(listed[0]?.tags).toEqual(["key"]);
		} finally {
			database.close();
		}
	});

	it("updates and deletes annotations with stable error semantics", () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-annotation-service-"));
		tempDirs.push(root);
		const database = createDatabase({ databasePath: join(root, "sonder.sqlite") });
		const itemsRepo = new ItemsRepo(database);
		const artifactsRepo = new ArtifactsRepo(database);
		const annotationsRepo = new AnnotationsRepo(database);
		const service = new AnnotationService({ itemsRepo, artifactsRepo, annotationsRepo });

		try {
			itemsRepo.create({
				id: "item-update",
				createdAt: "2026-02-17T00:00:00.000Z",
				sourceType: "web",
				originalUrl: "https://example.com/article",
				whyNote: null,
				tags: [],
				topic: null,
				space: null,
			});
			artifactsRepo.create({
				id: "artifact-update",
				itemId: "item-update",
				kind: "snapshot-html",
				path: "/tmp/snapshot.html",
				mimeType: "text/html",
				version: 1,
				createdAt: "2026-02-17T00:00:00.000Z",
			});

			const created = service.create({
				itemId: "item-update",
				type: "note",
				text: "old",
				comment: "old comment",
				tags: ["old-tag"],
			});
			const updated = service.update({
				annotationId: created.id,
				text: "new text",
				comment: "new comment",
				tags: ["new-tag"],
			});
			expect(updated.text).toBe("new text");
			expect(updated.comment).toBe("new comment");
			expect(updated.tags).toEqual(["new-tag"]);

			expect(service.delete(created.id)).toBe(true);
			expect(service.delete(created.id)).toBe(false);
			expect(() => service.update({ annotationId: created.id, text: "missing" })).toThrow(
				`Annotation not found: ${created.id}`,
			);
		} finally {
			database.close();
		}
	});
});
