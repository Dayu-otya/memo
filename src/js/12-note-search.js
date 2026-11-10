

let noteSearchMatches = [];
let noteSearchCurrentIndex = -1;

function isBodyFocused() {
  return (
    document.activeElement === bodyInput ||
    bodyInput.contains(document.activeElement) ||
    document.activeElement === mdPreview ||
    mdPreview.contains(document.activeElement)
  );
}

function getCurrentEditableEl() {
  const active = getActive();
  return active && active.markdownPreview ? mdPreview : bodyInput;
}

function openNoteSearch() {
  const active = getActive();
  if (!active) return;
  noteSearchBar.style.display = "flex";
  noteSearchInput.value = "";
  noteSearchCount.textContent = "0/0";
  clearNoteSearchHighlights();
  setTimeout(() => noteSearchInput.focus(), 30);
}

function closeNoteSearch() {
  noteSearchBar.style.display = "none";
  clearNoteSearchHighlights();
  noteSearchMatches = [];
  noteSearchCurrentIndex = -1;
  getCurrentEditableEl().focus();
}

function getRawSearchMatches(body, keyword) {
  if (!keyword) return [];
  const source = String(body || "");
  const needle = String(keyword).toLocaleLowerCase("ja-JP");
  const haystack = source.toLocaleLowerCase("ja-JP");
  const matches = [];
  let from = 0;
  while (from <= haystack.length) {
    const start = haystack.indexOf(needle, from);
    if (start < 0) break;
    matches.push({ start, end: start + keyword.length });
    from = start + Math.max(needle.length, 1);
  }
  return matches;
}

function replaceNoteSearchMatch(replaceAll) {
  const active = getActive();
  const keyword = noteSearchInput.value;
  if (!active || !keyword || (active.locked && !unlockedIds.has(active.id))) return;
  const matches = getRawSearchMatches(active.body, keyword);
  if (!matches.length) return;
  const replacement = noteReplaceInput.value;
  let body = active.body;
  const selected = replaceAll
    ? matches
    : [matches[Math.max(0, Math.min(noteSearchCurrentIndex, matches.length - 1))]];
  for (let i = selected.length - 1; i >= 0; i--) {
    const m = selected[i];
    body = body.slice(0, m.start) + replacement + body.slice(m.end);
  }
  if (body === active.body) return;
  active.body = body;
  active.updatedAt = Date.now();
  persist();
  clearNoteSearchHighlights();
  noteSearchCurrentIndex = -1;
  render();
  runNoteSearch(keyword);
}

function collectTextNodes(el) {
  const nodes = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

function clearNoteSearchHighlights() {
  document.querySelectorAll(".note-search-hit").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });
}

function runNoteSearch(keyword) {
  clearNoteSearchHighlights();
  noteSearchMatches = [];
  noteSearchCurrentIndex = -1;

  if (!keyword) {
    noteSearchCount.textContent = "0/0";
    return;
  }

  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const editor = getCurrentEditableEl();
  // Search a logical line across inline formatting nodes without searching toolbars.
  for (const line of Array.from(editor.childNodes)) {
    if (line.nodeType !== Node.TEXT_NODE && line.getAttribute?.("contenteditable") === "false") continue;
    const nodes = line.nodeType === Node.TEXT_NODE ? [line] : collectTextNodes(line);
    let offset = 0;
    const spans = nodes.map(node => { const start = offset; offset += node.textContent.length; return {node,start,end:offset}; });
    const text = nodes.map(node => node.textContent).join("");
    const matches = Array.from(text.matchAll(new RegExp(escapedKeyword, "gi")));
    const lineMatches = [];
    // Split from the end so original text-node offsets remain valid.
    for (let i = matches.length - 1; i >= 0; i--) {
      const start = matches[i].index, end = start + matches[i][0].length;
      const parts = [];
      for (let j = spans.length - 1; j >= 0; j--) {
        const span = spans[j];
        const from = Math.max(start, span.start), to = Math.min(end, span.end);
        if (from >= to) continue;
        const range = document.createRange();
        range.setStart(span.node, from - span.start);
        range.setEnd(span.node, to - span.start);
        const mark = document.createElement("span"); mark.className = "note-search-hit";
        range.surroundContents(mark);
        parts.unshift(mark);
      }
      if (parts.length) { parts[0].searchParts = parts; lineMatches.unshift(parts[0]); }
    }
    noteSearchMatches.push(...lineMatches);
  }

  noteSearchCount.textContent = noteSearchMatches.length > 0 ? `0/${noteSearchMatches.length}` : "0/0";
  if (noteSearchMatches.length > 0) {
    goToNoteSearchMatch(0);
  }
}

function goToNoteSearchMatch(index) {
  if (noteSearchMatches.length === 0) return;
  const wrapped = ((index % noteSearchMatches.length) + noteSearchMatches.length) % noteSearchMatches.length;
  if (noteSearchCurrentIndex >= 0 && noteSearchMatches[noteSearchCurrentIndex]) {
    const previous = noteSearchMatches[noteSearchCurrentIndex];
    (previous.searchParts || [previous]).forEach(part => part.classList.remove("current"));
  }
  noteSearchCurrentIndex = wrapped;
  const el = noteSearchMatches[noteSearchCurrentIndex];
  (el.searchParts || [el]).forEach(part => part.classList.add("current"));
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  noteSearchCount.textContent = `${noteSearchCurrentIndex + 1}/${noteSearchMatches.length}`;
}

noteSearchInput.oninput = (e) => runNoteSearch(e.target.value);

noteSearchInput.onkeydown = (e) => {
  if (e.isComposing) return;
  if (e.key === "Enter") {
    e.preventDefault();
    if (e.shiftKey) {
      goToNoteSearchMatch(noteSearchCurrentIndex - 1);
    } else {
      goToNoteSearchMatch(noteSearchCurrentIndex + 1);
    }
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    closeNoteSearch();
  }
};

noteSearchNextBtn.onclick = () => goToNoteSearchMatch(noteSearchCurrentIndex + 1);
noteSearchPrevBtn.onclick = () => goToNoteSearchMatch(noteSearchCurrentIndex - 1);
noteReplaceBtn.onclick = () => replaceNoteSearchMatch(false);
noteReplaceAllBtn.onclick = () => replaceNoteSearchMatch(true);
noteSearchCloseBtn.onclick = () => closeNoteSearch();
