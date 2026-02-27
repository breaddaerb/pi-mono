import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SaveService } from "../src/app/save-service.js";
import {
	ArtifactsRepo,
	CaptureAttemptRepo,
	createDatabase,
	ItemContentRepo,
	ItemProvenanceRepo,
	ItemsRepo,
} from "../src/storage/index.js";

interface TestServer {
	baseUrl: string;
	close: () => Promise<void>;
}

async function withServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<TestServer> {
	const server = createServer(handler);
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Server address unavailable");
	}
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) reject(error);
					else resolve();
				});
			}),
	};
}

describe("SaveService", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const directory of tempDirs) {
			rmSync(directory, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("persists item and artifacts for a successful save", async () => {
		const server = await withServer((_request, response) => {
			response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			response.end("<html><body><h1>Save Service</h1><p>primary content</p></body></html>");
		});
		const root = mkdtempSync(join(tmpdir(), "sonder-save-service-"));
		tempDirs.push(root);

		const database = createDatabase({ databasePath: join(root, "sonder.sqlite") });
		const itemsRepo = new ItemsRepo(database);
		const artifactsRepo = new ArtifactsRepo(database);
		const captureAttemptRepo = new CaptureAttemptRepo(database);
		const itemProvenanceRepo = new ItemProvenanceRepo(database);
		const itemContentRepo = new ItemContentRepo(database);
		const service = new SaveService({
			database,
			itemsRepo,
			artifactsRepo,
			captureAttemptRepo,
			itemProvenanceRepo,
			itemContentRepo,
			dataRootDir: join(root, "data"),
		});

		try {
			const result = await service.save({
				url: `${server.baseUrl}/article`,
				tags: ["alpha", "beta"],
				pastedText: null,
			});
			expect(result.sourceStatus).toBe("ok");
			expect(result.evidenceType).toBe("snapshot");
			expect(result.tags).toEqual(["alpha", "beta"]);
			expect(result.artifactIds.length).toBeGreaterThanOrEqual(3);

			const item = itemsRepo.findById(result.itemId);
			expect(item?.originalUrl).toBe(`${server.baseUrl}/article`);
			expect(item?.tags).toEqual(["alpha", "beta"]);

			const artifacts = artifactsRepo.listByItemId(result.itemId);
			expect(artifacts.some((artifact) => artifact.kind === "extracted-text")).toBe(true);
			expect(artifacts.some((artifact) => artifact.kind === "acquisition-report")).toBe(true);
			expect(captureAttemptRepo.listByItemId(result.itemId).length).toBeGreaterThan(0);
			const provenance = itemProvenanceRepo.findByItemId(result.itemId);
			expect(provenance?.captureMethod).toBe(result.sourceAcquisitionMethod);
			expect(provenance?.evidenceConfidence).toBe("high");
			const canonical = itemContentRepo.findByItemId(result.itemId);
			expect(canonical?.canonicalMd.length ?? 0).toBeGreaterThan(0);
			expect(canonical?.canonicalVersion).toBe(1);
		} finally {
			database.close();
			await server.close();
		}
	});

	it("rolls back database state and cleans item directory on artifact persistence failure", async () => {
		const root = mkdtempSync(join(tmpdir(), "sonder-save-service-"));
		tempDirs.push(root);

		const database = createDatabase({ databasePath: join(root, "sonder.sqlite") });
		const itemsRepo = new ItemsRepo(database);
		const artifactsRepo = new ArtifactsRepo(database);
		const captureAttemptRepo = new CaptureAttemptRepo(database);
		const itemProvenanceRepo = new ItemProvenanceRepo(database);
		const itemContentRepo = new ItemContentRepo(database);
		const service = new SaveService({
			database,
			itemsRepo,
			artifactsRepo,
			captureAttemptRepo,
			itemProvenanceRepo,
			itemContentRepo,
			dataRootDir: join(root, "data"),
			snapshotFetchImpl: async () =>
				new Response("<html><body><h1>failure case</h1></body></html>", {
					status: 200,
					headers: { "content-type": "text/html; charset=utf-8" },
				}),
		});

		const originalCreate = artifactsRepo.create.bind(artifactsRepo);
		let createCalls = 0;
		artifactsRepo.create = ((artifact) => {
			createCalls += 1;
			if (createCalls === 2) {
				throw new Error("simulated artifact failure");
			}
			originalCreate(artifact);
		}) as typeof artifactsRepo.create;

		try {
			await expect(
				service.save({
					url: "https://example.com/failure",
					tags: [],
					pastedText: null,
				}),
			).rejects.toThrow("simulated artifact failure");

			expect(itemsRepo.listRecent(5)).toHaveLength(0);
			const itemsDirectory = join(root, "data", "items");
			if (existsSync(itemsDirectory)) {
				expect(readdirSync(itemsDirectory)).toHaveLength(0);
			}
		} finally {
			database.close();
		}
	});
});
