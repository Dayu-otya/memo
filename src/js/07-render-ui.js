

function renderNoteListItem(n) {
  const c = TAG_COLORS[n.color] || TAG_COLORS[0];
  const item = document.createElement("div");
  const isSelected = selectedIds.has(n.id);
  item.className =
    "note-item" +
    (n.id === activeId && selectedIds.size === 0 ? " active" : "") +
    (isSelected ? " selected" : "");
  if (n.id === activeId && selectedIds.size === 0) {
    item.style.border = `1px solid ${c.border}`;
  }

  item.onclick = (e) => {
    if (e.ctrlKey || e.metaKey) {
      toggleSelect(n.id);
      renderList();
      return;
    }
    if (e.shiftKey) {
      selectRangeTo(n.id);
      renderList();
      return;
    }
    clearSelection();
    activeId = n.id;
    lastClickedId = n.id;
    viewMode = "editor";
    render();
  };

  item.draggable = true;
  item.ondragstart = (e) => {
    draggedIds = selectedIds.has(n.id) ? Array.from(selectedIds) : [n.id];
    item.classList.add("drag-source");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", n.id);
  };
  item.ondragend = () => {
    item.classList.remove("drag-source");
    draggedIds = [];
  };

  const titleRow = document.createElement("div");
  titleRow.className = "note-item-title-row";

  const dot = document.createElement("span");
  dot.className = "note-dot";
  dot.style.background = c.border;
  titleRow.appendChild(dot);

  const keywords = parseQueryTokens(query).keywords;
  const title = document.createElement("span");
  title.className = "note-title";
  const rawTitle = titleFromBody(n.body);
  if (n.locked) {
    title.textContent = "🔒 " + rawTitle;
  } else {
    title.innerHTML = highlightText(rawTitle, keywords);
  }
  titleRow.appendChild(title);

  if (n.pinned) {
    const pinMark = document.createElement("span");
    pinMark.textContent = "[固定]";
    pinMark.className = "pin-mark";
    titleRow.appendChild(pinMark);
  }

  const meta = document.createElement("div");
  meta.className = "note-meta";

  const exc = document.createElement("span");
  exc.className = "note-excerpt";
  if (n.locked) {
    exc.textContent = "(ロック中)";
  } else {
    const restBody = n.body.split("\n").slice(1).join(" ");
    const excerptText = excerpt(restBody) || "（本文なし）";
    exc.innerHTML = highlightText(excerptText, keywords);
  }
  meta.appendChild(exc);

  const date = document.createElement("span");
  date.textContent = formatDate(n.updatedAt);
  meta.appendChild(date);

  item.appendChild(titleRow);
  item.appendChild(meta);

  if (n.tags.length > 0) {
    const tagRow = document.createElement("div");
    tagRow.className = "note-item-tags";
    n.tags.forEach((t) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip small";
      chip.textContent = t;
      chip.style.background = colorForTag(t);
      chip.style.borderColor = colorForTag(t);
      tagRow.appendChild(chip);
    });
    item.appendChild(tagRow);
  }

  return item;
}

function renderList() {
  const filtered = getFiltered();
  noteListEl.innerHTML = "";

  if (filtered.length === 0) {
    const msg = document.createElement("div");
    msg.className = "empty-list-msg";
    msg.textContent =
      notes.filter((n) => !isTrashed(n)).length === 0
        ? "メモはまだありません。右上の＋から書き始めてください。"
        : "該当するメモが見つかりませんでした。";
    noteListEl.appendChild(msg);
    return;
  }

  filtered.forEach((n) => noteListEl.appendChild(renderNoteListItem(n)));
}

function renderFolderOptions() {
  const buildOptions = (select, includeAll) => {
    const current = select.value;
    select.innerHTML = "";
    if (includeAll) {
      const optAll = document.createElement("option");
      optAll.value = "";
      optAll.textContent = "すべてのフォルダ";
      select.appendChild(optAll);
    } else {
      const optNone = document.createElement("option");
      optNone.value = "";
      optNone.textContent = "フォルダなし";
      select.appendChild(optNone);
    }
    folders.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.name;
      select.appendChild(opt);
    });
    select.value = current;
  };
  buildOptions(folderSelect, true);
  buildOptions(folderAssignSelect, false);
  buildOptions(selectionFolderSelect, false);
  selectionFolderSelect.options[0].textContent = "フォルダへ移動...";
  selectionFolderSelect.value = "";
  folderSelect.value = activeFolderId;
}

function renderFolderDropRow() {
  folderDropRow.innerHTML = "";
  if (folders.length === 0) return;

  folders.forEach((f) => {
    const tile = document.createElement("div");
    tile.className = "folder-tile";
    tile.textContent = f.name;

    tile.ondragover = (e) => {
      e.preventDefault();
      tile.classList.add("drag-over");
    };
    tile.ondragleave = () => {
      tile.classList.remove("drag-over");
    };
    tile.ondrop = (e) => {
      e.preventDefault();
      tile.classList.remove("drag-over");
      if (draggedIds.length === 0) return;
      setFolder(draggedIds, f.id);
      draggedIds = [];
    };

    folderDropRow.appendChild(tile);
  });

  const noneTile = document.createElement("div");
  noneTile.className = "folder-tile";
  noneTile.textContent = "フォルダなしに戻す";
  noneTile.ondragover = (e) => {
    e.preventDefault();
    noneTile.classList.add("drag-over");
  };
  noneTile.ondragleave = () => {
    noneTile.classList.remove("drag-over");
  };
  noneTile.ondrop = (e) => {
    e.preventDefault();
    noneTile.classList.remove("drag-over");
    if (draggedIds.length === 0) return;
    setFolder(draggedIds, "");
    draggedIds = [];
  };
  folderDropRow.appendChild(noneTile);
}

function renderTagFilterRow() {
  tagFilterRow.innerHTML = "";
  const tags = allTags();
  if (tags.length === 0) return;

  const allChip = document.createElement("button");
  allChip.className = "tag-chip filter" + (activeTagFilter === "" ? " selected" : "");
  allChip.textContent = "すべて";
  allChip.onclick = () => {
    activeTagFilter = "";
    render();
  };
  tagFilterRow.appendChild(allChip);

  tags.forEach((t) => {
    const chip = document.createElement("button");
    chip.className = "tag-chip filter" + (activeTagFilter === t ? " selected" : "");
    chip.textContent = t;
    chip.onclick = () => {
      activeTagFilter = activeTagFilter === t ? "" : t;
      render();
    };
    tagFilterRow.appendChild(chip);
  });
}

function renderTagListRow(active) {
  tagListRow.innerHTML = "";
  active.tags.forEach((t) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = t;
    chip.style.background = colorForTag(t);
    chip.style.borderColor = colorForTag(t);
    const remove = document.createElement("button");
    remove.className = "tag-remove";
    remove.textContent = "×";
    remove.onclick = () => removeTag(active.id, t);
    chip.appendChild(remove);
    tagListRow.appendChild(chip);
  });
}

function renderTagSuggestionsFor(inputEl, suggestionsEl, existingTags, onPick) {
  if (!suggestionsEl) return;
  const value = inputEl.value.trim().toLowerCase();
  suggestionsEl.innerHTML = "";
  if (!value) {
    suggestionsEl.style.display = "none";
    return;
  }
  const matches = allTags()
    .filter((t) => t.toLowerCase().includes(value) && !existingTags.includes(t))
    .slice(0, 6);
  if (matches.length === 0) {
    suggestionsEl.style.display = "none";
    return;
  }
  matches.forEach((t) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "tag-suggestion-item";
    item.textContent = t;
    item.style.borderLeftColor = colorForTag(t);
    item.onclick = () => {
      onPick(t);
      inputEl.value = "";
      suggestionsEl.style.display = "none";
      inputEl.focus();
    };
    suggestionsEl.appendChild(item);
  });
  suggestionsEl.style.display = "block";
}

function renderTagSuggestions() {
  const active = getActive();
  const existing = active ? active.tags : [];
  renderTagSuggestionsFor(tagInput, tagSuggestions, existing, (t) => {
    const cur = getActive();
    if (cur) addTag(cur.id, t);
  });
}

function renderSelectionTagSuggestions() {
  renderTagSuggestionsFor(selectionTagInput, selectionTagSuggestions, [], (t) => {
    if (selectedIds.size === 0) return;
    addTagToMany(Array.from(selectedIds), t);
  });
}

function showLockView(note) {
  viewMode = "lock";
  emptyState.style.display = "none";
  editorView.style.display = "none";
  trashView.style.display = "none";
  printPreviewView.style.display = "none";
  lockView.style.display = "flex";
  lockError.textContent = "";
  lockPasswordInput.value = "";
  lockMessage.textContent = "このメモはロックされています。パスワードを入力してください。";
  pendingUnlockId = note.id;
  setTimeout(() => lockPasswordInput.focus(), 30);
}

function renderEditor() {
  const active = getActive();

  emptyState.style.display = "none";
  trashView.style.display = "none";
  lockView.style.display = "none";
  printPreviewView.style.display = "none";
  todoView.style.display = "none";

  if (!active) {
    emptyState.style.display = "flex";
    editorView.style.display = "none";
    lastRenderedBodyId = undefined;
    return;
  }

  if (active.locked && !unlockedIds.has(active.id)) {
    editorView.style.display = "none";
    lastRenderedBodyId = undefined;
    showLockView(active);
    return;
  }

  editorView.style.display = "flex";

  const activeChanged = lastRenderedBodyId !== active.id;
  if (activeChanged) {
    if (mdRefreshTimer) clearTimeout(mdRefreshTimer); mdRefreshTimer = null;
    if (highlightRefreshTimer) clearTimeout(highlightRefreshTimer); highlightRefreshTimer = null;
    noteSearchBar.style.display = "none"; noteSearchMatches = []; noteSearchCurrentIndex = -1;
  }

  const bodyFocused = document.activeElement === bodyInput || bodyInput.contains(document.activeElement);
  const mdFocused = document.activeElement === mdPreview || mdPreview.contains(document.activeElement);
  const externalTextEntryFocused = isNonMemoTextEntryFocused();

  if (activeChanged || (!bodyFocused && !externalTextEntryFocused)) {
    bodyInput.innerHTML = buildEditableHtml(active.body);
  }
  updateCounts(active.body);

  pinBtn.classList.toggle("active-icon", active.pinned);
  pinBtn.setAttribute("aria-label", active.pinned ? "固定を解除" : "固定する");

  lockToggleBtn.classList.toggle("active-icon", active.locked);
  lockToggleBtn.title = active.locked ? "ロックを解除" : "パスワードでロック";

  markdownToggleBtn.classList.toggle("active-icon", active.markdownPreview);

  if (active.markdownPreview) {
    bodyInput.style.display = "none";
    mdPreview.style.display = "block";
    if (activeChanged || (!mdFocused && !externalTextEntryFocused)) {
      mdActiveLineIndex = null;
      mdPreview.innerHTML = buildMdEditableHtml(active.body, mdActiveLineIndex);
    }
  } else {
    bodyInput.style.display = "block";
    mdPreview.style.display = "none";
  }

  lastRenderedBodyId = active.id;

  colorDots.innerHTML = "";
  TAG_COLORS.forEach((c, idx) => {
    const dot = document.createElement("button");
    dot.className = "color-dot" + (active.color === idx ? " selected" : "");
    dot.style.background = c.bg;
    if (active.color === idx) dot.style.borderColor = c.border;
    dot.setAttribute("aria-label", c.label + "に設定");
    dot.onclick = () => setColor(active.id, idx);
    colorDots.appendChild(dot);
  });

  folderAssignSelect.value = active.folderId || "";
  renderTagListRow(active);
}

function renderPrintPreview() {
  const active = getActive();
  if (!active) {
    printPreviewPage.innerHTML = "<p>表示するメモがありません。</p>";
    return;
  }
  const title = escapeHtml(titleFromBody(active.body));
  const restBody = active.body.split("\n").slice(1).join("\n");
  printPreviewPage.innerHTML = `<h1 class="print-preview-title">${title}</h1>${renderMarkdown(restBody)}`;
}

printPreviewPage.addEventListener("click", (e) => {
  const externalLink = e.target.closest(".external-link");
  if (externalLink) {
    e.preventDefault();
    const url = externalLink.getAttribute("data-url");
    if (url && window.shellAPI) {
      window.shellAPI.openExternal(url);
    }
    return;
  }
  handleCodeCopyClick(e);
});

let codeCopyFeedbackTimer = null;
function handleCodeCopyClick(e) {
  const blockBtn = e.target.closest("[data-copy-block]");
  const lineEl = e.target.closest("[data-copy-line]");
  const target = blockBtn || lineEl;
  if (!target) return;
  e.preventDefault();

  // Keep large source text out of HTML attributes. Resolve it only when the
  // user actually requests a copy, avoiding duplicated megabyte strings and
  // expensive DOM parsing during rendering.
  let text = "";
  if (blockBtn) {
    const codeBody = target.closest(".code-block")?.querySelector(".code-block-body");
    text = codeBody
      ? Array.from(codeBody.querySelectorAll(".code-line-text"), (line) => line.textContent).join("\n")
      : "";
  } else if (lineEl) {
    text = lineEl.closest(".code-line")?.querySelector(".code-line-text")?.textContent || "";
  }

  function showCopiedFeedback() {
    const original = blockBtn ? blockBtn.textContent : null;
    if (blockBtn) {
      blockBtn.textContent = "コピーしました";
      blockBtn.classList.add("code-block-copy-btn-done");
    } else if (lineEl) {
      lineEl.classList.add("code-line-no-copied");
    }
    if (codeCopyFeedbackTimer) clearTimeout(codeCopyFeedbackTimer);
    codeCopyFeedbackTimer = setTimeout(() => {
      if (blockBtn) {
        blockBtn.textContent = original || "コピー";
        blockBtn.classList.remove("code-block-copy-btn-done");
      }
      if (lineEl) lineEl.classList.remove("code-line-no-copied");

      if (
        typeof mdPreview !== "undefined" &&
        typeof mdActiveLineIndex !== "undefined" &&
        mdActiveLineIndex !== null &&
        !mdPreview.contains(document.activeElement)
      ) {
        mdActiveLineIndex = null;
        refreshMdPreview();
      }
    }, 1200);
  }

  function fallbackCopy() {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
      showCopiedFeedback();
    } catch (err) {

    }
    document.body.removeChild(ta);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(showCopiedFeedback).catch(fallbackCopy);
  } else {
    fallbackCopy();
  }
}

function renderTrash() {
  trashList.innerHTML = "";
  const trashed = notes
    .filter((n) => isTrashed(n))
    .sort((a, b) => b.trashedAt - a.trashedAt);

  if (trashed.length === 0) {
    const msg = document.createElement("div");
    msg.className = "empty-list-msg";
    msg.textContent = "ゴミ箱は空です。";
    trashList.appendChild(msg);
    return;
  }

  trashed.forEach((n) => {
    const row = document.createElement("div");
    row.className = "trash-item";

    const info = document.createElement("div");
    info.className = "trash-item-info";
    const title = document.createElement("span");
    title.className = "note-title";
    title.textContent = titleFromBody(n.body);
    const date = document.createElement("span");
    date.className = "note-meta";
    const daysLeft = Math.max(
      0,
      30 - Math.floor((Date.now() - n.trashedAt) / (24 * 60 * 60 * 1000))
    );
    date.textContent = `削除日: ${formatDate(n.trashedAt)}(あと${daysLeft}日で完全削除)`;
    info.appendChild(title);
    info.appendChild(date);

    const actions = document.createElement("div");
    actions.className = "trash-item-actions";
    const restoreBtn = document.createElement("button");
    restoreBtn.className = "btn small";
    restoreBtn.textContent = "復元";
    restoreBtn.onclick = () => restoreFromTrash(n.id);

    const purgeBtn = document.createElement("button");
    purgeBtn.className = "btn small danger";
    purgeBtn.textContent = "完全に削除";
    purgeBtn.onclick = async () => {
      const ok = await askConfirm("このメモを完全に削除します。元に戻せません。よろしいですか?");
      if (ok) deletePermanently(n.id);
    };

    actions.appendChild(restoreBtn);
    actions.appendChild(purgeBtn);

    row.appendChild(info);
    row.appendChild(actions);
    trashList.appendChild(row);
  });
}

function collectChecklistItems() {
  const items = [];
  notes.forEach((note) => {
    if (isTrashed(note)) return;
    if (note.locked && !unlockedIds.has(note.id)) return;
    const lines = (note.body || "").split("\n");
    const title = titleFromBody(note.body);
    let inCode = false;
    for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
      if (/^```/.test(lines[lineIndex])) { inCode = !inCode; continue; }
      if (inCode) continue;
      const cls = classifyLine(lines[lineIndex]);
      if (cls.type !== "checkbox") continue;
      items.push({
        noteId: note.id,
        noteTitle: title,
        folderId: note.folderId || "",
        lineIndex,
        checked: cls.checked,
        content: cls.content,
        updatedAt: note.updatedAt,
      });
    }
  });
  return items;
}

function toggleChecklistItem(noteId, lineIndex) {
  const note = notes.find((n) => n.id === noteId);
  if (!note) return;
  const lines = note.body.split("\n");
  const rawLine = lines[lineIndex];
  if (rawLine === undefined) return;
  const m = rawLine.match(/^([-*]\s+\[)([ xX])(\]\s+.*)$/);
  if (!m) return;
  const newMark = m[2].toLowerCase() === "x" ? " " : "x";
  lines[lineIndex] = m[1] + newMark + m[3];
  note.body = lines.join("\n");
  note.updatedAt = Date.now();
  persist();
  render();
}

function jumpToChecklistNote(noteId) {
  const note = notes.find((n) => n.id === noteId);
  if (!note) return;
  clearSelection();
  activeId = note.id;
  viewMode = "editor";
  render();
  setTimeout(() => getCurrentEditableEl().focus(), 30);
}

function renderTodo() {
  const allItems = collectChecklistItems();
  const query = todoQuery.trim().toLowerCase();
  const items = allItems.filter((item) => {
    if (todoHideDone && item.checked) return false;
    if (query && !item.content.toLowerCase().includes(query) && !item.noteTitle.toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });

  const doneCount = allItems.filter((it) => it.checked).length;
  todoSummary.textContent = `合計 ${allItems.length}件 / 完了 ${doneCount}件 / 未完了 ${allItems.length - doneCount}件`;

  todoGroups.innerHTML = "";

  if (allItems.length === 0) {
    const msg = document.createElement("div");
    msg.className = "empty-list-msg";
    msg.textContent = "チェックリストがまだありません。メモ内で「- [ ] タスク名」のように書くとここに集まります。";
    todoGroups.appendChild(msg);
    return;
  }

  if (items.length === 0) {
    const msg = document.createElement("div");
    msg.className = "empty-list-msg";
    msg.textContent = "条件に一致するTodoがありません。";
    todoGroups.appendChild(msg);
    return;
  }

  const groups = new Map();
  const groupOrder = [];
  function groupKeyFor(item) {
    if (todoGroupBy === "folder") {
      return item.folderId || "__no_folder__";
    }
    if (todoGroupBy === "status") {
      return item.checked ? "__done__" : "__pending__";
    }
    return item.noteId;
  }
  function groupLabelFor(item, key) {
    if (todoGroupBy === "folder") {
      return key === "__no_folder__" ? "フォルダなし" : folderName(item.folderId) || "フォルダなし";
    }
    if (todoGroupBy === "status") {
      return key === "__done__" ? "完了" : "未完了";
    }
    return item.noteTitle;
  }

  items.forEach((item) => {
    const key = groupKeyFor(item);
    if (!groups.has(key)) {
      groups.set(key, { label: groupLabelFor(item, key), items: [] });
      groupOrder.push(key);
    }
    groups.get(key).items.push(item);
  });

  if (todoGroupBy === "status") {
    groupOrder.sort((a, b) => (a === "__pending__" ? -1 : 1) - (b === "__pending__" ? -1 : 1));
  } else {
    groupOrder.sort((a, b) => {
      const pendingA = groups.get(a).items.filter((it) => !it.checked).length;
      const pendingB = groups.get(b).items.filter((it) => !it.checked).length;
      return pendingB - pendingA;
    });
  }

  groupOrder.forEach((key) => {
    const group = groups.get(key);
    const groupEl = document.createElement("div");
    groupEl.className = "todo-group";

    const header = document.createElement("div");
    header.className = "todo-group-header";
    const doneInGroup = group.items.filter((it) => it.checked).length;
    header.innerHTML = `<span class="todo-group-title">${escapeHtml(group.label)}</span><span class="todo-group-count">${doneInGroup}/${group.items.length}</span>`;
    groupEl.appendChild(header);

    const list = document.createElement("div");
    list.className = "todo-group-list";

    group.items
      .slice()
      .sort((a, b) => {
        if (a.noteId !== b.noteId) return a.noteTitle.localeCompare(b.noteTitle, "ja");
        return a.lineIndex - b.lineIndex;
      })
      .forEach((item) => {
        const row = document.createElement("div");
        row.className = "todo-item" + (item.checked ? " todo-item-checked" : "");

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "todo-item-checkbox";
        checkbox.checked = item.checked;
        checkbox.onclick = (e) => {
          e.stopPropagation();
          toggleChecklistItem(item.noteId, item.lineIndex);
        };

        const text = document.createElement("span");
        text.className = "todo-item-text";
        text.textContent = item.content || "(内容なし)";

        const source = document.createElement("button");
        source.type = "button";
        source.className = "todo-item-source";
        source.textContent = item.noteTitle;
        source.title = "このメモを開く";
        source.onclick = (e) => {
          e.stopPropagation();
          jumpToChecklistNote(item.noteId);
        };

        row.appendChild(checkbox);
        row.appendChild(text);
        if (todoGroupBy !== "note") {
          row.appendChild(source);
        }
        list.appendChild(row);
      });

    groupEl.appendChild(list);
    todoGroups.appendChild(groupEl);
  });
}

function render() {
  renderList();
  renderFolderOptions();
  renderFolderDropRow();
  renderTagFilterRow();

  if (viewMode === "trash") {
    emptyState.style.display = "none";
    editorView.style.display = "none";
    lockView.style.display = "none";
    printPreviewView.style.display = "none";
    todoView.style.display = "none";
    trashView.style.display = "flex";
    renderTrash();
    return;
  }

  if (viewMode === "print") {
    emptyState.style.display = "none";
    editorView.style.display = "none";
    lockView.style.display = "none";
    trashView.style.display = "none";
    todoView.style.display = "none";
    printPreviewView.style.display = "flex";
    renderPrintPreview();
    return;
  }

  if (viewMode === "todo") {
    emptyState.style.display = "none";
    editorView.style.display = "none";
    lockView.style.display = "none";
    trashView.style.display = "none";
    printPreviewView.style.display = "none";
    todoView.style.display = "flex";
    renderTodo();
    return;
  }

  renderEditor();
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", settings.theme === "dark" ? "dark" : "light");
}

async function toggleTheme() {
  settings.theme = settings.theme === "dark" ? "light" : "dark";
  applyTheme();
  await persistSettings();
}

function applyFontSize() {
  const size = Math.min(24, Math.max(13, Number(settings.fontSize) || 16));
  settings.fontSize = size;
  document.documentElement.style.setProperty("--editor-font-size", size + "px");
  fontSizeRange.value = size;
}
