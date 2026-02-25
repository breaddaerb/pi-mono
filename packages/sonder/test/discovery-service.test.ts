import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DiscoveryService } from "../src/app/discovery-service.js";
import { AnnotationsRepo, ArtifactsRepo, createDatabase, ItemContentRepo, ItemsRepo } from "../src/storage/index.js";

describe("DiscoveryService", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const directory of tempDirs) {
			rmSync(directory, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("lists recent items with requested limit", () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-discovery-service-"));
		tempDirs.push(root);
		const database = createDatabase({ databasePath: join(root, "sonder.sqlite") });
		const itemsRepo = new ItemsRepo(database);
		const itemContentRepo = new ItemContentRepo(database);
		const annotationsRepo = new AnnotationsRepo(database);
		const service = new DiscoveryService({ itemsRepo, itemContentRepo, annotationsRepo });

		try {
			itemsRepo.create({
				id: "item-discovery-1",
				createdAt: "2026-01-01T00:00:00.000Z",
				sourceType: "web",
				originalUrl: "https://example.com/one",
				whyNote: null,
				tags: ["first"],
				topic: null,
				space: null,
			});
			itemsRepo.create({
				id: "item-discovery-2",
				createdAt: "2026-01-02T00:00:00.000Z",
				sourceType: "web",
				originalUrl: "https://example.com/two",
				whyNote: null,
				tags: ["second"],
				topic: null,
				space: null,
			});

			const listed = service.listItems(1);
			expect(listed).toHaveLength(1);
			expect(listed[0]?.id).toBe("item-discovery-2");
			expect(listed[0]?.tags).toEqual(["second"]);
		} finally {
			database.close();
		}
	});

	it("ranks find results using annotation signals and snippets", () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-discovery-service-"));
		tempDirs.push(root);
		const database = createDatabase({ databasePath: join(root, "sonder.sqlite") });
		const itemsRepo = new ItemsRepo(database);
		const artifactsRepo = new ArtifactsRepo(database);
		const itemContentRepo = new ItemContentRepo(database);
		const annotationsRepo = new AnnotationsRepo(database);
		const service = new DiscoveryService({ itemsRepo, itemContentRepo, annotationsRepo });

		try {
			itemsRepo.create({
				id: "item-rank-1",
				createdAt: "2026-01-01T00:00:00.000Z",
				sourceType: "web",
				originalUrl: "https://example.com/agent-memory",
				whyNote: null,
				tags: ["agents"],
				topic: null,
				space: null,
			});
			itemContentRepo.upsert({
				itemId: "item-rank-1",
				canonicalMd: "agent memory systems and retrieval planning",
				canonicalVersion: 1,
				canonicalGeneratedAt: "2026-01-01T00:00:00.000Z",
				rawType: "text",
				rawBlobPath: join(root, "item-rank-1.txt"),
				rawUrl: "https://example.com/agent-memory",
				fetchedAt: "2026-01-01T00:00:00.000Z",
			});
			const extractedPath = join(root, "item-rank-1.txt");
			writeFileSync(extractedPath, "agent memory systems and retrieval planning", "utf8");
			artifactsRepo.create({
				id: "artifact-rank-1",
				itemId: "item-rank-1",
				kind: "extracted-text",
				path: extractedPath,
				mimeType: "text/plain",
				version: 1,
				createdAt: "2026-01-01T00:00:00.000Z",
			});
			annotationsRepo.create({
				id: "annotation-rank-1",
				itemId: "item-rank-1",
				artifactId: "artifact-rank-1",
				type: "note",
				text: "memory policy",
				comment: "important memory detail",
				color: null,
				tags: ["memory"],
				anchor: "item://item-rank-1#note:annotation-rank-1",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			});

			itemsRepo.create({
				id: "item-rank-2",
				createdAt: "2026-01-03T00:00:00.000Z",
				sourceType: "web",
				originalUrl: "https://example.com/other-topic",
				whyNote: null,
				tags: [],
				topic: null,
				space: null,
			});
			itemContentRepo.upsert({
				itemId: "item-rank-2",
				canonicalMd: "brief notes unrelated to ranked memory signal",
				canonicalVersion: 1,
				canonicalGeneratedAt: "2026-01-03T00:00:00.000Z",
				rawType: "text",
				rawBlobPath: join(root, "item-rank-2.txt"),
				rawUrl: "https://example.com/other-topic",
				fetchedAt: "2026-01-03T00:00:00.000Z",
			});
			const extractedPath2 = join(root, "item-rank-2.txt");
			writeFileSync(extractedPath2, "brief notes unrelated to ranked memory signal", "utf8");
			artifactsRepo.create({
				id: "artifact-rank-2",
				itemId: "item-rank-2",
				kind: "extracted-text",
				path: extractedPath2,
				mimeType: "text/plain",
				version: 1,
				createdAt: "2026-01-03T00:00:00.000Z",
			});

			const found = service.findItems("memory", 5);
			expect(found.length).toBeGreaterThan(1);
			expect(found[0]?.id).toBe("item-rank-1");
			expect(found[0]?.score).toBeGreaterThan(found[1]?.score ?? 0);
			expect(found[0]?.reasons).toEqual(expect.arrayContaining(["annotations", "annotation-tags"]));
			expect(found[0]?.snippets.join(" ").toLowerCase()).toContain("memory");
		} finally {
			database.close();
		}
	});
});
