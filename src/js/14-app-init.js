

(async function init() {
  try {
  document.getElementById("app").inert = true;

  const [rawNotes, loadedSettings] = await Promise.all([
    window.notesAPI.load(),
    window.settingsAPI.load(),
  ]);
  notes = (rawNotes || []).map(normalizeNote);
  appReady = true;

  settings = Object.assign({ theme: "light", fontSize: 16 }, loadedSettings || {});
  folders = Array.isArray((loadedSettings || {}).folders) ? loadedSettings.folders : [];
  tagColors = loadedSettings && typeof loadedSettings.tagColors === "object" && loadedSettings.tagColors
    ? loadedSettings.tagColors
    : {};
  sortMode = ["updated", "created", "title", "length"].includes((loadedSettings || {}).sortMode)
    ? loadedSettings.sortMode
    : "updated";
  sortSelect.value = sortMode;

  applyTheme();
  applyFontSize();

  const visible = notes.filter((n) => !isTrashed(n));
  if (visible.length > 0) activeId = visible[0].id;

  render();

  if (notes.some((n) => n.body && n.body.includes("$"))) {
    ensureKatexLoaded();
  }

  try {
    const draft = await window.notesAPI.checkAutosave();
    if (draft && draft.notes) {
      const currentJson = JSON.stringify(notes);
      const draftJson = JSON.stringify(draft.notes.map(normalizeNote));
      if (currentJson !== draftJson) {
        const when = new Date(draft.savedAt).toLocaleString("ja-JP");
        const ok = await askConfirm(
          `前回、保存されていない可能性のある編集内容が見つかりました(${when}時点)。復元しますか?`
        );
        if (ok) {
          notes = draft.notes.map(normalizeNote);
          const visibleAfter = notes.filter((n) => !isTrashed(n));
          activeId = visibleAfter.length > 0 ? visibleAfter[0].id : null;
          await saveImmediately();
          render();
        } else {
          await window.notesAPI.discardAutosave();
        }
      } else {
        await window.notesAPI.discardAutosave();
      }
    }
  } catch (e) {
    console.error("autosaveの復旧チェックに失敗しました:", e);
  }
  document.getElementById("app").inert = false;
  } catch (e) {
    appLoadFailed = true; appReady = false;
    saveStateEl.textContent = "読み込み失敗";
    await notify("メモの読み込みに失敗しました。元の保存ファイルは変更していません。アプリを閉じ、バックアップからの復旧をご確認ください。\n" + String(e.message || e));
  }
})();

