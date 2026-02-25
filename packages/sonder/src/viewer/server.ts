import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { SonderApp } from "../app/index.js";
import type { AnnotationType } from "../types.js";
import { renderViewerClientScript } from "./client-script.js";
import { injectOverlayIntoSnapshotHtml } from "./overlay.js";

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

interface CreateViewerAnnotationPayload {
	type: AnnotationType;
	text: string | null;
	comment: string | null;
	color: string | null;
	tags: string[];
	anchor: string | null;
}

interface UpdateViewerAnnotationPayload {
	text?: string | null;
	comment?: string | null;
	color?: string | null;
	tags?: string[];
	anchor?: string;
}

class ViewerHttpError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

function badRequest(message: string): ViewerHttpError {
	return new ViewerHttpError(400, "BAD_REQUEST", message);
}

function notFound(message: string): ViewerHttpError {
	return new ViewerHttpError(404, "NOT_FOUND", message);
}

function mapViewerRequestError(error: unknown): ViewerHttpError | null {
	if (error instanceof ViewerHttpError) {
		return error;
	}
	if (error instanceof SyntaxError) {
		return badRequest("Invalid JSON payload.");
	}
	if (error instanceof Error) {
		if (error.message.startsWith("Item not found:")) {
			return notFound(error.message);
		}
		if (error.message.startsWith("Annotation not found:")) {
			return notFound(error.message);
		}
	}
	return null;
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

function respondJavaScript(response: ServerResponse, status: number, source: string): void {
	response.writeHead(status, { "content-type": "application/javascript; charset=utf-8" });
	response.end(source);
}

function renderPlainTextSnapshotHtml(text: string): string {
	const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	return `<!doctype html><html><head><meta charset="utf-8"/><style>body{margin:0;padding:16px;font-family:Inter,system-ui,sans-serif;line-height:1.55;color:#1f2430;background:#fff}pre{margin:0;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}</style></head><body><pre>${escaped}</pre></body></html>`;
}

function getDefaultColor(type: AnnotationType): string | null {
	if (type === "highlight") {
		return "#ffe58f";
	}
	if (type === "underline") {
		return "#ff7875";
	}
	if (type === "note") {
		return "#91d5ff";
	}
	return null;
}

function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function buildAnchorPayload(extractedText: string, selectedText: string): string {
	const normalizedDocument = normalizeWhitespace(extractedText);
	const normalizedSelection = normalizeWhitespace(selectedText);
	const start = normalizedSelection ? normalizedDocument.indexOf(normalizedSelection) : -1;
	const end = start >= 0 ? start + normalizedSelection.length : -1;
	const prefixStart = Math.max(0, start - 32);
	const suffixEnd = end >= 0 ? Math.min(normalizedDocument.length, end + 32) : 0;

	return JSON.stringify({
		kind: "md-quote-v1",
		exact: normalizedSelection,
		prefix: start >= 0 ? normalizedDocument.slice(prefixStart, start) : "",
		suffix: end >= 0 ? normalizedDocument.slice(end, suffixEnd) : "",
		start,
		end,
		version: 1,
	});
}

function readRequestBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		request.on("error", (error) => reject(error));
	});
}

function renderViewerPage(itemId: string): string {
	const escapedItemId = itemId.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Sonder Viewer - ${escapedItemId}</title>
    <style>
      body { font-family: Inter, system-ui, sans-serif; margin: 0; background: #f7f8fa; color: #1f2430; }
      header { padding: 12px 16px; border-bottom: 1px solid #e7e9ee; background: #fff; }
      main { display: grid; grid-template-columns: 2fr 1fr; height: calc(100vh - 56px); }
      iframe { width: 100%; height: 100%; border: 0; background: #fff; }
      .side { border-left: 1px solid #e7e9ee; padding: 12px; background: #fcfcfd; display: flex; flex-direction: column; overflow: hidden; }
      .side-top { position: sticky; top: 0; z-index: 3; background: #fcfcfd; padding-bottom: 8px; }
      .toolbar { display: flex; gap: 8px; margin-bottom: 8px; }
      button { padding: 6px 12px; border: 1px solid #d7dbe5; border-radius: 8px; background: #fff; color: #1f2430; cursor: pointer; }
      button:hover { background: #f1f4f9; }
      .hint { color: #677188; font-size: 12px; }
      .ann-title { margin: 12px 0 8px 0; font-size: 14px; color: #3c455a; }
      .filters { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 2px 0; }
      .filter-btn { font-size: 11px; padding: 3px 8px; border-radius: 999px; border: 1px solid #d7dbe5; background: #fff; color: #4b556d; cursor: pointer; }
      .filter-btn.active { background: #eaf2ff; border-color: #c7dbff; color: #274a84; }
      .filter-summary { font-size: 11px; color: #6c758a; margin-top: 4px; }
      .ann-scroll { overflow: auto; min-height: 0; padding-top: 8px; }
      .annotation { border: 1px solid #e1e6ef; border-left: 4px solid #ddd; border-radius: 10px; padding: 10px; margin-bottom: 10px; cursor: pointer; background: #fff; transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
      .annotation:hover { box-shadow: 0 2px 12px rgba(31,36,48,.08); transform: translateY(-1px); }
      .annotation-active { border-color: #8bb8ff; box-shadow: 0 0 0 2px rgba(22,119,255,.15); }
      .annotation-topline { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .annotation-type { font-size: 11px; color: #2f4163; font-weight: 700; letter-spacing: .02em; background: #eaf2ff; border: 1px solid #d1e3ff; padding: 2px 8px; border-radius: 999px; text-transform: uppercase; }
      .annotation-id { font-size: 11px; color: #8a93a6; }
      .annotation-status { font-size: 10px; border-radius: 999px; padding: 2px 8px; border: 1px solid transparent; margin-left: 8px; }
      .annotation-status-anchor { background: #edf9f0; border-color: #cfead7; color: #2f7450; }
      .annotation-status-fallback { background: #fff8e8; border-color: #f3dfb2; color: #7b5c1e; }
      .annotation-status-unresolved { background: #fff0f0; border-color: #f2c8c8; color: #8a2e2e; }
      .annotation-status-pending { background: #f3f5f9; border-color: #e2e7f0; color: #59627a; }
      .annotation-unresolved { border-color: #f2c8c8; }
      .annotation-text { white-space: pre-wrap; word-break: break-word; margin-top: 8px; font-size: 13px; line-height: 1.45; }
      .annotation-comment { font-size: 12px; line-height: 1.45; margin-top: 8px; background: #f6f8fd; border: 1px solid #e1e7f5; padding: 8px; border-radius: 8px; color: #37425a; }
      .annotation-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .annotation-tag { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #f3f5f9; border: 1px solid #e2e7f0; color: #56607a; }
      .annotation-meta { font-size: 11px; color: #8a93a6; margin-top: 8px; }
      .annotation-actions { display: flex; gap: 8px; margin-top: 8px; }
      .annotation-note-editor { margin-top: 8px; padding: 8px; border: 1px solid #dbe2ef; border-radius: 8px; background: #f8faff; display: flex; flex-direction: column; gap: 8px; }
      .annotation-note-editor[hidden] { display: none; }
      .annotation-note-input { width: 100%; min-height: 80px; border: 1px solid #ccd6ea; border-radius: 8px; padding: 8px; font: inherit; line-height: 1.45; resize: vertical; box-sizing: border-box; background: #fff; color: #1f2430; }
      .annotation-note-actions { display: flex; gap: 8px; }
    </style>
  </head>
  <body>
    <header>
      <strong>Item:</strong> ${escapedItemId}
      <div class="hint">Zotero-like flow (MVP): select text in the snapshot, then click highlight/underline/note.</div>
    </header>
    <main>
      <iframe id="snapshot" src="/viewer/items/${encodeURIComponent(itemId)}/snapshot"></iframe>
      <div class="side">
        <div class="side-top">
          <div class="toolbar">
            <button id="btnHighlight">Highlight</button>
            <button id="btnUnderline">Underline</button>
          </div>
          <div class="hint">Selection is captured from the left snapshot frame. Add notes from each annotation card.</div>
          <hr />
          <h3 class="ann-title">Annotations</h3>
          <div id="filters" class="filters">
            <button class="filter-btn active" data-filter-kind="all">All</button>
            <button class="filter-btn" data-filter-kind="highlight">Highlight</button>
            <button class="filter-btn" data-filter-kind="underline">Underline</button>
            <button class="filter-btn" data-filter-kind="comment">With note</button>
            <button class="filter-btn" data-filter-kind="unresolved">Unresolved</button>
          </div>
          <div id="filterSummary" class="filter-summary">Showing all annotations</div>
        </div>
        <div id="ann" class="ann-scroll">Loading...</div>
      </div>
    </main>
    <script>window.__sonderItemId = ${JSON.stringify(itemId)};</script>
    <script src="/viewer/static/client.js"></script>
  </body>
</html>`;
}

function parseCreatePayload(body: string): CreateViewerAnnotationPayload {
	const parsed = JSON.parse(body) as Partial<CreateViewerAnnotationPayload>;
	if (!parsed || typeof parsed !== "object") {
		throw badRequest("Invalid payload.");
	}
	const type = parsed.type;
	if (type !== "highlight" && type !== "underline" && type !== "note") {
		throw badRequest("Invalid annotation type.");
	}
	const tags = Array.isArray(parsed.tags)
		? parsed.tags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
		: [];
	return {
		type,
		text: typeof parsed.text === "string" ? parsed.text : null,
		comment: typeof parsed.comment === "string" ? parsed.comment : null,
		color: typeof parsed.color === "string" ? parsed.color : null,
		tags,
		anchor: typeof parsed.anchor === "string" ? parsed.anchor : null,
	};
}

function parseUpdatePayload(body: string): UpdateViewerAnnotationPayload {
	const parsed = JSON.parse(body) as Partial<UpdateViewerAnnotationPayload>;
	if (!parsed || typeof parsed !== "object") {
		throw badRequest("Invalid payload.");
	}
	const payload: UpdateViewerAnnotationPayload = {};
	if ("text" in parsed) {
		payload.text = typeof parsed.text === "string" ? parsed.text : null;
	}
	if ("comment" in parsed) {
		payload.comment = typeof parsed.comment === "string" ? parsed.comment : null;
	}
	if ("color" in parsed) {
		payload.color = typeof parsed.color === "string" ? parsed.color : null;
	}
	if ("tags" in parsed) {
		payload.tags = Array.isArray(parsed.tags)
			? parsed.tags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
			: [];
	}
	if ("anchor" in parsed && typeof parsed.anchor === "string") {
		payload.anchor = parsed.anchor;
	}
	return payload;
}

async function handleRequest(app: SonderApp, request: IncomingMessage, response: ServerResponse): Promise<void> {
	const method = request.method ?? "GET";
	const url = new URL(request.url ?? "/", "http://127.0.0.1");
	const pathname = url.pathname;

	if (method === "GET" && pathname === "/viewer/health") {
		respondJson(response, 200, { ok: true });
		return;
	}

	if (method === "GET" && pathname === "/viewer/static/client.js") {
		respondJavaScript(response, 200, renderViewerClientScript());
		return;
	}

	if (method === "GET") {
		const itemPageMatch = pathname.match(/^\/viewer\/items\/([^/]+)$/);
		if (itemPageMatch) {
			const itemId = decodeURIComponent(itemPageMatch[1]);
			respondHtml(response, 200, renderViewerPage(itemId));
			return;
		}

		const snapshotMatch = pathname.match(/^\/viewer\/items\/([^/]+)\/snapshot$/);
		if (snapshotMatch) {
			const itemId = decodeURIComponent(snapshotMatch[1]);
			const canonicalContent = app.ensureCanonicalItemContent(itemId);
			const html = renderPlainTextSnapshotHtml(canonicalContent.canonicalMd);
			respondHtml(response, 200, injectOverlayIntoSnapshotHtml(html, itemId));
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
			respondJson(response, 200, { itemId, annotations: app.listAnnotations(itemId) });
			return;
		}
	}

	if (method === "POST") {
		const annCreateMatch = pathname.match(/^\/viewer\/api\/items\/([^/]+)\/annotations$/);
		if (annCreateMatch) {
			const itemId = decodeURIComponent(annCreateMatch[1]);
			const body = await readRequestBody(request);
			const payload = parseCreatePayload(body);
			const canonicalContent = app.ensureCanonicalItemContent(itemId);
			const anchor = payload.anchor ?? buildAnchorPayload(canonicalContent.canonicalMd, payload.text ?? "");
			const annotation = app.createAnnotation({
				itemId,
				type: payload.type,
				text: payload.text,
				comment: payload.comment,
				color: payload.color ?? getDefaultColor(payload.type),
				tags: payload.tags,
				anchor,
			});
			respondJson(response, 201, annotation);
			return;
		}
	}

	if (method === "PATCH") {
		const annPatchMatch = pathname.match(/^\/viewer\/api\/annotations\/([^/]+)$/);
		if (annPatchMatch) {
			const annotationId = decodeURIComponent(annPatchMatch[1]);
			const body = await readRequestBody(request);
			const payload = parseUpdatePayload(body);
			const updated = app.updateAnnotation({
				annotationId,
				text: payload.text,
				comment: payload.comment,
				color: payload.color,
				tags: payload.tags,
				anchor: payload.anchor,
			});
			respondJson(response, 200, updated);
			return;
		}
	}

	if (method === "DELETE") {
		const annDeleteMatch = pathname.match(/^\/viewer\/api\/annotations\/([^/]+)$/);
		if (annDeleteMatch) {
			const annotationId = decodeURIComponent(annDeleteMatch[1]);
			const deleted = app.deleteAnnotation(annotationId);
			if (!deleted) {
				respondJson(response, 404, { code: "NOT_FOUND", message: `Annotation not found: ${annotationId}` });
				return;
			}
			respondJson(response, 200, { ok: true, annotationId });
			return;
		}
	}

	respondText(response, 404, "Not Found");
}

export async function startViewerServer(options: SonderViewerServerOptions): Promise<SonderViewerServer> {
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 0;
	const server = createServer((request, response) => {
		void handleRequest(options.app, request, response).catch((error: unknown) => {
			const mapped = mapViewerRequestError(error);
			if (mapped) {
				respondJson(response, mapped.status, { code: mapped.code, message: mapped.message });
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			respondJson(response, 500, { code: "INTERNAL_ERROR", message, traceId: randomUUID() });
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
