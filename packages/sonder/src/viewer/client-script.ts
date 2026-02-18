export function renderViewerClientScript(): string {
	return `\n      const itemId = typeof window.__sonderItemId === 'string' ? window.__sonderItemId : '';
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
        const bodyText = (doc.body?.innerText || '').replace(/\\s+/g, ' ').trim();
        const normalizedText = String(exactText || '').replace(/\\s+/g, ' ').trim();
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
      });\n`;
}
