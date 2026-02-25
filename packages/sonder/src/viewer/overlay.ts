import { sanitizeSnapshotHtmlForViewer } from "./sanitize.js";

export function injectOverlayIntoSnapshotHtml(html: string, itemId: string): string {
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

  function buildFlatTextSegments(root) {
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
    return { segments, fullText };
  }

  function locateOffsetInSegments(segments, offset) {
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

  function rangeFromOffsets(segments, startOffset, endOffset) {
    const startPosition = locateOffsetInSegments(segments, startOffset);
    const endPosition = locateOffsetInSegments(segments, endOffset);
    if (!startPosition || !endPosition) {
      return null;
    }
    const range = document.createRange();
    range.setStart(startPosition.node, startPosition.offset);
    range.setEnd(endPosition.node, endPosition.offset);
    return String(range).trim().length > 0 ? range : null;
  }

  function normalizeWhitespace(value) {
    return String(value || '').replace(/s+/g, ' ').trim();
  }

  function buildNormalizedTextIndexMap(rawText) {
    let normalized = '';
    const rawIndexByNormalizedIndex = [];
    let pendingSpace = false;

    for (let index = 0; index < rawText.length; index += 1) {
      const char = rawText[index];
      if (/s/.test(char)) {
        pendingSpace = true;
        continue;
      }
      if (pendingSpace && normalized.length > 0) {
        rawIndexByNormalizedIndex.push(index);
        normalized += ' ';
      }
      pendingSpace = false;
      rawIndexByNormalizedIndex.push(index);
      normalized += char;
    }

    while (normalized.endsWith(' ')) {
      normalized = normalized.slice(0, -1);
      rawIndexByNormalizedIndex.pop();
    }

    return { normalized, rawIndexByNormalizedIndex };
  }

  function findBestNormalizedMatch(normalizedDocument, normalizedTarget, normalizedPrefix, normalizedSuffix) {
    if (!normalizedTarget) {
      return -1;
    }

    const matches = [];
    let fromIndex = 0;
    while (fromIndex <= normalizedDocument.length - normalizedTarget.length) {
      const index = normalizedDocument.indexOf(normalizedTarget, fromIndex);
      if (index < 0) {
        break;
      }
      matches.push(index);
      fromIndex = index + 1;
    }

    if (matches.length === 0) {
      return -1;
    }
    if (!normalizedPrefix && !normalizedSuffix) {
      return matches[0];
    }

    let bestIndex = matches[0];
    let bestScore = -1;
    for (const index of matches) {
      let score = 0;
      if (normalizedPrefix) {
        const left = normalizedDocument.slice(Math.max(0, index - normalizedPrefix.length), index);
        if (left === normalizedPrefix) {
          score += 2;
        }
      }
      if (normalizedSuffix) {
        const rightStart = index + normalizedTarget.length;
        const right = normalizedDocument.slice(rightStart, rightStart + normalizedSuffix.length);
        if (right === normalizedSuffix) {
          score += 2;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    return bestIndex;
  }

  function findRangeAcrossTextNodes(root, target) {
    if (!root || typeof target !== 'string' || target.length === 0) {
      return null;
    }

    const { segments, fullText } = buildFlatTextSegments(root);
    const index = fullText.indexOf(target);
    if (index < 0) {
      return null;
    }

    return rangeFromOffsets(segments, index, index + target.length);
  }

  function findRangeAcrossTextNodesNormalized(root, target, prefix, suffix) {
    if (!root || typeof target !== 'string' || target.length === 0) {
      return null;
    }

    const { segments, fullText } = buildFlatTextSegments(root);
    const normalizedTarget = normalizeWhitespace(target);
    if (!normalizedTarget) {
      return null;
    }

    const normalizedPrefix = normalizeWhitespace(prefix || '');
    const normalizedSuffix = normalizeWhitespace(suffix || '');
    const mapping = buildNormalizedTextIndexMap(fullText);
    const normalizedIndex = findBestNormalizedMatch(
      mapping.normalized,
      normalizedTarget,
      normalizedPrefix,
      normalizedSuffix,
    );
    if (normalizedIndex < 0) {
      return null;
    }

    const rawStart = mapping.rawIndexByNormalizedIndex[normalizedIndex];
    const rawEndIndex = mapping.rawIndexByNormalizedIndex[normalizedIndex + normalizedTarget.length - 1];
    if (typeof rawStart !== 'number' || typeof rawEndIndex !== 'number') {
      return null;
    }

    return rangeFromOffsets(segments, rawStart, rawEndIndex + 1);
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
    if (!range && anchor && typeof anchor.exact === 'string') {
      range = findRangeAcrossTextNodes(document.body, anchor.exact);
      strategy = 'resolved-fallback';
    }
    if (!range) {
      range = findRangeAcrossTextNodes(document.body, text);
      strategy = 'resolved-fallback';
    }
    if (!range && anchor && typeof anchor.exact === 'string') {
      range = findRangeAcrossTextNodesNormalized(document.body, anchor.exact, anchor.prefix, anchor.suffix);
      strategy = 'resolved-fallback';
    }
    if (!range) {
      range = findRangeAcrossTextNodesNormalized(document.body, text, anchor?.prefix, anchor?.suffix);
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
