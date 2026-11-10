

async function exportActiveNote(format) {
  exportMenu.style.display = "none";
  const active = getActive();
  if (!active) return;
  if (active.locked && !unlockedIds.has(active.id)) {
    await notify("ロックを解除してから書き出してください。");
    return;
  }
  if (format === "pdf") await ensureKatexLoaded();
  const restBody = active.body.split("\n").slice(1).join("\n");
  const result = await window.notesAPI.export({
    title: titleFromBody(active.body),
    body: active.body,

    bodyHtml: format === "pdf" ? renderMarkdown(restBody) : undefined,
    format,
  });
  if (result.ok) {
    await notify("書き出しました。\n" + result.filePath);

  } else if (!result.canceled) {
    await notify("書き出しに失敗しました。");
  }
}

exportTxtBtn.onclick = () => exportActiveNote("txt");
exportPdfBtn.onclick = () => exportActiveNote("pdf");

printBtn.onclick = () => {
  const active = getActive();
  if (!active) return;
  if (active.locked && !unlockedIds.has(active.id)) {
    notify("ロックを解除してからプレビューしてください。");
    return;
  }
  viewMode = "print";
  render();
};

printPreviewGoBtn.onclick = async () => {
  printPreviewGoBtn.disabled = true;
  try {
    await ensureKatexLoaded();
    renderPrintPreview();
    await document.fonts.ready;
    const result = await window.printAPI.print();
    if (!result.ok && !result.canceled) await notify("印刷できませんでした。" + (result.error || ""));
  } catch (e) { await notify("印刷できませんでした。" + String(e)); }
  finally { printPreviewGoBtn.disabled = false; }
};

closePrintPreviewBtn.onclick = () => {
  viewMode = "editor";
  render();
};

markdownToggleBtn.onclick = () => {
  const active = getActive();
  if (!active) return;
  if (document.activeElement === mdPreview || document.activeElement === bodyInput) document.activeElement.blur();
  active.markdownPreview = !active.markdownPreview;
  lastRenderedBodyId = undefined;
  persist();
  renderEditor();
};

folderSelect.onchange = (e) => {
  activeFolderId = e.target.value;
  render();
};

folderAssignSelect.onchange = (e) => {
  const active = getActive();
  if (active) setFolder(active.id, e.target.value);
};

newFolderBtn.onclick = async () => {
  const name = await askText("新しいフォルダの名前を入力してください");
  if (!name || !name.trim()) return;
  folders.push({ id: uid(), name: name.trim() });
  await persistSettings();
  render();
};

sortSelect.onchange = (e) => {
  sortMode = e.target.value;
  persistSettings();
  render();
};

exportAllMarkdownBtn.onclick = async () => {
  menuPanel.style.display = "none";
  const notesWithTitle = notes.map((n) => ({ ...n, title: titleFromBody(n.body) }));
  const result = await window.notesAPI.exportAllMarkdown(notesWithTitle);
  if (result.ok) {
    await notify(`${result.count}件のメモを書き出しました:\n${result.destDir}\n(ロック中のメモは対象外です)`);
  } else if (!result.canceled) {
    await notify("書き出しに失敗しました。");
  }
};

importMarkdownBtn.onclick = async () => {
  menuPanel.style.display = "none";
  const result = await window.notesAPI.importMarkdown();
  if (!result.ok) {
    if (!result.canceled) await notify("インポートに失敗しました。");
    return;
  }
  let addedCount = 0;
  let skippedCount = 0;
  result.imported.forEach(({ body, fileName }) => {

    const isDuplicate = notes.some((n) => !isTrashed(n) && n.body === body);
    if (isDuplicate) {
      skippedCount++;
      return;
    }
    const lowerName = (fileName || "").toLowerCase();
    const isMarkdownFile = lowerName.endsWith(".md") || lowerName.endsWith(".markdown");
    const n = normalizeNote({
      id: uid(),
      body,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      folderId: activeFolderId || "",

      markdownPreview: isMarkdownFile,
    });
    notes.unshift(n);
    addedCount++;
  });
  if (addedCount > 0) {
    activeId = notes[0].id;
    persist();
    render();
  }
  const message =
    skippedCount > 0
      ? `${addedCount}件のメモをインポートしました。(内容が同じメモが${skippedCount}件あったためスキップしました)`
      : `${addedCount}件のメモをインポートしました。`;
  await notify(message);
};

tagInput.onkeydown = (e) => {
  if (e.isComposing) return;
  if (e.key !== "Enter") return;
  const active = getActive();
  if (!active) return;
  addTag(active.id, tagInput.value);
  tagInput.value = "";
  tagSuggestions.style.display = "none";
};

tagInput.oninput = renderTagSuggestions;

tagInput.onblur = () => {
  setTimeout(() => {
    tagSuggestions.style.display = "none";
  }, 150);
};

selectionTagInput.onkeydown = (e) => {
  if (e.isComposing) return;
  if (e.key !== "Enter") return;
  if (selectedIds.size === 0) return;
  addTagToMany(Array.from(selectedIds), selectionTagInput.value);
  selectionTagInput.value = "";
  selectionTagSuggestions.style.display = "none";
};

selectionTagInput.oninput = renderSelectionTagSuggestions;

selectionTagInput.onblur = () => {
  setTimeout(() => {
    selectionTagSuggestions.style.display = "none";
  }, 150);
};

