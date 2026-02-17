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

function renderPlainTextSnapshotHtml(text: string): string {
	const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	return `<!doctype html><html><head><meta charset="utf-8"/><style>body{margin:0;padding:16px;font-family:Inter,system-ui,sans-serif;line-height:1.55;color:#1f2430;background:#fff}pre{margin:0;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}</style></head><body><pre>${escaped}</pre></body></html>`;
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
    <script>
      const itemId = ${JSON.stringify(itemId)};
      const annRoot = document.getElementById('ann');
      const iframe = document.getElementById('snapshot');
      const filterRoot = document.getElementById('filters');
      const filterSummary = document.getElementById('filterSummary');
      let annotationsCache = [];
      let overlayStatuses = {};
      let activeFilterKind = 'all';
      let activeTagFilter = null;
      const DISPLAY_TIME_ZONE = 'Asia/Shanghai';
      const DISPLAY_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
        timeZone: DISPLAY_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      function formatDisplayTime(rawValue) {
        if (typeof rawValue !== 'string') {
          return '';
        }
        const parsed = Date.parse(rawValue);
        if (!Number.isFinite(parsed)) {
          return rawValue;
        }
        return DISPLAY_TIME_FORMATTER.format(parsed) + ' (UTC+8)';
      }

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
        const previousVisibility = iframe.style.visibility;

        iframe.style.visibility = 'hidden';

        iframe.addEventListener('load', () => {
          const nextWindow = iframe.contentWindow;
          if (nextWindow) {
            nextWindow.scrollTo(scrollX, scrollY);
          }
          requestAnimationFrame(() => {
            iframe.style.visibility = previousVisibility || 'visible';
          });
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

        const cards = annRoot.querySelectorAll('.annotation');
        for (const card of cards) {
          card.classList.remove('annotation-active');
        }
        const activeCard = annRoot.querySelector('[data-annotation-id="' + annotationId + '"]');
        if (activeCard) {
          activeCard.classList.add('annotation-active');
        }
      }

      function statusMeta(rawStatus) {
        if (typeof rawStatus !== 'string') {
          return { label: 'pending', className: 'annotation-status-pending', unresolved: false };
        }
        if (rawStatus === 'resolved-anchor') {
          return { label: 'anchor', className: 'annotation-status-anchor', unresolved: false };
        }
        if (rawStatus === 'resolved-fallback') {
          return { label: 'fallback', className: 'annotation-status-fallback', unresolved: false };
        }
        if (rawStatus.startsWith('unresolved')) {
          return { label: rawStatus, className: 'annotation-status-unresolved', unresolved: true };
        }
        return { label: rawStatus, className: 'annotation-status-pending', unresolved: false };
      }

      function matchesFilter(annotation) {
        const status = statusMeta(overlayStatuses[annotation.id]);
        if (activeFilterKind === 'highlight' && annotation.type !== 'highlight') {
          return false;
        }
        if (activeFilterKind === 'underline' && annotation.type !== 'underline') {
          return false;
        }
        if (activeFilterKind === 'comment' && !annotation.comment) {
          return false;
        }
        if (activeFilterKind === 'unresolved' && !status.unresolved) {
          return false;
        }
        if (activeTagFilter && (!Array.isArray(annotation.tags) || !annotation.tags.includes(activeTagFilter))) {
          return false;
        }
        return true;
      }

      function updateFilterButtons() {
        if (!filterRoot) {
          return;
        }
        const buttons = filterRoot.querySelectorAll('.filter-btn');
        for (const button of buttons) {
          const kind = button.getAttribute('data-filter-kind');
          button.classList.toggle('active', kind === activeFilterKind);
        }
      }

      function updateFilterSummary(total, shown) {
        if (!filterSummary) {
          return;
        }
        const tagLine = activeTagFilter ? ' • tag #' + activeTagFilter : '';
        const kindLine = activeFilterKind === 'all' ? 'all' : activeFilterKind;
        filterSummary.textContent = 'Showing ' + shown + '/' + total + ' (' + kindLine + tagLine + ')';
      }

      async function loadAnnotations() {
        const response = await fetch('/viewer/api/items/' + encodeURIComponent(itemId) + '/annotations');
        const data = await response.json();
        const annotations = Array.isArray(data.annotations) ? data.annotations : [];
        annotationsCache = annotations;
        const visibleAnnotations = annotations.filter((annotation) => matchesFilter(annotation));

        annRoot.innerHTML = '';
        if (annotations.length === 0) {
          annRoot.textContent = 'No annotations yet.';
          updateFilterSummary(0, 0);
          return;
        }
        if (visibleAnnotations.length === 0) {
          annRoot.textContent = 'No annotations match current filters.';
          updateFilterSummary(annotations.length, 0);
          return;
        }

        updateFilterSummary(annotations.length, visibleAnnotations.length);
        for (const annotation of visibleAnnotations) {
          const wrapper = document.createElement('div');
          wrapper.className = 'annotation';
          wrapper.style.borderLeftColor = annotationColor(annotation);
          wrapper.setAttribute('data-annotation-id', annotation.id);
          wrapper.onclick = () => focusAnnotation(annotation.id);

          const topLine = document.createElement('div');
          topLine.className = 'annotation-topline';

          const type = document.createElement('div');
          type.className = 'annotation-type';
          type.textContent = annotation.type;
          topLine.appendChild(type);

          const id = document.createElement('div');
          id.className = 'annotation-id';
          id.textContent = annotation.id;
          topLine.appendChild(id);

          const status = document.createElement('span');
          const meta = statusMeta(overlayStatuses[annotation.id]);
          status.className = 'annotation-status ' + meta.className;
          status.textContent = meta.label;
          topLine.appendChild(status);

          if (meta.unresolved) {
            wrapper.classList.add('annotation-unresolved');
          }

          wrapper.appendChild(topLine);

          const text = document.createElement('div');
          text.className = 'annotation-text';
          text.textContent = annotation.text || '(empty selection)';
          wrapper.appendChild(text);

          if (annotation.comment) {
            const note = document.createElement('div');
            note.className = 'annotation-comment';
            note.textContent = annotation.comment;
            wrapper.appendChild(note);
          }

          if (Array.isArray(annotation.tags) && annotation.tags.length > 0) {
            const tags = document.createElement('div');
            tags.className = 'annotation-tags';
            for (const tag of annotation.tags) {
              const chip = document.createElement('button');
              chip.className = 'annotation-tag';
              chip.textContent = '#' + tag;
              chip.onclick = async (event) => {
                event.stopPropagation();
                activeTagFilter = activeTagFilter === tag ? null : tag;
                await loadAnnotations();
              };
              tags.appendChild(chip);
            }
            wrapper.appendChild(tags);
          }

          const metaLine = document.createElement('div');
          metaLine.className = 'annotation-meta';
          metaLine.textContent = formatDisplayTime(annotation.createdAt);
          wrapper.appendChild(metaLine);

          const actions = document.createElement('div');
          actions.className = 'annotation-actions';

          if (meta.unresolved || meta.label === 'fallback') {
            const repair = document.createElement('button');
            repair.textContent = 'Repair anchor';
            repair.onclick = async (event) => {
              event.stopPropagation();
              await repairAnnotationAnchor(annotation);
            };
            actions.appendChild(repair);
          }

          const noteEditor = document.createElement('div');
          noteEditor.className = 'annotation-note-editor';
          noteEditor.hidden = true;
          noteEditor.onclick = (event) => {
            event.stopPropagation();
          };

          const noteInput = document.createElement('textarea');
          noteInput.className = 'annotation-note-input';
          noteInput.placeholder = 'Write a note for this annotation...';
          noteInput.value = annotation.comment || '';
          noteEditor.appendChild(noteInput);

          const noteEditorActions = document.createElement('div');
          noteEditorActions.className = 'annotation-note-actions';

          const saveNote = document.createElement('button');
          saveNote.textContent = 'Save note';
          saveNote.onclick = async (event) => {
            event.stopPropagation();
            try {
              await persistAnnotationComment(annotation.id, noteInput.value);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              window.alert(message || 'Failed to update note');
              return;
            }
            await loadAnnotations();
          };
          noteEditorActions.appendChild(saveNote);

          const cancelNote = document.createElement('button');
          cancelNote.textContent = 'Cancel';
          cancelNote.onclick = (event) => {
            event.stopPropagation();
            noteInput.value = annotation.comment || '';
            noteEditor.hidden = true;
          };
          noteEditorActions.appendChild(cancelNote);

          noteEditor.appendChild(noteEditorActions);

          const note = document.createElement('button');
          note.textContent = annotation.comment ? 'Edit note' : 'Add note';
          note.onclick = (event) => {
            event.stopPropagation();
            noteInput.value = annotation.comment || '';
            noteEditor.hidden = !noteEditor.hidden;
            if (!noteEditor.hidden) {
              noteInput.focus();
              noteInput.selectionStart = noteInput.value.length;
              noteInput.selectionEnd = noteInput.value.length;
            }
          };
          actions.appendChild(note);

          const edit = document.createElement('button');
          edit.textContent = 'Edit text';
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
          wrapper.appendChild(noteEditor);

          annRoot.appendChild(wrapper);
        }
      }

      function parseAnchorJson(anchor) {
        if (typeof anchor !== 'string') {
          return null;
        }
        try {
          return JSON.parse(anchor);
        } catch {
          return null;
        }
      }

      function findRangeAcrossTextNodesInDocument(doc, targetText) {
        if (!doc || typeof targetText !== 'string' || targetText.length === 0) {
          return null;
        }
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        const segments = [];
        let fullText = '';
        let node;
        while ((node = walker.nextNode())) {
          const value = node.nodeValue || '';
          if (!value) {
            continue;
          }
          const start = fullText.length;
          fullText += value;
          const end = fullText.length;
          segments.push({ node, start, end });
        }
        const index = fullText.indexOf(targetText);
        if (index < 0) {
          return null;
        }
        const rangeStart = index;
        const rangeEnd = index + targetText.length;

        function locate(offset) {
          for (const segment of segments) {
            if (offset >= segment.start && offset <= segment.end) {
              return {
                node: segment.node,
                offset: Math.max(0, Math.min(offset - segment.start, (segment.node.nodeValue || '').length)),
              };
            }
          }
          return null;
        }

        const startPosition = locate(rangeStart);
        const endPosition = locate(rangeEnd);
        if (!startPosition || !endPosition) {
          return null;
        }
        const range = doc.createRange();
        range.setStart(startPosition.node, startPosition.offset);
        range.setEnd(endPosition.node, endPosition.offset);
        return String(range).trim().length > 0 ? range : null;
      }

      function buildAnchorFromRange(doc, range, exactText) {
        const startElement = range.startContainer.nodeType === Node.TEXT_NODE
          ? range.startContainer.parentElement
          : range.startContainer;
        const endElement = range.endContainer.nodeType === Node.TEXT_NODE
          ? range.endContainer.parentElement
          : range.endContainer;
        const bodyText = (doc.body?.innerText || '').replace(/s+/g, ' ').trim();
        const normalizedText = String(exactText || '').replace(/s+/g, ' ').trim();
        const start = normalizedText ? bodyText.indexOf(normalizedText) : -1;
        const end = start >= 0 ? start + normalizedText.length : -1;
        return {
          kind: 'html-quote-v1',
          exact: normalizedText,
          prefix: start > 0 ? bodyText.slice(Math.max(0, start - 32), start) : '',
          suffix: end >= 0 ? bodyText.slice(end, Math.min(bodyText.length, end + 32)) : '',
          start,
          end,
          selector: toCssPath(startElement),
          startSelector: toCssPath(startElement),
          endSelector: toCssPath(endElement),
          startNodePath: toNodePath(doc.body, range.startContainer),
          endNodePath: toNodePath(doc.body, range.endContainer),
          startOffset: range.startOffset,
          endOffset: range.endOffset,
          rangeStartOffset: range.startOffset,
          rangeEndOffset: range.endOffset,
          version: 1,
        };
      }

      async function repairAnnotationAnchor(annotation) {
        const doc = iframe?.contentWindow?.document;
        if (!doc) {
          return;
        }
        const parsed = parseAnchorJson(annotation.anchor);
        const candidates = [annotation.text, parsed?.exact]
          .filter((value) => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0);

        let repairedRange = null;
        let matchedText = null;
        for (const candidate of candidates) {
          const range = findRangeAcrossTextNodesInDocument(doc, candidate);
          if (range) {
            repairedRange = range;
            matchedText = candidate;
            break;
          }
        }

        if (!repairedRange || !matchedText) {
          window.alert('Could not repair anchor from current snapshot text.');
          return;
        }

        const nextAnchor = buildAnchorFromRange(doc, repairedRange, matchedText);
        const response = await fetch('/viewer/api/annotations/' + encodeURIComponent(annotation.id), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ anchor: JSON.stringify(nextAnchor) }),
        });
        if (!response.ok) {
          const content = await response.text();
          window.alert(content || 'Failed to repair anchor');
          return;
        }

        await loadAnnotations();
        refreshSnapshot();
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

      async function persistAnnotationComment(annotationId, nextComment) {
        const response = await fetch('/viewer/api/annotations/' + encodeURIComponent(annotationId), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ comment: nextComment.trim() || null }),
        });
        if (!response.ok) {
          const content = await response.text();
          throw new Error(content || 'Failed to update note');
        }
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

      if (filterRoot) {
        const buttons = filterRoot.querySelectorAll('.filter-btn');
        for (const button of buttons) {
          button.onclick = async () => {
            const kind = button.getAttribute('data-filter-kind') || 'all';
            activeFilterKind = kind;
            updateFilterButtons();
            await loadAnnotations();
          };
        }
      }

      window.addEventListener('message', (event) => {
        const data = event && event.data;
        if (!data || typeof data !== 'object') {
          return;
        }
        if (data.type !== 'sonder-overlay-status' || data.itemId !== itemId || typeof data.statuses !== 'object') {
          return;
        }
        overlayStatuses = data.statuses;
        loadAnnotations().catch((error) => {
          annRoot.textContent = String(error);
        });
      });

      updateFilterButtons();
      loadAnnotations().catch((error) => {
        annRoot.textContent = String(error);
      });
    </script>
  </body>
</html>`;
}

function sanitizeSnapshotHtmlForViewer(html: string): string {
	let sanitized = html;
	sanitized = sanitized.replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
	sanitized = sanitized.replaceAll(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");
	sanitized = sanitized.replaceAll(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "");
	sanitized = sanitized.replaceAll(/<meta\b[^>]*http-equiv=["']?refresh["']?[^>]*>/gi, "");
	return sanitized;
}

function injectOverlayIntoSnapshotHtml(html: string, itemId: string): string {
	const sanitized = sanitizeSnapshotHtmlForViewer(html);
	const overlayScript = `
<style id="sonder-overlay-style">
.sonder-overlay-highlight { background: #ffe58f; }
.sonder-overlay-underline { text-decoration: underline; text-decoration-color: #ff4d4f; text-decoration-thickness: 2px; }
.sonder-overlay-focus { outline: 2px solid #1677ff; outline-offset: 2px; }
/* WeChat article body often ships hidden and is unhidden by inline scripts.
   Viewer removes scripts, so force content visible for static reading/annotation. */
#js_content,
.rich_media_content#js_content,
.rich_media_content.js_underline_content {
  visibility: visible !important;
  opacity: 1 !important;
}
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

  function findRangeAcrossTextNodes(root, target) {
    if (!root || typeof target !== 'string' || target.length === 0) {
      return null;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const segments = [];
    let fullText = '';
    let node;
    while ((node = walker.nextNode())) {
      const value = node.nodeValue || '';
      if (value.length === 0) {
        continue;
      }
      const start = fullText.length;
      fullText += value;
      const end = fullText.length;
      segments.push({ node, start, end });
    }

    const index = fullText.indexOf(target);
    if (index < 0) {
      return null;
    }

    const rangeStart = index;
    const rangeEnd = index + target.length;

    function locate(offset) {
      for (const segment of segments) {
        if (offset >= segment.start && offset <= segment.end) {
          return {
            node: segment.node,
            offset: Math.max(0, Math.min(offset - segment.start, (segment.node.nodeValue || '').length)),
          };
        }
      }
      return null;
    }

    const startPosition = locate(rangeStart);
    const endPosition = locate(rangeEnd);
    if (!startPosition || !endPosition) {
      return null;
    }

    const range = document.createRange();
    range.setStart(startPosition.node, startPosition.offset);
    range.setEnd(endPosition.node, endPosition.offset);
    return String(range).trim().length > 0 ? range : null;
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
      return 'unresolved-empty';
    }
    const anchor = parseAnchor(annotation);

    let strategy = 'resolved-anchor';
    let range = getTextRangeFromSelector(anchor, text);
    if (!range) {
      range = findRangeAcrossTextNodes(document.body, text);
      strategy = 'resolved-fallback';
    }
    if (!range && anchor && typeof anchor.exact === 'string') {
      range = findRangeAcrossTextNodes(document.body, anchor.exact);
      strategy = 'resolved-fallback';
    }
    if (!range) {
      const hit = findFirstTextNodeWithValue(document.body, text);
      if (hit) {
        range = document.createRange();
        range.setStart(hit.node, hit.index);
        range.setEnd(hit.node, hit.index + text.length);
        strategy = 'resolved-fallback';
      }
    }
    if (!range) {
      return 'unresolved-missing-target';
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
      return strategy;
    } catch {
      // Ignore invalid range overlaps in MVP overlay pass.
      return 'unresolved-range-overlap';
    }
  }

  fetch('/viewer/api/items/${encodeURIComponent(itemId)}/annotations')
    .then((res) => res.json())
    .then((payload) => {
      const annotations = Array.isArray(payload.annotations) ? payload.annotations : [];
      const statuses = {};
      for (const annotation of annotations) {
        statuses[annotation.id] = applyMark(annotation);
      }
      window.__sonderOverlayStatus = statuses;
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'sonder-overlay-status', itemId: ${JSON.stringify(itemId)}, statuses }, '*');
      }
    })
    .catch(() => {});
})();
</script>`;

	if (sanitized.includes("</body>")) {
		return sanitized.replace("</body>", `${overlayScript}</body>`);
	}
	return `${sanitized}\n${overlayScript}`;
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
			const evidenceArtifact = artifacts.find((artifact) => artifact.kind === "evidence-md");
			const snapshotArtifact = artifacts.find((artifact) => artifact.kind === "snapshot-html");
			const extractedArtifact = artifacts.find((artifact) => artifact.kind === "extracted-text");
			if (evidenceArtifact) {
				const text = readFileSync(evidenceArtifact.path, "utf8");
				respondHtml(response, 200, injectOverlayIntoSnapshotHtml(renderPlainTextSnapshotHtml(text), itemId));
				return;
			}
			if (snapshotArtifact) {
				const html = readFileSync(snapshotArtifact.path, "utf8");
				response.writeHead(200, { "content-type": getMimeTypeByPath(snapshotArtifact.path) });
				response.end(injectOverlayIntoSnapshotHtml(html, itemId));
				return;
			}
			if (extractedArtifact) {
				const text = readFileSync(extractedArtifact.path, "utf8");
				respondHtml(response, 200, injectOverlayIntoSnapshotHtml(renderPlainTextSnapshotHtml(text), itemId));
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
