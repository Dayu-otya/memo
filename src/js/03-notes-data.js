

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("ja-JP", { month: "long", day: "numeric" });
}

function excerpt(text, len = 60) {
  const clean = text.replace(/\n+/g, " ").trim();
  return clean.length > len ? clean.slice(0, len) + "…" : clean;
}

function titleFromBody(body) {
  const firstLine = (body || "").split("\n")[0].trim();
  return firstLine || "無題のメモ";
}

function normalizeNote(n) {
  return {
    id: n.id,

    body: (n.body || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
    color: n.color || 0,
    pinned: !!n.pinned,
    createdAt: n.createdAt || Date.now(),
    updatedAt: n.updatedAt || Date.now(),
    folderId: n.folderId || "",
    tags: Array.isArray(n.tags) ? n.tags : [],
    trashedAt: n.trashedAt || null,
    locked: !!n.locked,
    passwordHash: n.passwordHash || null,
    encrypted: n.encrypted || null,
    markdownPreview: !!n.markdownPreview,
  };
}

let savePromise = null;
let changeRevision = 0;
let savedRevision = 0;
let appReady = false;
let appLoadFailed = false;
let settingsPromise = Promise.resolve(true);

function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!appReady) return Promise.resolve(false);
  if (savePromise) { saveQueued = true; return savePromise; }
  saveInFlight = true;
  savePromise = (async () => {
    let ok = false;
    do {
      saveQueued = false;
      const revision = changeRevision;
      saveStateEl.textContent = "保存中…";
      let toPersist;
      try {
        toPersist = await prepareNotesForPersist(notes);
        ok = await window.notesAPI.save(toPersist);
        if (!ok) throw new Error("保存先に書き込めませんでした。");
        savedRevision = revision;
        if (changeRevision !== revision) saveQueued = true;
        saveStateEl.textContent = saveQueued ? "保存中…" : "保存済み";
      } catch (e) {
        console.error("保存に失敗しました:", e);
        saveStateEl.textContent = "保存失敗（未保存）";
        ok = false;
        saveQueued = false;
        if (toPersist) {
          try { await window.notesAPI.autosave(toPersist); } catch (draftError) { console.error(draftError); }
        }
      }
    } while (saveQueued);
    return ok;
  })().finally(() => { saveInFlight = false; savePromise = null; });
  return savePromise;
}

function persist() {
  changeRevision++;
  saveStateEl.textContent = "未保存";
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 400);
  scheduleAutosave();
}

async function saveImmediately() {
  return saveNow();
}

let autosaveTimer = null;
// Recovery writes run inside the save queue, only if the main save fails.
function scheduleAutosave() {}

function persistSettings() {
  settings.folders = folders;
  settings.tagColors = tagColors;
  settings.sortMode = sortMode;
  const snapshot = structuredClone(settings);
  settingsPromise = settingsPromise.catch(() => false).then(async () => {
    try {
      const ok = await window.settingsAPI.save(snapshot);
      if (!ok) saveStateEl.textContent = "設定の保存失敗";
      return ok;
    } catch (e) { saveStateEl.textContent = "設定の保存失敗"; return false; }
  });
  return settingsPromise;
}

window.flushBeforeClose = async () => {
  if (appLoadFailed) return true; // No editing was enabled.
  if (!appReady) return false;
  if (document.activeElement === bodyInput || document.activeElement === mdPreview) document.activeElement.blur();
  const ok = await saveImmediately();
  const settingsOK = await persistSettings();
  return ok && settingsOK;
};

function getActive() {
  return notes.find((n) => n.id === activeId) || null;
}

function isTrashed(n) {
  return !!n.trashedAt;
}

function clearSelection() {
  selectedIds.clear();
  lastClickedId = null;
  updateSelectionBar();
}

function toggleSelect(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    selectedIds.add(id);
  }
  lastClickedId = id;
  updateSelectionBar();
}

function selectRangeTo(id) {
  const visible = getFiltered();
  const ids = visible.map((n) => n.id);
  const anchorId = lastClickedId || activeId;
  const fromIdx = anchorId ? ids.indexOf(anchorId) : -1;
  const toIdx = ids.indexOf(id);
  if (fromIdx === -1 || toIdx === -1) {
    toggleSelect(id);
    return;
  }
  const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
  for (let i = start; i <= end; i++) selectedIds.add(ids[i]);
  lastClickedId = id;
  updateSelectionBar();
}

function updateSelectionBar() {
  if (selectedIds.size > 0) {
    selectionBar.style.display = "flex";
    selectionCount.textContent = `${selectedIds.size}件選択中`;
  } else {
    selectionBar.style.display = "none";
  }
}

function createNote() {
  const n = normalizeNote({
    id: uid(),
    body: "",
    color: 0,
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    folderId: activeFolderId || "",
    tags: activeTagFilter ? [activeTagFilter] : [],
  });
  query = ""; searchInput.value = ""; clearSearchBtn.style.display = "none";
  notes.unshift(n);
  activeId = n.id;
  viewMode = "editor";
  persist();
  render();
  setTimeout(() => bodyInput.focus(), 30);
}

function moveToTrash(ids) {
  const idList = Array.isArray(ids) ? ids : [ids];
  const idSet = new Set(idList);
  notes.forEach((n) => {
    if (idSet.has(n.id)) n.trashedAt = Date.now();
  });
  if (idSet.has(activeId)) {

    if (document.activeElement === bodyInput || document.activeElement === mdPreview) {
      document.activeElement.blur();
    }
    const visible = getFiltered();
    activeId = visible.length > 0 ? visible[0].id : null;
  }
  clearSelection();
  persist();
  render();
}

function restoreFromTrash(id) {
  const n = notes.find((n) => n.id === id);
  if (!n) return;
  n.trashedAt = null;
  persist();
  renderTrash();
}

function deletePermanently(id) {
  notes = notes.filter((n) => n.id !== id);

  mdUndoStacks.delete(id);
  mdRedoStacks.delete(id);
  sessionPasswords.delete(id);
  unlockedIds.delete(id);
  persist();
  renderTrash();
}

function togglePin(id) {
  const n = notes.find((n) => n.id === id);
  if (n) n.pinned = !n.pinned;
  persist();
  render();
}

function setColor(id, idx) {
  const n = notes.find((n) => n.id === id);
  if (n) n.color = idx;
  persist();
  render();
}

function addTag(id, tag) {
  const n = notes.find((n) => n.id === id);
  const clean = tag.trim();
  if (!n || !clean) return;
  if (!n.tags.includes(clean)) n.tags.push(clean);
  persist();
  render();
}

function removeTag(id, tag) {
  const n = notes.find((n) => n.id === id);
  if (!n) return;
  n.tags = n.tags.filter((t) => t !== tag);
  persist();
  render();
}

function setFolder(ids, folderId) {
  const idList = Array.isArray(ids) ? ids : [ids];
  const idSet = new Set(idList);
  notes.forEach((n) => {
    if (idSet.has(n.id)) n.folderId = folderId;
  });
  persist();
  render();
}

function addTagToMany(ids, tag) {
  const clean = tag.trim();
  if (!clean) return;
  const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
  notes.forEach((n) => {
    if (idSet.has(n.id) && !n.tags.includes(clean)) n.tags.push(clean);
  });
  persist();
  render();
}

function allTags() {
  const set = new Set();
  notes.forEach((n) => {
    if (isTrashed(n)) return;
    n.tags.forEach((t) => set.add(t));
  });
  return Array.from(set).sort();
}

function folderName(folderId) {
  const f = folders.find((f) => f.id === folderId);
  return f ? f.name : "";
}

function parseQueryTokens(rawQuery) {
  const tokens = rawQuery.trim().split(/\s+/).filter(Boolean);
  const conditions = { tag: [], color: [], folder: [] };
  const keywords = [];

  const colorNameToIndex = {};
  TAG_COLORS.forEach((c, idx) => {
    colorNameToIndex[c.label.toLowerCase()] = idx;
  });

  for (const token of tokens) {
    const lower = token.toLowerCase();
    let matched = false;
    for (const [prefixJa, prefixEn, key] of [
      ["タグ:", "tag:", "tag"],
      ["色:", "color:", "color"],
      ["フォルダ:", "folder:", "folder"],
    ]) {
      if (token.startsWith(prefixJa) || lower.startsWith(prefixEn)) {
        const value = token.startsWith(prefixJa)
          ? token.slice(prefixJa.length)
          : token.slice(prefixEn.length);
        if (value) {
          conditions[key].push(value.toLowerCase());
          matched = true;
        }
        break;
      }
    }
    if (!matched) keywords.push(lower);
  }

  return { conditions, keywords, colorNameToIndex };
}

function matchesQuery(n, parsed) {
  const { conditions, keywords, colorNameToIndex } = parsed;

  if (conditions.tag.length > 0) {
    const noteTags = n.tags.map((t) => t.toLowerCase());
    const ok = conditions.tag.some((want) =>
      noteTags.some((t) => t.includes(want))
    );
    if (!ok) return false;
  }

  if (conditions.color.length > 0) {
    const ok = conditions.color.some((want) => {
      const idx = colorNameToIndex[want];
      return idx !== undefined && n.color === idx;
    });
    if (!ok) return false;
  }

  if (conditions.folder.length > 0) {
    const fname = folderName(n.folderId).toLowerCase();
    const ok = conditions.folder.some((want) => fname.includes(want));
    if (!ok) return false;
  }

  if (keywords.length === 0) return true;
  if (n.locked && !unlockedIds.has(n.id)) return false;
  const haystack = [
    n.body,
    ...n.tags,
    folderName(n.folderId),
  ]
    .join(" ")
    .toLowerCase();
  return keywords.every((k) => haystack.includes(k));
}

function getFiltered() {
  const parsed = parseQueryTokens(query);
  const filtered = notes
    .filter((n) => !isTrashed(n))
    .filter((n) => matchesQuery(n, parsed))
    .filter((n) => (activeFolderId ? n.folderId === activeFolderId : true))
    .filter((n) => (activeTagFilter ? n.tags.includes(activeTagFilter) : true));

  return sortNotes(filtered);
}

function sortNotes(list) {
  return list.slice().sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sortMode === "created") return b.createdAt - a.createdAt;
    if (sortMode === "title") {
      return titleFromBody(a.body).localeCompare(titleFromBody(b.body), "ja");
    }
    if (sortMode === "length") {
      return b.body.length - a.body.length;
    }
    return b.updatedAt - a.updatedAt;
  });
}

function highlightText(text, keywords) {
  const terms = keywords.filter(Boolean).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!terms.length) return escapeHtml(text);
  const re = new RegExp(terms.sort((a,b) => b.length-a.length).join("|"), "gi");
  let result = "", from = 0;
  for (const match of text.matchAll(re)) {
    result += escapeHtml(text.slice(from, match.index)) + "<mark>" + escapeHtml(match[0]) + "</mark>";
    from = match.index + match[0].length;
  }
  return result + escapeHtml(text.slice(from));
}
