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

interface UpdateViewerAnnotationPayload {
	text?: string | null;
	comment?: string | null;
	color?: string | null;
	tags?: string[];
	anchor?: string;
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
      .annotation { border: 1px solid #e5e5e5; border-left: 4px solid #ddd; border-radius: 6px; padding: 8px; margin-bottom: 8px; cursor: pointer; }
      .annotation:hover { background: #fafafa; }
      .annotation-type { font-size: 12px; color: #555; font-weight: 600; }
      .annotation-text { white-space: pre-wrap; word-break: break-word; margin-top: 4px; }
      .annotation-meta { font-size: 11px; color: #888; margin-top: 4px; }
      .annotation-actions { display: flex; gap: 8px; margin-top: 6px; }
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
      let annotationsCache = [];

      function toCssPath(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
          return null;
        }
        const segments = [];
        let current = element;
        while (current && current.nodeType === Node.ELEMENT_NODE && current.tagName.toLowerCase() !== 'html') {
          const parent = current.parentElement;
          if (!parent) {
            break;
          }
          const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
          const index = siblings.indexOf(current) + 1;
          segments.unshift(current.tagName.toLowerCase() + ':nth-of-type(' + index + ')');
          current = parent;
        }
        return segments.length > 0 ? segments.join(' > ') : null;
      }

      function toNodePath(root, node) {
        if (!root || !node) {
          return null;
        }
        const path = [];
        let current = node;
        while (current && current !== root) {
          const parent = current.parentNode;
          if (!parent) {
            return null;
          }
          const index = Array.prototype.indexOf.call(parent.childNodes, current);
          if (index < 0) {
            return null;
          }
          path.unshift(index);
          current = parent;
        }
        return current === root ? path : null;
      }

      function refreshSnapshot() {
        if (!iframe) {
          return;
        }
        const frameWindow = iframe.contentWindow;
        const scrollX = frameWindow ? frameWindow.scrollX : 0;
        const scrollY = frameWindow ? frameWindow.scrollY : 0;

        iframe.addEventListener('load', () => {
          const nextWindow = iframe.contentWindow;
          if (nextWindow) {
            nextWindow.scrollTo(scrollX, scrollY);
          }
        }, { once: true });

        iframe.src = '/viewer/items/' + encodeURIComponent(itemId) + '/snapshot?ts=' + Date.now();
      }

      function annotationColor(annotation) {
        if (annotation.type === 'underline') {
          return '#ff7875';
        }
        if (annotation.type === 'highlight') {
          return '#ffe58f';
        }
        return '#91d5ff';
      }

      function focusAnnotation(annotationId) {
        const doc = iframe?.contentWindow?.document;
        if (!doc) {
          return;
        }
        const node = doc.querySelector('[data-sonder-annotation-id="' + annotationId + '"]');
        if (!node) {
          return;
        }
        node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        node.classList.add('sonder-overlay-focus');
        setTimeout(() => {
          node.classList.remove('sonder-overlay-focus');
        }, 1200);
      }

      async function loadAnnotations() {
        const response = await fetch('/viewer/api/items/' + encodeURIComponent(itemId) + '/annotations');
        const data = await response.json();
        const annotations = Array.isArray(data.annotations) ? data.annotations : [];
        annotationsCache = annotations;
        if (annotations.length === 0) {
          annRoot.textContent = 'No annotations yet.';
          return;
        }

        annRoot.innerHTML = '';
        for (const annotation of annotations) {
          const wrapper = document.createElement('div');
          wrapper.className = 'annotation';
          wrapper.style.borderLeftColor = annotationColor(annotation);
          wrapper.onclick = () => focusAnnotation(annotation.id);

          const type = document.createElement('div');
          type.className = 'annotation-type';
          type.textContent = annotation.type + ' • ' + annotation.id;
          wrapper.appendChild(type);

          const text = document.createElement('div');
          text.className = 'annotation-text';
          text.textContent = annotation.text || '(empty)';
          wrapper.appendChild(text);

          if (annotation.comment) {
            const note = document.createElement('div');
            note.className = 'annotation-meta';
            note.textContent = 'Note: ' + annotation.comment;
            wrapper.appendChild(note);
          }

          const meta = document.createElement('div');
          meta.className = 'annotation-meta';
          meta.textContent = annotation.createdAt;
          wrapper.appendChild(meta);

          const actions = document.createElement('div');
          actions.className = 'annotation-actions';

          const edit = document.createElement('button');
          edit.textContent = 'Edit';
          edit.onclick = (event) => {
            event.stopPropagation();
            editAnnotation(annotation);
          };
          actions.appendChild(edit);

          const del = document.createElement('button');
          del.textContent = 'Delete';
          del.onclick = async (event) => {
            event.stopPropagation();
            await fetch('/viewer/api/annotations/' + encodeURIComponent(annotation.id), { method: 'DELETE' });
            await loadAnnotations();
            refreshSnapshot();
          };
          actions.appendChild(del);

          wrapper.appendChild(actions);

          annRoot.appendChild(wrapper);
        }
      }

      function getSelectionInfo() {
        const doc = iframe?.contentWindow?.document;
        if (!doc) {
          return { text: '', anchor: null };
        }
        const selection = doc.getSelection();
        if (!selection || selection.rangeCount === 0) {
          return { text: '', anchor: null };
        }
        const range = selection.getRangeAt(0);
        const text = String(selection).trim();
        if (!text) {
          return { text: '', anchor: null };
        }

        const startElement = range.startContainer.nodeType === Node.TEXT_NODE
          ? range.startContainer.parentElement
          : range.startContainer;
        const endElement = range.endContainer.nodeType === Node.TEXT_NODE
          ? range.endContainer.parentElement
          : range.endContainer;
        const selector = toCssPath(startElement);

        const bodyText = (doc.body?.innerText || '').replace(/\\s+/g, ' ').trim();
        const normalizedText = text.replace(/\\s+/g, ' ').trim();
        const start = normalizedText ? bodyText.indexOf(normalizedText) : -1;
        const end = start >= 0 ? start + normalizedText.length : -1;

        return {
          text,
          anchor: JSON.stringify({
            kind: 'html-quote-v1',
            exact: normalizedText,
            prefix: start > 0 ? bodyText.slice(Math.max(0, start - 32), start) : '',
            suffix: end >= 0 ? bodyText.slice(end, Math.min(bodyText.length, end + 32)) : '',
            start,
            end,
            selector,
            startSelector: toCssPath(startElement),
            endSelector: toCssPath(endElement),
            startNodePath: toNodePath(doc.body, range.startContainer),
            endNodePath: toNodePath(doc.body, range.endContainer),
            startOffset: range.startOffset,
            endOffset: range.endOffset,
            rangeStartOffset: range.startOffset,
            rangeEndOffset: range.endOffset,
            version: 1,
          }),
        };
      }

      async function createAnnotation(type) {
        const selection = getSelectionInfo();
        const selectedText = selection.text || null;

        if (!selectedText) {
          window.alert('Select text first.');
          return;
        }

        if (type === 'note') {
          const note = window.prompt('Add note for selected text', '');
          if (note === null) {
            return;
          }
          const normalizedSelected = selectedText.replace(/\\s+/g, ' ').trim();
          const target = annotationsCache.find((annotation) =>
            typeof annotation.text === 'string' &&
            annotation.text.replace(/\\s+/g, ' ').trim() === normalizedSelected &&
            (annotation.type === 'highlight' || annotation.type === 'underline'),
          );
          if (!target) {
            window.alert('Create a highlight or underline on this sentence first, then add a note.');
            return;
          }

          const patchResponse = await fetch('/viewer/api/annotations/' + encodeURIComponent(target.id), {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              text: target.text,
              comment: (note || '').trim() || null,
            }),
          });
          if (!patchResponse.ok) {
            const content = await patchResponse.text();
            window.alert(content || 'Failed to add note');
            return;
          }
          await loadAnnotations();
          return;
        }

        const response = await fetch('/viewer/api/items/' + encodeURIComponent(itemId) + '/annotations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type,
            text: selectedText,
            comment: null,
            color: null,
            tags: [],
            anchor: selection.anchor,
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

      async function editAnnotation(annotation) {
        const nextText = window.prompt('Edit annotation text', annotation.text || annotation.comment || '');
        if (nextText === null) {
          return;
        }
        const response = await fetch('/viewer/api/annotations/' + encodeURIComponent(annotation.id), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: nextText.trim() || null, comment: annotation.comment || null }),
        });
        if (!response.ok) {
          const content = await response.text();
          window.alert(content || 'Failed to edit annotation');
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
.sonder-overlay-focus { outline: 2px solid #1677ff; outline-offset: 2px; }
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

  function parseAnchor(annotation) {
    if (typeof annotation.anchor !== 'string') {
      return null;
    }
    try {
      return JSON.parse(annotation.anchor);
    } catch {
      return null;
    }
  }

  function getFirstTextNode(element) {
    if (!element) {
      return null;
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (typeof node.nodeValue === 'string' && node.nodeValue.length > 0) {
        return node;
      }
    }
    return null;
  }

  function getNodeByPath(root, path) {
    if (!root || !Array.isArray(path)) {
      return null;
    }
    let current = root;
    for (const index of path) {
      if (!current || !current.childNodes || typeof index !== 'number') {
        return null;
      }
      current = current.childNodes[index] || null;
    }
    return current;
  }

  function getTextRangeFromSelector(anchor, text) {
    if (!anchor) {
      return null;
    }

    if (Array.isArray(anchor.startNodePath) && Array.isArray(anchor.endNodePath)) {
      const startNode = getNodeByPath(document.body, anchor.startNodePath);
      const endNode = getNodeByPath(document.body, anchor.endNodePath);
      if (startNode && endNode && startNode.nodeType === Node.TEXT_NODE && endNode.nodeType === Node.TEXT_NODE) {
        const startValue = startNode.nodeValue || '';
        const endValue = endNode.nodeValue || '';
        const startOffset = typeof anchor.startOffset === 'number'
          ? Math.max(0, Math.min(anchor.startOffset, startValue.length))
          : 0;
        const endOffset = typeof anchor.endOffset === 'number'
          ? Math.max(0, Math.min(anchor.endOffset, endValue.length))
          : endValue.length;
        if (endOffset > startOffset || startNode !== endNode) {
          const range = document.createRange();
          range.setStart(startNode, startOffset);
          range.setEnd(endNode, endOffset);
          if (String(range).trim().length > 0) {
            return range;
          }
        }
      }
    }

    if (typeof anchor.startSelector === 'string' && typeof anchor.endSelector === 'string') {
      const startElement = document.querySelector(anchor.startSelector);
      const endElement = document.querySelector(anchor.endSelector);
      const startNode = getFirstTextNode(startElement);
      const endNode = getFirstTextNode(endElement);
      if (startNode && endNode) {
        const startValue = startNode.nodeValue || '';
        const endValue = endNode.nodeValue || '';
        const startOffset = typeof anchor.startOffset === 'number'
          ? Math.max(0, Math.min(anchor.startOffset, startValue.length))
          : 0;
        const endOffset = typeof anchor.endOffset === 'number'
          ? Math.max(0, Math.min(anchor.endOffset, endValue.length))
          : endValue.length;
        if (endOffset > startOffset || startNode !== endNode) {
          const range = document.createRange();
          range.setStart(startNode, startOffset);
          range.setEnd(endNode, endOffset);
          if (String(range).trim().length > 0) {
            return range;
          }
        }
      }
    }

    if (typeof anchor.selector !== 'string') {
      return null;
    }
    const element = document.querySelector(anchor.selector);
    if (!element) {
      return null;
    }
    const firstTextNode = getFirstTextNode(element);
    if (!firstTextNode || typeof firstTextNode.nodeValue !== 'string') {
      return null;
    }
    const value = firstTextNode.nodeValue;
    const start = typeof anchor.rangeStartOffset === 'number' ? anchor.rangeStartOffset : value.indexOf(text);
    const end = typeof anchor.rangeEndOffset === 'number' ? anchor.rangeEndOffset : start + text.length;
    if (start < 0 || end <= start || end > value.length) {
      return null;
    }
    const range = document.createRange();
    range.setStart(firstTextNode, start);
    range.setEnd(firstTextNode, end);
    return range;
  }

  function applyMark(annotation) {
    const text = (annotation.text || '').trim();
    if (!text) {
      return;
    }
    const anchor = parseAnchor(annotation);

    let range = getTextRangeFromSelector(anchor, text);
    if (!range) {
      const hit = findFirstTextNodeWithValue(document.body, text);
      if (hit) {
        range = document.createRange();
        range.setStart(hit.node, hit.index);
        range.setEnd(hit.node, hit.index + text.length);
      }
    }
    if (!range) {
      return;
    }

    const span = document.createElement('span');
    span.setAttribute('data-sonder-annotation-id', annotation.id);
    if (annotation.type === 'underline') {
      span.className = 'sonder-overlay-underline';
    } else {
      span.className = 'sonder-overlay-highlight';
    }

    try {
      const fragment = range.extractContents();
      span.appendChild(fragment);
      range.insertNode(span);
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

function parseUpdatePayload(body: string): UpdateViewerAnnotationPayload {
	const parsed = JSON.parse(body) as Partial<UpdateViewerAnnotationPayload>;
	if (!parsed || typeof parsed !== "object") {
		throw new Error("Invalid payload");
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
