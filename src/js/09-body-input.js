

function normalizeEmptyLineForComposition(containerEl) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  let node = range.startContainer;
  if (!containerEl.contains(node)) return;
  let lineEl = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
  while (lineEl && lineEl !== containerEl && lineEl.parentNode !== containerEl) {
    lineEl = lineEl.parentNode;
  }
  if (!lineEl || lineEl === containerEl) return;
  if (lineEl.childNodes.length === 1 && lineEl.firstChild.nodeName === "BR") {
    const textNode = document.createTextNode("");
    lineEl.replaceChild(textNode, lineEl.firstChild);
    const newRange = document.createRange();
    newRange.setStart(textNode, 0);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }
}

let isComposingBody = false;
let highlightRefreshTimer = null;

function isBodyInputActive(e) {
  if (e && e.target && e.target !== bodyInput) return false;
  const focused = document.activeElement;
  return !focused || focused === bodyInput || bodyInput.contains(focused);
}

function scheduleHighlightRefresh() {
  if (highlightRefreshTimer) clearTimeout(highlightRefreshTimer);
  highlightRefreshTimer = setTimeout(() => {
    highlightRefreshTimer = null;
    if (!isComposingBody && document.activeElement !== bodyInput) refreshEditableHighlight();
  }, 250);
}

bodyInput.oninput = (e) => {
  if (!isBodyInputActive(e)) return;
  const active = getActive();
  if (!active || isComposingBody) return;
  const nextBody = getPlainTextFromEditable(bodyInput);
  if (nextBody === active.body) return;
  mdPushUndoSnapshot(active);
  active.body = nextBody;
  bodyInput.querySelectorAll(".note-title-line").forEach(el => el.classList.remove("note-title-line"));
  if (bodyInput.firstElementChild) bodyInput.firstElementChild.classList.add("note-title-line");
  active.updatedAt = Date.now();
  updateCounts(active.body);
  persist();

  if (!isComposingBody) renderList();
  if (active.body.includes("```")) {
    scheduleHighlightRefresh();
  }
};

bodyInput.oncompositionstart = () => {
  isComposingBody = true;
  normalizeEmptyLineForComposition(bodyInput);
};

bodyInput.oncompositionend = () => {
  isComposingBody = false;
  bodyInput.oninput();
  const active = getActive();
  if (active && active.body.includes("```")) scheduleHighlightRefresh();
};

bodyInput.onpaste = (e) => {
  if (!isBodyInputActive(e)) return;
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text/plain");
  document.execCommand("insertText", false, text);
};

bodyInput.onkeydown = (e) => {
  if (!isBodyInputActive(e)) return;
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  document.execCommand("insertParagraph");
};
bodyInput.addEventListener("blur", () => {
  if (isComposingBody) { isComposingBody = false; bodyInput.oninput(); }
});

pinBtn.onclick = () => {
  const active = getActive();
  if (active) togglePin(active.id);
};

deleteBtn.onclick = () => {
  const active = getActive();
  if (active) moveToTrash(active.id);
};

selectionDeleteBtn.onclick = async () => {
  const count = selectedIds.size;
  if (count === 0) return;
  const ok = await askConfirm(`選択中の${count}件のメモをゴミ箱へ移動します。よろしいですか?`);
  if (ok) moveToTrash(Array.from(selectedIds));
};

selectionFolderSelect.onchange = (e) => {
  if (selectedIds.size === 0) return;
  setFolder(Array.from(selectedIds), e.target.value);
  clearSelection();
  render();
};

selectionClearBtn.onclick = () => {
  clearSelection();
  render();
};

selectionSelectAllBtn.onclick = () => {
  const visible = getFiltered();
  if (visible.length === 0) return;
  selectedIds = new Set(visible.map((n) => n.id));
  lastClickedId = visible[visible.length - 1].id;
  render();
};

exportBtn.onclick = () => {
  exportMenu.style.display = exportMenu.style.display === "none" ? "flex" : "none";
};

document.addEventListener("click", (e) => {
  if (!exportMenu.contains(e.target) && e.target !== exportBtn) {
    exportMenu.style.display = "none";
  }
});


// Prevent rich HTML and file navigation from being inserted by drag-and-drop.
for (const editor of [bodyInput, mdPreview]) {
  editor.addEventListener("dragover", e => e.preventDefault());
  editor.addEventListener("drop", e => {
    e.preventDefault();
    if (draggedIds.length || e.dataTransfer.files.length) return;
    const text = e.dataTransfer.getData("text/plain").replace(/\r\n?/g, "\n");
    if (!text) return;
    editor.focus();
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range || !editor.contains(range.startContainer)) return;
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    if (editor === bodyInput) document.execCommand("insertText", false, text);
    else {
      const pos = resolveLineOffset(mdPreview, range.startContainer, range.startOffset);
      if (pos) insertMdTextAtRange(pos, pos, text);
    }
  });
  editor.addEventListener("beforeinput", e => {
    if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
      e.preventDefault();
      if (e.inputType === "historyUndo") mdUndo(); else mdRedo();
    }
  });
}
