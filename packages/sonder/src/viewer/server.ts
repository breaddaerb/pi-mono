import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname } from "node:path";
import type { SonderApp } from "../app/index.js";

export interface SonderViewerServerOptions {
	app: SonderApp;
	host?: string;
	port?: number;
}

export interface SonderViewerServer {
	baseUrl: string;
	close: () => Promise<void>;
	getItemUrl: (itemId: string) => string;
}

function respondJson(response: ServerResponse, status: number, payload: unknown): void {
	response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	response.end(JSON.stringify(payload, null, 2));
}

function respondText(response: ServerResponse, status: number, text: string): void {
	response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
	response.end(text);
}

function respondHtml(response: ServerResponse, status: number, html: string): void {
	response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
	response.end(html);
}

function getMimeTypeByPath(path: string): string {
	const extension = extname(path).toLowerCase();
	if (extension === ".html") {
		return "text/html; charset=utf-8";
	}
	if (extension === ".txt") {
		return "text/plain; charset=utf-8";
	}
	if (extension === ".json") {
		return "application/json; charset=utf-8";
	}
	return "application/octet-stream";
}

function renderViewerPage(itemId: string): string {
	const escapedItemId = itemId.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Sonder Viewer - ${escapedItemId}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; }
      header { padding: 12px 16px; border-bottom: 1px solid #ddd; }
      main { display: grid; grid-template-columns: 2fr 1fr; height: calc(100vh - 56px); }
      iframe { width: 100%; height: 100%; border: 0; }
      .side { border-left: 1px solid #ddd; overflow: auto; padding: 12px; }
      .hint { color: #666; font-size: 12px; }
      pre { white-space: pre-wrap; word-break: break-word; }
    </style>
  </head>
  <body>
    <header>
      <strong>Item:</strong> ${escapedItemId}
      <div class="hint">Viewer skeleton: snapshot + annotations list. Annotation UI will be added next.</div>
    </header>
    <main>
      <iframe src="/viewer/items/${encodeURIComponent(itemId)}/snapshot"></iframe>
      <div class="side">
        <h3>Annotations</h3>
        <pre id="ann">Loading...</pre>
      </div>
    </main>
    <script>
      fetch('/viewer/api/items/${encodeURIComponent(itemId)}/annotations')
        .then((res) => res.json())
        .then((data) => {
          document.getElementById('ann').textContent = JSON.stringify(data, null, 2);
        })
        .catch((error) => {
          document.getElementById('ann').textContent = String(error);
        });
    </script>
  </body>
</html>`;
}

async function handleRequest(app: SonderApp, request: IncomingMessage, response: ServerResponse): Promise<void> {
	const method = request.method ?? "GET";
	if (method !== "GET") {
		respondText(response, 405, "Method Not Allowed");
		return;
	}

	const url = new URL(request.url ?? "/", "http://127.0.0.1");
	const pathname = url.pathname;

	if (pathname === "/viewer/health") {
		respondJson(response, 200, { ok: true });
		return;
	}

	const itemPageMatch = pathname.match(/^\/viewer\/items\/([^/]+)$/);
	if (itemPageMatch) {
		const itemId = decodeURIComponent(itemPageMatch[1]);
		respondHtml(response, 200, renderViewerPage(itemId));
		return;
	}

	const snapshotMatch = pathname.match(/^\/viewer\/items\/([^/]+)\/snapshot$/);
	if (snapshotMatch) {
		const itemId = decodeURIComponent(snapshotMatch[1]);
		const artifacts = app.artifactsRepo.listByItemId(itemId);
		const snapshotArtifact = artifacts.find((artifact) => artifact.kind === "snapshot-html");
		const extractedArtifact = artifacts.find((artifact) => artifact.kind === "extracted-text");
		if (snapshotArtifact) {
			const body = readFileSync(snapshotArtifact.path);
			response.writeHead(200, { "content-type": getMimeTypeByPath(snapshotArtifact.path) });
			response.end(body);
			return;
		}
		if (extractedArtifact) {
			const text = readFileSync(extractedArtifact.path, "utf8");
			respondHtml(
				response,
				200,
				`<!doctype html><html><body><pre>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre></body></html>`,
			);
			return;
		}
		respondText(response, 404, `No snapshot artifacts for item: ${itemId}`);
		return;
	}

	const itemApiMatch = pathname.match(/^\/viewer\/api\/items\/([^/]+)$/);
	if (itemApiMatch) {
		const itemId = decodeURIComponent(itemApiMatch[1]);
		const item = app.itemsRepo.findById(itemId);
		if (!item) {
			respondJson(response, 404, { code: "NOT_FOUND", message: `Item not found: ${itemId}` });
			return;
		}
		respondJson(response, 200, item);
		return;
	}

	const annApiMatch = pathname.match(/^\/viewer\/api\/items\/([^/]+)\/annotations$/);
	if (annApiMatch) {
		const itemId = decodeURIComponent(annApiMatch[1]);
		const annotations = app.annotationsRepo.listByItemId(itemId);
		respondJson(response, 200, { itemId, annotations });
		return;
	}

	respondText(response, 404, "Not Found");
}

export async function startViewerServer(options: SonderViewerServerOptions): Promise<SonderViewerServer> {
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 0;
	const server = createServer((request, response) => {
		void handleRequest(options.app, request, response).catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			respondJson(response, 500, { code: "INTERNAL_ERROR", message });
		});
	});

	await new Promise<void>((resolve) => {
		server.listen(port, host, () => resolve());
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Viewer server address unavailable");
	}
	const baseUrl = `http://${host}:${address.port}`;

	return {
		baseUrl,
		getItemUrl: (itemId: string) => `${baseUrl}/viewer/items/${encodeURIComponent(itemId)}`,
		close: () =>
			new Promise<void>((resolve, reject) => {
				(server as Server).close((error) => {
					if (error) reject(error);
					else resolve();
				});
			}),
	};
}
