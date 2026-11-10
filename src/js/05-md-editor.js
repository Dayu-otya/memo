

let mdActiveLineIndex = null;
let mdRefreshTimer = null;
let isComposingMd = false;

const mdUndoStacks = new Map();
const mdRedoStacks = new Map();
const MD_UNDO_STACK_LIMIT = 200;

function mdGetStack(map, noteId) {
  let stack = map.get(noteId);
  if (!stack) {
    stack = [];
    map.set(noteId, stack);
  }
  return stack;
}

function mdPushUndoSnapshot(active) {
  if (!active) return;
  const undoStack = mdGetStack(mdUndoStacks, active.id);
  const caret = getCaretLineOffset(mdPreview);
  undoStack.push({
    body: active.body,
    bodyCaret: getCaretOffset(bodyInput),
    lineIndex: mdActiveLineIndex,
    caretOffset: caret ? caret.offset : 0,
  });
  if (undoStack.length > MD_UNDO_STACK_LIMIT) undoStack.shift();
  mdRedoStacks.set(active.id, []);
}

function mdUndo() {
  const active = getActive();
  if (!active) return;
  const undoStack = mdGetStack(mdUndoStacks, active.id);
  if (undoStack.length === 0) return;
  const redoStack = mdGetStack(mdRedoStacks, active.id);
  const currentCaret = getCaretLineOffset(mdPreview);
  redoStack.push({
    body: active.body,
    bodyCaret: getCaretOffset(bodyInput),
    lineIndex: mdActiveLineIndex,
    caretOffset: currentCaret ? currentCaret.offset : 0,
  });
  const snapshot = undoStack.pop();
  mdRestoreSnapshot(active, snapshot);
}

function mdRedo() {
  const active = getActive();
  if (!active) return;
  const redoStack = mdGetStack(mdRedoStacks, active.id);
  if (redoStack.length === 0) return;
  const undoStack = mdGetStack(mdUndoStacks, active.id);
  const currentCaret = getCaretLineOffset(mdPreview);
  undoStack.push({
    body: active.body,
    bodyCaret: getCaretOffset(bodyInput),
    lineIndex: mdActiveLineIndex,
    caretOffset: currentCaret ? currentCaret.offset : 0,
  });
  const snapshot = redoStack.pop();
  mdRestoreSnapshot(active, snapshot);
}

function mdRestoreSnapshot(active, snapshot) {
  active.body = snapshot.body;
  active.updatedAt = Date.now();
  updateCounts(active.body);
  persist();
  renderList();

  if (!active.markdownPreview) {
    bodyInput.innerHTML = buildEditableHtml(active.body);
    setCaretOffset(bodyInput, snapshot.bodyCaret || 0);
    return;
  }
  mdActiveLineIndex = snapshot.lineIndex;
  mdPreview.innerHTML = buildMdEditableHtml(active.body, mdActiveLineIndex);
  if (mdActiveLineIndex !== null) {
    setCaretLineOffset(mdPreview, mdActiveLineIndex, snapshot.caretOffset || 0);
  }
}

let mdPendingConfirm = false;

const mdDebugStartedAt = Date.now();
const MD_DEBUG_ENABLED = false;
function mdDebugLog(label, extra) {
  if (!MD_DEBUG_ENABLED) return;
  const t = (Date.now() - mdDebugStartedAt).toString().padStart(6, " ");
  const html = mdPreview ? mdPreview.innerHTML : "(mdPreview未定義)";
  const sel = window.getSelection ? window.getSelection() : null;
  let selInfo = "(selectionなし)";
  try {
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      selInfo = `collapsed=${r.collapsed} startOffset=${r.startOffset} endOffset=${r.endOffset} startContainer=${r.startContainer && r.startContainer.nodeName}(${r.startContainer && (r.startContainer.textContent || "").slice(0, 20)})`;
    }
  } catch (e) {
    selInfo = "(selection取得エラー: " + e.message + ")";
  }
  console.log(
    `%c[MD-DEBUG t=${t}ms] ${label}`,
    "color: #e91e63; font-weight: bold;",
    extra || ""
  );
  console.log(`  isComposingMd=${isComposingMd} mdPendingConfirm=${mdPendingConfirm} mdActiveLineIndex=${mdActiveLineIndex}`);
  console.log(`  selection: ${selInfo}`);
  console.log(`  mdPreview.innerHTML:`, html);
  const active = typeof getActive === "function" ? getActive() : null;
  if (active) {
    console.log(`  active.body:`, JSON.stringify(active.body));
  }
}
window.__mdDebugDump = () => {
  console.log("===== 現在のmdPreview.innerHTML =====");
  console.log(mdPreview.innerHTML);
  const active = getActive();
  console.log("===== 現在のactive.body =====");
  console.log(JSON.stringify(active && active.body));
};

function getCurrentMdLineIndex() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let node = sel.getRangeAt(0).startContainer;
  if (!mdPreview.contains(node)) return null;
  while (node && node !== mdPreview) {
    if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute && node.hasAttribute("data-line")) {
      return Number(node.getAttribute("data-line"));
    }
    node = node.parentNode;
  }
  return null;
}

function getPlainTextFromMdEditable(currentBody) {
  const originalLines = currentBody.split("\n");
  const resultLines = [];

  mdPreview.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text === "") return;
      resultLines.push(text);
      return;
    }
    if (node.nodeName === "BR") {
      resultLines.push("");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    if (node.classList.contains("md-code-warning") || node.classList.contains("md-math-preview") || node.classList.contains("md-code-toolbar") || node.classList.contains("md-table-preview")) {
      return;
    }

    const hasLineAttr = node.hasAttribute && node.hasAttribute("data-line");
    const currentText = node.textContent === "" && node.querySelector && node.querySelector("br") ? "" : node.textContent;

    if (!hasLineAttr) {
      resultLines.push(currentText);
      return;
    }

    const idx = Number(node.getAttribute("data-line"));
    const originalLine = originalLines[idx] || "";

    if (node.classList.contains("md-line-raw") || node.classList.contains("md-line-code")) {
      resultLines.push(currentText);
      return;
    }

    resultLines.push(originalLine);
  });

  return resultLines.join("\n");
}

function resolveLineOffset(el, container, containerOffset) {
  if (container === el) {
    const lines = (getActive()?.body || "").split("\n");
    if (containerOffset === 0) return { lineIndex: 0, offset: 0 };
    if (containerOffset >= el.childNodes.length) return { lineIndex: lines.length - 1, offset: lines.at(-1).length };
    const next = Array.from(el.childNodes).slice(containerOffset).find(n => n.hasAttribute?.("data-line"));
    if (next) return { lineIndex: Number(next.getAttribute("data-line")), offset: 0 };
    return { lineIndex: lines.length - 1, offset: lines.at(-1).length };
  }
  if (!el.contains(container)) return null;

  let lineNode = container.nodeType === Node.ELEMENT_NODE ? container : container.parentNode;
  while (lineNode && lineNode !== el && !(lineNode.hasAttribute && lineNode.hasAttribute("data-line"))) {
    lineNode = lineNode.parentNode;
  }
  if (!lineNode || lineNode === el) return null;

  let offset = 0;
  let found = false;
  function walk(n) {
    if (found) return;
    if (n === container) {
      if (n.nodeType === Node.TEXT_NODE) {
        offset += containerOffset;
      } else {

        for (let i = 0; i < containerOffset && i < n.childNodes.length; i++) {
          offset += n.childNodes[i].textContent.length;
        }
      }
      found = true;
      return;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      offset += n.textContent.length;
      return;
    }
    if (n.nodeName === "BR") {
      if (n === container) found = true;
      return;
    }
    for (const child of n.childNodes) {
      walk(child);
      if (found) return;
    }
    if (n === container) found = true;
  }
  walk(lineNode);

  const lineIndex = Number(lineNode.getAttribute("data-line"));
  if (!lineNode.classList.contains("md-line-raw") && !lineNode.classList.contains("md-line-code")) {
    offset = formattedOffsetToRaw((getActive()?.body || "").split("\n")[lineIndex] || "", offset);
  }
  return { lineIndex, offset };
}

function getCaretLineOffset(el) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  return resolveLineOffset(el, range.startContainer, range.startOffset);
}

function setCaretLineOffset(el, lineIndex, offset) {
  if (!canRestoreEditorCaret()) return true; // 再描画だけ行い、入力の受け口は動かさない
  const lineNode = el.querySelector(`[data-line="${lineIndex}"]`);
  if (!lineNode) return false;

  let remaining = offset;
  let targetNode = null;
  let targetOffset = 0;

  function walk(n) {
    if (targetNode) return;
    if (n.nodeType === Node.TEXT_NODE) {
      const len = n.textContent.length;
      if (remaining <= len) {
        targetNode = n;
        targetOffset = remaining;
        remaining = -1;
      } else {
        remaining -= len;
      }
      return;
    }
    if (n.nodeName === "BR") {
      if (remaining <= 0) {
        targetNode = n.parentNode;
        targetOffset = Array.prototype.indexOf.call(n.parentNode.childNodes, n);
        remaining = -1;
      }
      return;
    }
    for (const child of n.childNodes) {
      walk(child);
      if (targetNode) return;
    }
  }
  walk(lineNode);

  if (!targetNode) {
    targetNode = lineNode;
    targetOffset = lineNode.childNodes.length;
  }

  const sel = window.getSelection();
  if (!sel) return false;
  const range = document.createRange();
  try {
    range.setStart(targetNode, targetOffset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch (e) {
    return false;
  }
}

function buildRawToFormattedMap(content) {
  const map = [0];
  let formattedLen = 0;
  let i = 0;

  function advanceRaw(rawSpan, addedFormattedLen) {
    for (let k = 0; k < rawSpan; k++) {
      formattedLen += addedFormattedLen ? addedFormattedLen(k, rawSpan) : 0;
      map.push(formattedLen);
    }
  }

  while (i < content.length) {
    const rest = content.slice(i);
    let m;
    if ((m = rest.match(/^\$\$(.+?)\$\$/))) {

      advanceRaw(m[0].length, (k) => (k === m[0].length - 1 ? 1 : 0));
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/))) {
      advanceRaw(m[0].length, (k) => (k === m[0].length - 1 ? 1 : 0));
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^`([^`]+?)`/))) {

      const inner = m[1];
      advanceRaw(1, () => 0);
      for (let k = 0; k < inner.length; k++) {
        formattedLen += 1;
        map.push(formattedLen);
      }
      advanceRaw(1, () => 0);
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^\*\*\*(.+?)\*\*\*/))) {

      advanceRaw(3, () => 0);
      const inner = m[1];
      for (let k = 0; k < inner.length; k++) {
        formattedLen += 1;
        map.push(formattedLen);
      }
      advanceRaw(3, () => 0);
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^\*\*(.+?)\*\*/))) {
      advanceRaw(2, () => 0);
      const inner = m[1];
      for (let k = 0; k < inner.length; k++) {
        formattedLen += 1;
        map.push(formattedLen);
      }
      advanceRaw(2, () => 0);
      i += m[0].length;
      continue;
    }

    if (
      (m = rest.match(/^\*(?!\s)(.+?)(?<!\s)\*(?!\w)/)) &&
      (i === 0 || !/\w/.test(content[i - 1]))
    ) {
      advanceRaw(1, () => 0);
      const inner = m[1];
      for (let k = 0; k < inner.length; k++) {
        formattedLen += 1;
        map.push(formattedLen);
      }
      advanceRaw(1, () => 0);
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^~~(.+?)~~/))) {
      advanceRaw(2, () => 0);
      const inner = m[1];
      for (let k = 0; k < inner.length; k++) {
        formattedLen += 1;
        map.push(formattedLen);
      }
      advanceRaw(2, () => 0);
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^\[([^\]]+)\]\(((?:https?:\/\/)(?:[^\s()]|\([^\s()]*\))+)\)/))) {

      const label = m[1];
      const prefixRaw = 1;
      advanceRaw(prefixRaw, () => 0);
      for (let k = 0; k < label.length; k++) {
        formattedLen += 1;
        map.push(formattedLen);
      }
      const suffixRaw = m[0].length - prefixRaw - label.length;
      advanceRaw(suffixRaw, () => 0);
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^\[\[(.+?)\]\]/))) {

      advanceRaw(2, () => 0);
      const inner = m[1];
      for (let k = 0; k < inner.length; k++) {
        formattedLen += 1;
        map.push(formattedLen);
      }
      advanceRaw(2, () => 0);
      i += m[0].length;
      continue;
    }

    formattedLen += 1;
    map.push(formattedLen);
    i += 1;
  }

  return map;
}

function formattedTextLength(rawLine) {
  const cls = classifyLine(rawLine);
  const content = cls.type === "text" ? rawLine : cls.content;
  const map = buildRawToFormattedMap(content);
  return map[map.length - 1];
}

function formattedOffsetToRaw(rawLine, formattedOffset) {
  const cls = classifyLine(rawLine);
  let prefixLen = 0;
  if (cls.type === "heading") prefixLen = cls.level + 1;
  else if (cls.type === "checkbox") prefixLen = cls.marker.length + 5;
  else if (cls.type === "ordered") prefixLen = cls.number.length + 2;
  else if (cls.type === "list") prefixLen = 2;
  else if (cls.type === "quote") prefixLen = 2;
  const content = cls.type === "text" ? rawLine : cls.content;
  const map = buildRawToFormattedMap(content);
  const maxFormatted = map[map.length - 1];
  const clamped = Math.max(0, Math.min(formattedOffset, maxFormatted));

  let rawOffsetInContent = map.length - 1;
  for (let k = 0; k < map.length; k++) {
    if (map[k] >= clamped) {
      rawOffsetInContent = k;
      break;
    }
  }
  return Math.min(prefixLen + rawOffsetInContent, rawLine.length);
}

function refreshMdPreview() {
  mdDebugLog("refreshMdPreview START (DOM再構築)");
  const active = getActive();
  if (!active) return;
  const lineOffset = getCaretLineOffset(mdPreview);
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && mdPreview.contains(selection.anchorNode)) return;
  const prevActiveLine = mdActiveLineIndex;
  mdActiveLineIndex = getCurrentMdLineIndex();
  mdPreview.innerHTML = buildMdEditableHtml(active.body, mdActiveLineIndex);

  if (lineOffset) {
    const rawLines = active.body.split("\n");
    const movedToNewLine = mdActiveLineIndex !== prevActiveLine;
    const rawLine = rawLines[lineOffset.lineIndex] || "";
    const targetOffset = lineOffset.offset;
    const restored = setCaretLineOffset(mdPreview, lineOffset.lineIndex, targetOffset);
    if (!restored) {
      const caret = getCaretOffset(mdPreview);
      if (caret !== null) setCaretOffset(mdPreview, caret);
    }
  }
}

mdPreview.oninput = (e) => {
  mdDebugLog("oninput", { inputType: e && e.inputType, data: e && e.data });

  if (e && e.inputType === "insertCompositionText") {
    mdPendingConfirm = true;
    return;
  }

  if (e && e.inputType === "insertText") {
    mdPendingConfirm = false;
  }

  const active = getActive();
  if (!active) return;

  if (isComposingMd || mdPendingConfirm) return;

  const nextBody = getPlainTextFromMdEditable(active.body);
  if (nextBody === active.body) return;
  mdPushUndoSnapshot(active);
  active.body = nextBody;
  active.updatedAt = Date.now();
  updateCounts(active.body);
  persist();
  renderList();

  if (mdRefreshTimer) clearTimeout(mdRefreshTimer);
  mdRefreshTimer = setTimeout(() => {
    mdRefreshTimer = null;
    if (!isComposingMd && !mdPendingConfirm) refreshMdPreview();
  }, 300);
};

mdPreview.oncompositionstart = (e) => {
  mdDebugLog("oncompositionstart", { data: e && e.data });
  isComposingMd = true;
  mdPendingConfirm = true;

  normalizeEmptyLineForComposition(mdPreview);

  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed) {
    const range = sel.getRangeAt(0);
    const startPos = resolveLineOffset(mdPreview, range.startContainer, range.startOffset);
    const endPos = resolveLineOffset(mdPreview, range.endContainer, range.endOffset);
    if (startPos && endPos && startPos.lineIndex !== endPos.lineIndex) {
      deleteMdSelectionRange(startPos, endPos, "");
    }
  }
};

mdPreview.addEventListener("compositionupdate", (e) => {
  mdDebugLog("compositionupdate", { data: e && e.data });

  mdPendingConfirm = true;
});

mdPreview.oncompositionend = (e) => {
  mdDebugLog("oncompositionend", { data: e && e.data });
  isComposingMd = false;
  confirmMdPendingInput();
};

function confirmMdPendingInput() {
  mdDebugLog("confirmMdPendingInput called");
  if (!mdPendingConfirm) return;
  mdPendingConfirm = false;
  const active = getActive();
  if (!active) return;
  const nextBody = getPlainTextFromMdEditable(active.body);
  if (nextBody === active.body) return;
  mdPushUndoSnapshot(active);
  active.body = nextBody;
  active.updatedAt = Date.now();
  updateCounts(active.body);
  persist();
  renderList();
  if (mdRefreshTimer) clearTimeout(mdRefreshTimer);
  mdRefreshTimer = null;
  refreshMdPreview();
}

function handleMdLineFocusChange() {

  if (mdPendingConfirm) {
    confirmMdPendingInput();
    return;
  }
  const idx = getCurrentMdLineIndex();
  if (idx === mdActiveLineIndex) return;
  refreshMdPreview();
}

mdPreview.addEventListener("keyup", (e) => {

  if (isComposingMd || e.isComposing || e.keyCode === 229) return;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
    handleMdLineFocusChange();
  }
});

mdPreview.addEventListener("mouseup", (e) => {
  if (e.target.closest(".note-link")) return;

  if (e.target.closest("[data-copy-block], [data-copy-line], .md-code-toolbar")) return;
  handleMdLineFocusChange();
});

mdPreview.addEventListener("focus", () => {
  handleMdLineFocusChange();
});

mdPreview.addEventListener("blur", (e) => {
  mdDebugLog("blur", { relatedTarget: e.relatedTarget && e.relatedTarget.tagName });

  const movingTo = e.relatedTarget;
  if (movingTo && movingTo.closest && movingTo.closest("[data-copy-block], [data-copy-line], .md-code-toolbar")) {
    return;
  }

  isComposingMd = false;
  if (mdPendingConfirm) {
    confirmMdPendingInput();
  }

  if (mdActiveLineIndex !== null) {
    mdActiveLineIndex = null;
    refreshMdPreview();
  }
});

function deleteMdSelectionRange(startPos, endPos, insertText) {
  const active = getActive();
  if (!active) return null;
  const rawLines = active.body.split("\n");
  const startLine = rawLines[startPos.lineIndex] || "";
  const endLine = rawLines[endPos.lineIndex] || "";
  const merged = startLine.slice(0, startPos.offset) + insertText + endLine.slice(endPos.offset);
  rawLines.splice(startPos.lineIndex, endPos.lineIndex - startPos.lineIndex + 1, merged);
  mdPushUndoSnapshot(active);
  active.body = rawLines.join("\n");
  active.updatedAt = Date.now();
  updateCounts(active.body);
  persist();
  renderList();

  mdActiveLineIndex = startPos.lineIndex;
  mdPreview.innerHTML = buildMdEditableHtml(active.body, mdActiveLineIndex);
  const caretOffset = startPos.offset + insertText.length;
  setCaretLineOffset(mdPreview, mdActiveLineIndex, caretOffset);
  return caretOffset;
}

function insertMdTextAtRange(startPos, endPos, text) {
  const active = getActive();
  if (!active) return null;
  const rawLines = active.body.split("\n");
  const startLine = rawLines[startPos.lineIndex] || "";
  const endLine = rawLines[endPos.lineIndex] || "";
  const insertedLines = text.split("\n");
  insertedLines[0] = startLine.slice(0, startPos.offset) + insertedLines[0];
  insertedLines[insertedLines.length - 1] += endLine.slice(endPos.offset);
  rawLines.splice(startPos.lineIndex, endPos.lineIndex - startPos.lineIndex + 1, ...insertedLines);
  mdPushUndoSnapshot(active);
  active.body = rawLines.join("\n");
  active.updatedAt = Date.now();
  updateCounts(active.body);
  persist();
  renderList();

  mdActiveLineIndex = startPos.lineIndex + insertedLines.length - 1;
  mdPreview.innerHTML = buildMdEditableHtml(active.body, mdActiveLineIndex);
  const lastInsertedLine = insertedLines[insertedLines.length - 1];
  const caretOffset = insertedLines.length === 1 ? startPos.offset + text.length : lastInsertedLine.length - endLine.slice(endPos.offset).length;
  setCaretLineOffset(mdPreview, mdActiveLineIndex, caretOffset);
  return caretOffset;
}

mdPreview.addEventListener("keydown", (e) => {
  mdDebugLog("keydown", { key: e.key, isComposing: e.isComposing, keyCode: e.keyCode });
  if (e.key !== "Enter") return;

  if (e.isComposing || e.keyCode === 229) return;

  if (mdPendingConfirm) {
    e.preventDefault();
    confirmMdPendingInput();
    return;
  }

  e.preventDefault();
  const active = getActive();
  if (!active) return;

  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed) {
    const range = sel.getRangeAt(0);
    const startPos = resolveLineOffset(mdPreview, range.startContainer, range.startOffset);
    const endPos = resolveLineOffset(mdPreview, range.endContainer, range.endOffset);
    if (startPos && endPos) { insertMdTextAtRange(startPos, endPos, "\n"); return; }
  }

  const pos = getCaretLineOffset(mdPreview);
  if (!pos) return;

  const rawLines = active.body.split("\n");
  const rawLine = rawLines[pos.lineIndex] || "";
  const before = rawLine.slice(0, pos.offset);
  const after = rawLine.slice(pos.offset);
  rawLines.splice(pos.lineIndex, 1, before, after);
  mdPushUndoSnapshot(active);
  active.body = rawLines.join("\n");
  active.updatedAt = Date.now();
  updateCounts(active.body);
  persist();
  renderList();

  mdActiveLineIndex = pos.lineIndex + 1;
  mdPreview.innerHTML = buildMdEditableHtml(active.body, mdActiveLineIndex);
  setCaretLineOffset(mdPreview, mdActiveLineIndex, 0);
});

mdPreview.addEventListener("beforeinput", (e) => {
  mdDebugLog("beforeinput", { inputType: e.inputType, data: e.data, isComposing: e.isComposing });
  const active = getActive();
  if (!active) return;

  if (e.inputType !== "insertText" && (isComposingMd || e.isComposing || mdPendingConfirm || e.inputType === "insertCompositionText")) return;

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);

  if (!range.collapsed) {
    const startPos = resolveLineOffset(mdPreview, range.startContainer, range.startOffset);
    const endPos = resolveLineOffset(mdPreview, range.endContainer, range.endOffset);
    if (!startPos || !endPos) {

      return;
    }

    const insertData = typeof e.data === "string" ? e.data : "";

    if (!["insertText", "insertReplacementText", "deleteContentBackward", "deleteContentForward", "deleteByCut"].includes(e.inputType)) return;
    e.preventDefault();
    insertMdTextAtRange(startPos, endPos, insertData);
    return;
  }

  if (e.inputType !== "deleteContentBackward" && e.inputType !== "deleteContentForward") {

    if (typeof e.data === "string" && e.data.includes("\n")) {
      const pos = resolveLineOffset(mdPreview, range.startContainer, range.startOffset);
      if (pos) {
        e.preventDefault();
        insertMdTextAtRange(pos, pos, e.data);
      }
    }
    return;
  }

  const pos = resolveLineOffset(mdPreview, range.startContainer, range.startOffset);
  if (!pos) return;
  const rawLines = active.body.split("\n");
  const rawLine = rawLines[pos.lineIndex] || "";

  if (e.inputType === "deleteContentBackward" && pos.offset === 0 && pos.lineIndex > 0) {
    e.preventDefault();
    const prevLine = rawLines[pos.lineIndex - 1] || "";
    deleteMdSelectionRange({ lineIndex: pos.lineIndex - 1, offset: prevLine.length }, pos, "");
    return;
  }

  if (e.inputType === "deleteContentForward" && pos.offset === rawLine.length && pos.lineIndex < rawLines.length - 1) {
    e.preventDefault();
    deleteMdSelectionRange(pos, { lineIndex: pos.lineIndex + 1, offset: 0 }, "");
    return;
  }
});

mdPreview.onpaste = (e) => {
  e.preventDefault();
  const text = e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const start = resolveLineOffset(mdPreview, range.startContainer, range.startOffset);
  const end = resolveLineOffset(mdPreview, range.endContainer, range.endOffset);
  if (start && end) insertMdTextAtRange(start, end, text);
};

mdPreview.addEventListener("cut", (e) => {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const start = resolveLineOffset(mdPreview, range.startContainer, range.startOffset);
  const end = resolveLineOffset(mdPreview, range.endContainer, range.endOffset);
  if (!start || !end) return;
  e.preventDefault();
  e.clipboardData.setData("text/plain", selectedMdSource(start, end));
  insertMdTextAtRange(start, end, "");
});
function selectedMdSource(start, end) {
  const lines = getActive().body.split("\n");
  const offsets = pos => lines.slice(0, pos.lineIndex).reduce((sum, line) => sum + line.length + 1, 0) + pos.offset;
  return getActive().body.slice(offsets(start), offsets(end));
}
mdPreview.addEventListener("copy", (e) => {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const start = resolveLineOffset(mdPreview, range.startContainer, range.startOffset);
  const end = resolveLineOffset(mdPreview, range.endContainer, range.endOffset);
  if (start && end) { e.preventDefault(); e.clipboardData.setData("text/plain", selectedMdSource(start, end)); }
});

function wrapBodySelection(prefix, suffix) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!bodyInput.contains(range.startContainer) && range.startContainer !== bodyInput) return;

  const selectedText = sel.toString();
  if (selectedText.length === 0) {
    document.execCommand("insertText", false, prefix + suffix);

    const newSel = window.getSelection();
    if (newSel) {
      for (let i = 0; i < suffix.length; i++) {
        newSel.modify("move", "backward", "character");
      }
    }
    return;
  }

  document.execCommand("insertText", false, prefix + selectedText + suffix);
}

function wrapMdSelection(prefix, suffix) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!mdPreview.contains(range.startContainer) && range.startContainer !== mdPreview) return;

  const active = getActive();
  if (!active) return;

  if (range.collapsed) {

    document.execCommand("insertText", false, prefix + suffix);
    const newSel = window.getSelection();
    if (newSel) {
      for (let i = 0; i < suffix.length; i++) {
        newSel.modify("move", "backward", "character");
      }
    }
    return;
  }

  const startPos = resolveLineOffset(mdPreview, range.startContainer, range.startOffset);
  const endPos = resolveLineOffset(mdPreview, range.endContainer, range.endOffset);
  if (!startPos || !endPos) return;

  if (startPos.lineIndex === endPos.lineIndex) {

    const selectedText = sel.toString();
    document.execCommand("insertText", false, prefix + selectedText + suffix);
    return;
  }

  const selectedText = sel.toString();
  insertMdTextAtRange(startPos, endPos, prefix + selectedText + suffix);
}

