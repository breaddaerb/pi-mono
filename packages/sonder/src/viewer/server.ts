import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname } from "node:path";
import type { SonderApp } from "../app/index.js";
import type { AnnotationType } from "../types.js";

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
		kind: "html-quote-v1",
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
      body { font-family: system-ui, sans-serif; margin: 0; }
      header { padding: 12px 16px; border-bottom: 1px solid #ddd; }
      main { display: grid; grid-template-columns: 2fr 1fr; height: calc(100vh - 56px); }
      iframe { width: 100%; height: 100%; border: 0; }
      .side { border-left: 1px solid #ddd; overflow: auto; padding: 12px; }
      .toolbar { display: flex; gap: 8px; margin-bottom: 8px; }
      button { padding: 4px 10px; }
      .hint { color: #666; font-size: 12px; }
      .annotation { border: 1px solid #e5e5e5; border-radius: 6px; padding: 8px; margin-bottom: 8px; }
      .annotation-type { font-size: 12px; color: #555; }
      .annotation-text { white-space: pre-wrap; word-break: break-word; margin-top: 4px; }
      .annotation-meta { font-size: 11px; color: #888; margin-top: 4px; }
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
        <div class="toolbar">
          <button id="btnHighlight">Highlight</button>
          <button id="btnUnderline">Underline</button>
          <button id="btnNote">Note</button>
        </div>
        <div class="hint">Selection is captured from the left snapshot frame.</div>
        <hr />
        <h3>Annotations</h3>
        <div id="ann">Loading...</div>
      </div>
    </main>
    <script>
      const itemId = ${JSON.stringify(itemId)};
      const annRoot = document.getElementById('ann');
      const iframe = document.getElementById('snapshot');

      function refreshSnapshot() {
        if (!iframe) {
          return;
        }
        iframe.src = '/viewer/items/' + encodeURIComponent(itemId) + '/snapshot?ts=' + Date.now();
      }

      async function loadAnnotations() {
        const response = await fetch('/viewer/api/items/' + encodeURIComponent(itemId) + '/annotations');
        const data = await response.json();
        const annotations = Array.isArray(data.annotations) ? data.annotations : [];
        if (annotations.length === 0) {
          annRoot.textContent = 'No annotations yet.';
          return;
        }

        annRoot.innerHTML = '';
        for (const annotation of annotations) {
          const wrapper = document.createElement('div');
          wrapper.className = 'annotation';

          const type = document.createElement('div');
          type.className = 'annotation-type';
          type.textContent = annotation.type + ' • ' + annotation.id;
          wrapper.appendChild(type);

          const text = document.createElement('div');
          text.className = 'annotation-text';
          text.textContent = annotation.text || annotation.comment || '(empty)';
          wrapper.appendChild(text);

          const meta = document.createElement('div');
          meta.className = 'annotation-meta';
          meta.textContent = annotation.createdAt;
          wrapper.appendChild(meta);

          const del = document.createElement('button');
          del.textContent = 'Delete';
          del.onclick = async () => {
            await fetch('/viewer/api/annotations/' + encodeURIComponent(annotation.id), { method: 'DELETE' });
            await loadAnnotations();
            refreshSnapshot();
          };
          wrapper.appendChild(del);

          annRoot.appendChild(wrapper);
        }
      }

      function getSelectedText() {
        const doc = iframe?.contentWindow?.document;
        if (!doc) {
          return '';
        }
        const selection = doc.getSelection();
        if (!selection) {
          return '';
        }
        return String(selection).trim();
      }

      async function createAnnotation(type) {
        const selectedText = getSelectedText();
        let comment = null;
        let text = selectedText || null;

        if (type === 'note') {
          const input = window.prompt('Note text', selectedText || '');
          if (input === null) {
            return;
          }
          text = input.trim() || null;
          comment = text;
        }

        if (!text) {
          window.alert('Select text first (or provide note text).');
          return;
        }

        const response = await fetch('/viewer/api/items/' + encodeURIComponent(itemId) + '/annotations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type,
            text,
            comment,
            color: null,
            tags: [],
          }),
        });

        if (!response.ok) {
          const content = await response.text();
          window.alert(content || 'Failed to create annotation');
          return;
        }

        await loadAnnotations();
        refreshSnapshot();
      }

      document.getElementById('btnHighlight').onclick = () => createAnnotation('highlight');
      document.getElementById('btnUnderline').onclick = () => createAnnotation('underline');
      document.getElementById('btnNote').onclick = () => createAnnotation('note');
      loadAnnotations().catch((error) => {
        annRoot.textContent = String(error);
      });
    </script>
  </body>
</html>`;
}

function injectOverlayIntoSnapshotHtml(html: string, itemId: string): string {
	const overlayScript = `
<style id="sonder-overlay-style">
.sonder-overlay-highlight { background: #ffe58f; }
.sonder-overlay-underline { text-decoration: underline; text-decoration-color: #ff4d4f; text-decoration-thickness: 2px; }
</style>
<script id="sonder-overlay-script">
(function() {
  function findFirstTextNodeWithValue(root, target) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const value = node.nodeValue || '';
      const index = value.indexOf(target);
      if (index >= 0) {
        return { node, index };
      }
    }
    return null;
  }

  function applyMark(annotation) {
    const text = (annotation.text || '').trim();
    if (!text) {
      return;
    }
    const hit = findFirstTextNodeWithValue(document.body, text);
    if (!hit) {
      return;
    }
    const range = document.createRange();
    range.setStart(hit.node, hit.index);
    range.setEnd(hit.node, hit.index + text.length);

    const span = document.createElement('span');
    span.setAttribute('data-sonder-annotation-id', annotation.id);
    if (annotation.type === 'underline') {
      span.className = 'sonder-overlay-underline';
    } else if (annotation.type === 'highlight') {
      span.className = 'sonder-overlay-highlight';
    } else {
      span.className = 'sonder-overlay-highlight';
    }

    try {
      range.surroundContents(span);
    } catch {
      // Ignore invalid range overlaps in MVP overlay pass.
    }
  }

  fetch('/viewer/api/items/${encodeURIComponent(itemId)}/annotations')
    .then((res) => res.json())
    .then((payload) => {
      const annotations = Array.isArray(payload.annotations) ? payload.annotations : [];
      for (const annotation of annotations) {
        applyMark(annotation);
      }
    })
    .catch(() => {});
})();
</script>`;

	if (html.includes("</body>")) {
		return html.replace("</body>", `${overlayScript}</body>`);
	}
	return `${html}\n${overlayScript}`;
}

function parseCreatePayload(body: string): CreateViewerAnnotationPayload {
	const parsed = JSON.parse(body) as Partial<CreateViewerAnnotationPayload>;
	if (!parsed || typeof parsed !== "object") {
		throw new Error("Invalid payload");
	}
	const type = parsed.type;
	if (type !== "highlight" && type !== "underline" && type !== "note") {
		throw new Error("Invalid annotation type");
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

async function handleRequest(app: SonderApp, request: IncomingMessage, response: ServerResponse): Promise<void> {
	const method = request.method ?? "GET";
	const url = new URL(request.url ?? "/", "http://127.0.0.1");
	const pathname = url.pathname;

	if (method === "GET" && pathname === "/viewer/health") {
		respondJson(response, 200, { ok: true });
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
			const artifacts = app.artifactsRepo.listByItemId(itemId);
			const snapshotArtifact = artifacts.find((artifact) => artifact.kind === "snapshot-html");
			const extractedArtifact = artifacts.find((artifact) => artifact.kind === "extracted-text");
			if (snapshotArtifact) {
				const html = readFileSync(snapshotArtifact.path, "utf8");
				response.writeHead(200, { "content-type": getMimeTypeByPath(snapshotArtifact.path) });
				response.end(injectOverlayIntoSnapshotHtml(html, itemId));
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
			const extractedTextArtifact = app.artifactsRepo
				.listByItemId(itemId)
				.find((artifact) => artifact.kind === "extracted-text");
			const extractedText = extractedTextArtifact ? readFileSync(extractedTextArtifact.path, "utf8") : "";
			const anchor = payload.anchor ?? buildAnchorPayload(extractedText, payload.text ?? "");
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
