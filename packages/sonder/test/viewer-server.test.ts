import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SonderApp } from "../src/app/index.js";
import { startViewerServer } from "../src/viewer/index.js";

describe("viewer server", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const directory of tempDirs) {
			rmSync(directory, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("serves viewer page and supports annotation create/delete APIs", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-viewer-"));
		tempDirs.push(root);

		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async () => ({
				answer: "unused",
				model: "stub",
				provider: "stub",
				citations: [],
			}),
		});

		const snapshotPath = join(root, "snapshot.html");
		const extractedPath = join(root, "extracted.txt");
		writeFileSync(snapshotPath, "<html><body><h1>Snapshot</h1><p>Main claim lives here.</p></body></html>", "utf8");
		writeFileSync(extractedPath, "Snapshot Main claim lives here.", "utf8");
		app.itemsRepo.create({
			id: "item_view",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://example.com",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		app.artifactsRepo.create({
			id: "art_html",
			itemId: "item_view",
			kind: "snapshot-html",
			path: snapshotPath,
			mimeType: "text/html",
			version: 1,
			createdAt: new Date().toISOString(),
		});
		app.artifactsRepo.create({
			id: "art_text",
			itemId: "item_view",
			kind: "extracted-text",
			path: extractedPath,
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});

		const viewer = await startViewerServer({ app });
		try {
			const pageResponse = await fetch(viewer.getItemUrl("item_view"));
			expect(pageResponse.status).toBe(200);
			const page = await pageResponse.text();
			expect(page).toContain("Highlight");

			const snapshotResponse = await fetch(`${viewer.baseUrl}/viewer/items/item_view/snapshot`);
			expect(snapshotResponse.status).toBe(200);
			expect(await snapshotResponse.text()).toContain("sonder-overlay-script");

			const createResponse = await fetch(`${viewer.baseUrl}/viewer/api/items/item_view/annotations`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					type: "highlight",
					text: "Main claim",
					comment: null,
					tags: ["thesis"],
				}),
			});
			expect(createResponse.status).toBe(201);
			const created = (await createResponse.json()) as { id: string; anchor: string; tags: string[] };
			expect(created.anchor).toContain("html-quote-v1");
			expect(created.tags).toEqual(["thesis"]);

			const annotationsResponse = await fetch(`${viewer.baseUrl}/viewer/api/items/item_view/annotations`);
			expect(annotationsResponse.status).toBe(200);
			expect(await annotationsResponse.text()).toContain(created.id);

			const deleteResponse = await fetch(`${viewer.baseUrl}/viewer/api/annotations/${created.id}`, {
				method: "DELETE",
			});
			expect(deleteResponse.status).toBe(200);
		} finally {
			await viewer.close();
			app.close();
		}
	});
});
