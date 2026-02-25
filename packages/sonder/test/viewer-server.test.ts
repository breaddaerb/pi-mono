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

	it("serves pasted evidence content in viewer when no snapshot html exists", async () => {
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
			snapshotFetchImpl: async () => {
				throw new Error("LOGIN_REQUIRED: gated source");
			},
		});

		const saved = await app.saveFromInput({
			url: "https://x.com/example/status/1",
			pastedText: "pasted evidence line one\npasted evidence line two",
		});
		expect(saved.evidenceType).toBe("pasted_text");

		const viewer = await startViewerServer({ app });
		try {
			const snapshotResponse = await fetch(`${viewer.baseUrl}/viewer/items/${saved.itemId}/snapshot`);
			expect(snapshotResponse.status).toBe(200);
			const snapshotHtml = await snapshotResponse.text();
			expect(snapshotHtml).toContain("pasted evidence line one");
			expect(snapshotHtml).toContain("<pre>");
			expect(snapshotHtml).toContain("white-space:pre-wrap");
			expect(snapshotHtml).toContain("sonder-overlay-script");
		} finally {
			await viewer.close();
			app.close();
		}
	});

	it("prefers evidence markdown over snapshot html when both exist", async () => {
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

		const snapshotPath = join(root, "snapshot-prefer.html");
		const extractedPath = join(root, "extracted-prefer.txt");
		const evidencePath = join(root, "evidence-prefer.md");
		writeFileSync(snapshotPath, "<html><body><h1>Login wall</h1></body></html>", "utf8");
		writeFileSync(extractedPath, "fallback extracted", "utf8");
		writeFileSync(evidencePath, "real pasted evidence content", "utf8");

		app.itemsRepo.create({
			id: "item_prefer",
			createdAt: new Date().toISOString(),
			sourceType: "web",
			originalUrl: "https://x.com/example/status/2",
			whyNote: null,
			tags: [],
			topic: null,
			space: null,
		});
		app.artifactsRepo.create({
			id: "art_prefer_html",
			itemId: "item_prefer",
			kind: "snapshot-html",
			path: snapshotPath,
			mimeType: "text/html",
			version: 1,
			createdAt: new Date().toISOString(),
		});
		app.artifactsRepo.create({
			id: "art_prefer_text",
			itemId: "item_prefer",
			kind: "extracted-text",
			path: extractedPath,
			mimeType: "text/plain",
			version: 1,
			createdAt: new Date().toISOString(),
		});
		app.artifactsRepo.create({
			id: "art_prefer_evidence",
			itemId: "item_prefer",
			kind: "evidence-md",
			path: evidencePath,
			mimeType: "text/markdown",
			version: 1,
			createdAt: new Date().toISOString(),
		});

		const viewer = await startViewerServer({ app });
		try {
			const snapshotResponse = await fetch(`${viewer.baseUrl}/viewer/items/item_prefer/snapshot`);
			expect(snapshotResponse.status).toBe(200);
			const snapshotHtml = await snapshotResponse.text();
			expect(snapshotHtml).toContain("real pasted evidence content");
			expect(snapshotHtml).not.toContain("Login wall");
		} finally {
			await viewer.close();
			app.close();
		}
	});

	it("maps viewer request errors to 400/404 classes", async () => {
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

		const viewer = await startViewerServer({ app });
		try {
			const missingItemResponse = await fetch(`${viewer.baseUrl}/viewer/api/items/missing-item/annotations`);
			expect(missingItemResponse.status).toBe(404);
			expect(await missingItemResponse.text()).toContain('"code": "NOT_FOUND"');

			const invalidJsonResponse = await fetch(`${viewer.baseUrl}/viewer/api/items/missing-item/annotations`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{",
			});
			expect(invalidJsonResponse.status).toBe(400);
			expect(await invalidJsonResponse.text()).toContain('"code": "BAD_REQUEST"');

			const missingAnnotationPatch = await fetch(`${viewer.baseUrl}/viewer/api/annotations/missing-ann`, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "x" }),
			});
			expect(missingAnnotationPatch.status).toBe(404);
			expect(await missingAnnotationPatch.text()).toContain('"code": "NOT_FOUND"');
		} finally {
			await viewer.close();
			app.close();
		}
	});

	it("serves viewer page and supports annotation create/delete APIs", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-viewer-"));
		tempDirs.push(root);

		const app = new SonderApp({
			paths: { rootDir: root },
			responder: async (input) => {
				const first = input.context.annotationEvidence[0];
				const citation = first ? `ann:${first.id}` : "";
				return {
					answer: citation ? `From annotation [${citation}]` : "unused",
					model: "stub",
					provider: "stub",
					citations: citation ? [citation] : [],
				};
			},
		});

		const snapshotPath = join(root, "snapshot.html");
		const extractedPath = join(root, "extracted.txt");
		writeFileSync(
			snapshotPath,
			'<html><head><meta http-equiv="refresh" content="0;url=https://x.com"></head><body onload="alert(\'x\')"><h1 onclick="steal()">Snapshot</h1><p>Main claim lives here.</p><a href="javascript:alert(\'x\')">bad</a><a href="java&#x73;cript:alert(\'x\')">bad2</a><img src="x" onerror="alert(\'x\')"/><script>document.body.innerHTML=\'blanked\';</script><iframe src=\'https://example.com\'></iframe></body></html>',
			"utf8",
		);
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
			expect(page).toContain("Add notes from each annotation card");
			expect(page).toContain('class="side-top"');
			expect(page).toContain('class="ann-scroll"');
			expect(page).toContain('data-filter-kind="highlight"');
			expect(page).toContain('data-filter-kind="unresolved"');
			expect(page).toContain("window.__sonderItemId");
			expect(page).toContain("/viewer/static/client.js");
			expect(page).not.toContain("Add note for this annotation");
			expect(page).not.toContain("btnNote");

			const clientScriptResponse = await fetch(`${viewer.baseUrl}/viewer/static/client.js`);
			expect(clientScriptResponse.status).toBe(200);
			const clientScript = await clientScriptResponse.text();
			expect(clientScript).toContain("focusAnnotation");
			expect(clientScript).toContain("annotation-active");
			expect(clientScript).toContain("annotation-topline");
			expect(clientScript).toContain("annotation-status");
			expect(clientScript).toContain("sonder-overlay-status");
			expect(clientScript).toContain("Repair anchor");
			expect(clientScript).toContain("annotation-note-editor");
			expect(clientScript).toContain("Save note");
			expect(clientScript).toContain("Asia/Shanghai");
			expect(clientScript).toContain("formatDisplayTime");
			expect(clientScript).toContain("replace(/\\s+/g, ' ')");
			expect(clientScript).not.toContain("replace(/s+/g, ' ')");

			const snapshotResponse = await fetch(`${viewer.baseUrl}/viewer/items/item_view/snapshot`);
			expect(snapshotResponse.status).toBe(200);
			const snapshotHtml = await snapshotResponse.text();
			expect(snapshotHtml).toContain("sonder-overlay-script");
			expect(snapshotHtml).toContain("findRangeAcrossTextNodes");
			expect(snapshotHtml).toContain("Main claim lives here.");
			expect(snapshotHtml).toContain("<pre>");
			expect(snapshotHtml).not.toContain("document.body.innerHTML='blanked'");
			expect(snapshotHtml).not.toContain("<iframe");
			expect(snapshotHtml).not.toContain('http-equiv="refresh"');
			expect(snapshotHtml).not.toContain("onload=");
			expect(snapshotHtml).not.toContain("onclick=");
			expect(snapshotHtml).not.toContain("onerror=");
			expect(snapshotHtml).not.toContain('href="javascript:');
			expect(snapshotHtml.toLowerCase()).not.toContain("java&#x73;cript");
			expect(clientScript).toContain("iframe.style.visibility = 'hidden'");

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
			expect(created.anchor).toContain("md-quote-v1");
			expect(created.tags).toEqual(["thesis"]);

			const annotationsResponse = await fetch(`${viewer.baseUrl}/viewer/api/items/item_view/annotations`);
			expect(annotationsResponse.status).toBe(200);
			expect(await annotationsResponse.text()).toContain(created.id);

			const patchResponse = await fetch(`${viewer.baseUrl}/viewer/api/annotations/${created.id}`, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "Updated claim" }),
			});
			expect(patchResponse.status).toBe(200);
			expect(await patchResponse.text()).toContain("Updated claim");

			const opened = app.openItemDialogue("item_view");
			const askResult = await app.askInItemDialogue("item_view", opened.sessionId, "what matters?");
			expect(askResult.answer).toContain(`[ann:${created.id}]`);

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
