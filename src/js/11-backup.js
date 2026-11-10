

function formatStatusDate(ts) {
  if (!ts) return "記録なし";
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `今日 ${time}`;
  return `${d.toLocaleDateString("ja-JP", { month: "long", day: "numeric" })} ${time}`;
}

async function refreshDataStatus() {
  try {
    const status = await window.notesAPI.status();
    lastSavedText.textContent = formatStatusDate(status.lastSavedAt);
    lastAutoBackupText.textContent = formatStatusDate(status.lastAutoBackupAt);
  } catch (e) {
    console.error("保存状態の取得に失敗しました:", e);
    lastSavedText.textContent = "取得できません";
    lastAutoBackupText.textContent = "取得できません";
  }
}

menuBtn.onclick = () => {
  const opening = menuPanel.style.display === "none";
  menuPanel.style.display = opening ? "flex" : "none";
  if (opening) refreshDataStatus();
};

document.addEventListener("click", (e) => {
  if (!menuPanel.contains(e.target) && e.target !== menuBtn) {
    menuPanel.style.display = "none";
  }
});

manualBackupBtn.onclick = async () => {
  if (!await saveImmediately()) { await notify("保存に失敗したためバックアップを中止しました。"); return; }
  const result = await window.backupAPI.manual();
  menuPanel.style.display = "none";
  if (result.ok) {
    await notify(`バックアップを保存しました:\n${result.filePath}`);
  } else if (!result.canceled) {
    await notify("バックアップの保存に失敗しました。");
  }
};

async function openRestoreOverlay() {
  menuPanel.style.display = "none";
  restoreList.innerHTML = "<div class=\"restore-empty\">読み込み中…</div>";
  restoreOverlay.style.display = "flex";

  const list = await window.backupAPI.listAuto();
  restoreList.innerHTML = "";

  if (list.length === 0) {
    restoreList.innerHTML =
      "<div class=\"restore-empty\">自動バックアップがまだありません。メモを保存すると自動的に作られます。</div>";
    return;
  }

  list.forEach((item) => {
    const row = document.createElement("div");
    row.className = "restore-item";

    const info = document.createElement("div");
    info.className = "restore-item-info";

    const dateEl = document.createElement("span");
    dateEl.className = "restore-item-date";
    dateEl.textContent = formatStatusDate(item.mtime);
    info.appendChild(dateEl);

    const countEl = document.createElement("span");
    countEl.className = "restore-item-count";
    countEl.textContent =
      item.noteCount === null ? "件数不明" : `メモ ${item.noteCount}件`;
    info.appendChild(countEl);

    row.appendChild(info);

    const useBtn = document.createElement("button");
    useBtn.className = "btn";
    useBtn.textContent = "この内容に戻す";
    useBtn.onclick = async (e) => {
      e.stopPropagation();
      await restoreFromAutoBackup(item.fileName);
    };
    row.appendChild(useBtn);

    restoreList.appendChild(row);
  });
}

async function applyRestoredNotes(restoredNotes, sourceLabel) {
  const ok = await askConfirm(
    `${sourceLabel}の内容に復元します。今のメモの状態は、復元前にバックアップとして保存されます。よろしいですか?`
  );
  if (!ok) return;

  if (!await saveImmediately()) { await notify("復元前の保存に失敗したため、復元を中止しました。"); return; }
  const restored = restoredNotes.map(normalizeNote);
  // Persist encrypted backup records before clearing session state; never re-encrypt
  // empty restored bodies with passwords left over from the current session.
  const backupOK = await window.backupAPI.checkpoint();
  if (!backupOK) { await notify("復元前のバックアップに失敗したため、復元を中止しました。"); return; }
  if (!await window.notesAPI.save(restored)) { await notify("復元内容を保存できませんでした。"); return; }
  notes = restored;
  sessionPasswords.clear(); unlockedIds.clear(); mdUndoStacks.clear(); mdRedoStacks.clear();
  if (saveTimer) clearTimeout(saveTimer); saveTimer = null;
  if (autosaveTimer) clearTimeout(autosaveTimer); autosaveTimer = null;
  selectedIds = new Set();
  query = ""; searchInput.value = ""; activeFolderId = ""; activeTagFilter = "";
  const visible = notes.filter((n) => !isTrashed(n));
  activeId = visible.length > 0 ? visible[0].id : null;
  lastRenderedBodyId = undefined;
  viewMode = "editor";
  restoreOverlay.style.display = "none";
  render();
  await notify("復元が完了しました。");
}

async function restoreFromAutoBackup(fileName) {
  const result = await window.backupAPI.restoreAuto(fileName);
  if (!result.ok) {
    await notify(result.error || "復元に失敗しました。");
    return;
  }
  await applyRestoredNotes(result.notes, "選択したバックアップ");
}

restoreBackupBtn.onclick = openRestoreOverlay;

restoreFromFileBtn.onclick = async () => {
  const result = await window.backupAPI.restoreFromFile();
  if (result.canceled) return;
  if (!result.ok) {
    await notify(result.error || "ファイルの読み込みに失敗しました。");
    return;
  }
  await applyRestoredNotes(result.notes, "選択したファイル");
};

restoreCancelBtn.onclick = () => {
  restoreOverlay.style.display = "none";
};

restoreOverlay.addEventListener("click", (e) => {
  if (e.target === restoreOverlay) restoreOverlay.style.display = "none";
});

showTrashBtn.onclick = () => {
  menuPanel.style.display = "none";
  viewMode = "trash";
  render();
};

showTodoBtn.onclick = () => {
  menuPanel.style.display = "none";
  viewMode = "todo";
  render();
};

todoBtn.onclick = () => {
  viewMode = viewMode === "todo" ? "editor" : "todo";
  render();
};

closeTodoBtn.onclick = () => {
  viewMode = "editor";
  render();
};

todoGroupBySelect.onchange = (e) => {
  todoGroupBy = e.target.value;
  renderTodo();
};

todoHideDoneCheckbox.onchange = (e) => {
  todoHideDone = e.target.checked;
  renderTodo();
};

todoSearchInput.oninput = (e) => {
  todoQuery = e.target.value;
  renderTodo();
};

selectAllVisibleBtn.onclick = () => {
  menuPanel.style.display = "none";
  const visible = getFiltered();
  if (visible.length === 0) return;
  selectedIds = new Set(visible.map((n) => n.id));
  lastClickedId = visible[visible.length - 1].id;
  render();
};

closeTrashBtn.onclick = () => {
  viewMode = "editor";
  render();
};

themeToggleBtn.onclick = toggleTheme;

fontSizeRange.oninput = async (e) => {
  settings.fontSize = Number(e.target.value);
  applyFontSize();
  await persistSettings();
};

lockToggleBtn.onclick = async () => {
  const active = getActive();
  if (!active) return;

  if (active.locked) {
    const password = await askText("ロックを解除するにはパスワードを入力してください", { password: true });
    if (password === null) return;
    const ok = await window.cryptoAPI.verifyPassword(password, active.passwordHash);
    if (!ok) {
      await notify("パスワードが違います。");
      return;
    }
    if (active.encrypted && !unlockedIds.has(active.id)) {
      const result = await window.cryptoAPI.decrypt(active.encrypted, password);
      if (!result.ok) { await notify("復号に失敗したため、ロック解除を中止しました。"); return; }
      active.body = result.text;
    }
    active.locked = false;
    active.passwordHash = null;
    active.encrypted = null;
    sessionPasswords.delete(active.id);
    unlockedIds.add(active.id);
    persist();
    render();
  } else {
    const password = await askText("このメモにかけるパスワードを設定してください", { password: true });
    if (!password) return;
    const confirmPassword = await askText("確認のため、もう一度入力してください", { password: true });
    if (password !== confirmPassword) {
      await notify("パスワードが一致しませんでした。");
      return;
    }
    const hash = await window.cryptoAPI.hashPassword(password);
    active.locked = true;
    active.passwordHash = hash;
    sessionPasswords.set(active.id, password);
    unlockedIds.add(active.id);
    persist();
    render();
  }
};

lockUnlockBtn.onclick = async () => {
  const note = notes.find((n) => n.id === pendingUnlockId);
  if (!note) return;
  const password = lockPasswordInput.value;
  const ok = await window.cryptoAPI.verifyPassword(password, note.passwordHash);
  if (!ok) {
    lockError.textContent = "パスワードが違います。";
    return;
  }
  if (note.encrypted) {
    const result = await window.cryptoAPI.decrypt(note.encrypted, password);
    if (!result.ok) {
      lockError.textContent = "復号に失敗しました。データが壊れている可能性があります。";
      return;
    }
    note.body = result.text;
  }
  sessionPasswords.set(note.id, password);
  unlockedIds.add(note.id);
  viewMode = "editor";
  render();
};

lockPasswordInput.onkeydown = (e) => {
  if (e.isComposing) return;
  if (e.key === "Enter") lockUnlockBtn.click();
};

