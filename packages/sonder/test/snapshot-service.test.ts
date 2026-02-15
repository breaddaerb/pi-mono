import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureSnapshot } from "../src/snapshot/index.js";

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
		throw new Error("Server address is unavailable");
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

describe("captureSnapshot", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const directory of tempDirs) {
			rmSync(directory, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("captures html snapshot, asset manifest, and extracted text", async () => {
		const server = await withServer((_request, response) => {
			response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			response.end(`
				<html>
					<head>
						<link rel="stylesheet" href="/styles.css">
						<script src="https://cdn.example.com/app.js"></script>
					</head>
					<body>
						<h1>Hello Sonder</h1>
						<p>Snapshot body for testing.</p>
						<img src="/image.png" alt="image">
					</body>
				</html>
			`);
		});

		const root = mkdtempSync(join(tmpdir(), "sonder-snapshot-"));
		tempDirs.push(root);

		try {
			const result = await captureSnapshot({
				itemId: "item_html",
				url: `${server.baseUrl}/article`,
				dataRootDir: root,
			});

			expect(result.usedFallback).toBe(false);
			expect(result.failureCode).toBe("none");
			expect(result.failureReason).toBeNull();
			expect(result.snapshotHtmlPath).not.toBeNull();
			expect(result.screenshotFallbackPath).toBeNull();

			const htmlContent = readFileSync(result.snapshotHtmlPath as string, "utf8");
			expect(htmlContent).toContain("Hello Sonder");

			const extracted = readFileSync(result.extractedTextPath, "utf8");
			expect(extracted).toContain("Hello Sonder");
			expect(extracted).toContain("Snapshot body for testing.");

			const manifest = readFileSync(join(result.snapshotAssetsDirectory, "manifest.json"), "utf8");
			expect(manifest).toContain(`${server.baseUrl}/styles.css`);
			expect(manifest).toContain(`${server.baseUrl}/image.png`);
			expect(manifest).toContain("https://cdn.example.com/app.js");
		} finally {
			await server.close();
		}
	});

	it("writes text fallback when html fetch fails", async () => {
		const server = await withServer((_request, response) => {
			response.writeHead(500, { "content-type": "text/plain" });
			response.end("internal error");
		});

		const root = mkdtempSync(join(tmpdir(), "sonder-snapshot-"));
		tempDirs.push(root);

		try {
			const result = await captureSnapshot({
				itemId: "item_fallback",
				url: `${server.baseUrl}/broken`,
				dataRootDir: root,
			});

			expect(result.usedFallback).toBe(true);
			expect(result.failureCode).toBe("fetch_failed");
			expect(result.failureReason).toContain("HTTP 500");
			expect(result.snapshotHtmlPath).toBeNull();
			expect(result.screenshotFallbackPath).not.toBeNull();

			const fallbackText = readFileSync(result.screenshotFallbackPath as string, "utf8");
			expect(fallbackText).toContain("Snapshot fallback (text-only)");
			expect(fallbackText).toContain("HTTP 500");

			const extracted = readFileSync(result.extractedTextPath, "utf8");
			expect(extracted).toContain("Snapshot fallback (text-only)");
		} finally {
			await server.close();
		}
	});
});
