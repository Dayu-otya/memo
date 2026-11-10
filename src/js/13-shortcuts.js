

const SHORTCUTS_GROUPS = [
  {
    title: "メモの操作",
    items: [
      { keys: ["Ctrl", "N"], desc: "新しいメモを作成" },
      { keys: ["Ctrl", "S"], desc: "今すぐ保存" },
      { keys: ["Ctrl", "Shift", "P"], desc: "選択中のメモの固定(ピン留め)を切り替える" },
      { keys: ["Ctrl", "L"], desc: "選択中のメモのパスワードロックを切り替える" },
      { keys: ["Delete"], desc: "選択中のメモをゴミ箱へ移動する(複数選択中はまとめて移動、確認あり)", note: "本文やタイトルなど入力欄にフォーカス中は無効" },
    ],
  },
  {
    title: "検索",
    items: [
      { keys: ["Ctrl", "F"], desc: "検索欄にカーソルを移動", note: "メモ本文にフォーカス中はメモ内検索を開く" },
    ],
  },
  {
    title: "書式・編集",
    items: [
      { keys: ["Ctrl", "M"], desc: "選択中のメモの表示をMarkdownプレビューと通常編集の間で切り替える", note: "本文にフォーカスしていなくても、メモを選択していれば動作します" },
      { keys: ["Ctrl", "B"], desc: "選択中のテキストを太字(**太字**)にする", note: "本文欄(通常編集・Markdown編集どちらも)にフォーカス中のみ" },
      { keys: ["Ctrl", "I"], desc: "選択中のテキストを斜体(*斜体*)にする", note: "本文欄(通常編集・Markdown編集どちらも)にフォーカス中のみ" },
      { keys: ["Ctrl", "Z"], desc: "元に戻す", note: "本文欄(通常編集・Markdown編集どちらも)にフォーカス中のみ" },
      { keys: ["Ctrl", "Y"], desc: "やり直し", note: "本文欄(通常編集・Markdown編集どちらも)にフォーカス中のみ" },
    ],
  },
  {
    title: "表示",
    items: [
      { keys: ["Ctrl", "D"], desc: "ダークモードとライトモードを切り替える" },
      { keys: ["Ctrl", "T"], desc: "Todo一覧の表示/編集画面への表示を切り替える" },
    ],
  },
  {
    title: "出力",
    items: [
      { keys: ["Ctrl", "P"], desc: "印刷プレビューを開く" },
      { keys: ["Ctrl", "E"], desc: "テキストとして書き出し" },
    ],
  },
  {
    title: "選択・その他",
    items: [
      { keys: ["Ctrl", "クリック"], desc: "メモを個別に追加選択" },
      { keys: ["Shift", "クリック"], desc: "メモを範囲選択" },
      { keys: ["Esc"], desc: "開いているダイアログ/メモ内検索/印刷プレビュー/ToDo表示を閉じる、または複数選択を解除する" },
    ],
  },
];

const MARKDOWN_GUIDE_GROUPS = [
  {
    title: "見出し",
    items: [
      { keys: ["# 見出し"], desc: "見出し(1番大きい)" },
      { keys: ["## 見出し"], desc: "見出し(2番目に大きい)" },
      { keys: ["### 見出し"], desc: "見出し(3番目に大きい)", note: "以降 #### / ##### / ###### まで、#の数を増やすほど小さくなる(最大6段階)" },
    ],
  },
  {
    title: "文字の装飾",
    items: [
      { keys: ["**太字**"], desc: "太字にする" },
      { keys: ["*斜体*"], desc: "斜体にする" },
      { keys: ["***太字斜体***"], desc: "太字と斜体を同時にする" },
      { keys: ["~~取り消し線~~"], desc: "取り消し線を引く" },
      { keys: ["`コード`"], desc: "文中にコードを埋め込む(インラインコード)" },
    ],
  },
  {
    title: "リスト",
    items: [
      { keys: ["- 項目"], desc: "箇条書き", note: "-の代わりに*でも可" },
      { keys: ["1. 項目"], desc: "番号付きリスト" },
      { keys: ["- [ ] 項目"], desc: "チェックボックス(未チェック)" },
      { keys: ["- [x] 項目"], desc: "チェックボックス(チェック済み)" },
    ],
  },
  {
    title: "引用・区切り線",
    items: [
      { keys: ["> 引用"], desc: "引用として表示する" },
      { keys: ["---"], desc: "区切り線を引く", note: "***でも可" },
    ],
  },
  {
    title: "リンク",
    items: [
      { keys: ["[表示名](URL)"], desc: "リンクを挿入する" },
      { keys: ["[[ノート名]]"], desc: "他のメモへのリンクを挿入する" },
    ],
  },
  {
    title: "コードブロック",
    items: [
      { keys: ["```\n(コード)\n```"], desc: "複数行のコードを枠付きで表示する", note: "1行目の```の直後に言語名(例:javascript)を書くと、その言語向けの色分け表示になる", multiline: true },
    ],
  },
  {
    title: "数式",
    items: [
      { keys: ["$数式$"], desc: "文中に数式を埋め込む(インライン数式)" },
      { keys: ["$$\n(数式)\n$$"], desc: "数式を独立したブロックとして大きく表示する", multiline: true },
    ],
  },
  {
    title: "表",
    items: [
      { keys: ["| 見出し | 見出し |\n| --- | --- |\n| 内容 | 内容 |"], desc: "表を作成する", note: "2行目の---(区切り行)は表の開始の合図。:--- / :---: / ---:と書くと左寄せ/中央寄せ/右寄せを指定できる", multiline: true },
    ],
  },
];

function renderKeyValueList(container, groups) {
  container.innerHTML = "";
  groups.forEach((group) => {
    const groupTitle = document.createElement("div");
    groupTitle.className = "shortcuts-group-title";
    groupTitle.textContent = group.title;
    container.appendChild(groupTitle);

    group.items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "shortcuts-row";

      const keysEl = document.createElement("div");
      keysEl.className = "shortcuts-keys";
      if (item.multiline) {
        const pre = document.createElement("pre");
        pre.className = "shortcut-key shortcut-key-multiline";
        pre.textContent = item.keys[0];
        keysEl.appendChild(pre);
      } else {
        item.keys.forEach((key, i) => {
          if (i > 0) {
            const plus = document.createElement("span");
            plus.className = "shortcuts-plus";
            plus.textContent = "+";
            keysEl.appendChild(plus);
          }
          const kbd = document.createElement("kbd");
          kbd.className = "shortcut-key";
          kbd.textContent = key;
          keysEl.appendChild(kbd);
        });
      }
      row.appendChild(keysEl);

      const descEl = document.createElement("div");
      descEl.className = "shortcuts-desc";
      descEl.textContent = item.desc;
      if (item.note) {
        const note = document.createElement("span");
        note.className = "shortcuts-note";
        note.textContent = item.note;
        descEl.appendChild(note);
      }
      row.appendChild(descEl);

      container.appendChild(row);
    });
  });
}

function renderMarkdownGuideList() {
  renderKeyValueList(markdownGuideList, MARKDOWN_GUIDE_GROUPS);
}

showMarkdownGuideBtn.onclick = () => {
  menuPanel.style.display = "none";
  renderMarkdownGuideList();
  markdownGuideOverlay.style.display = "flex";
};

markdownGuideCloseBtn.onclick = () => {
  markdownGuideOverlay.style.display = "none";
};

markdownGuideOverlay.addEventListener("click", (e) => {
  if (e.target === markdownGuideOverlay) markdownGuideOverlay.style.display = "none";
});

function renderShortcutsList() {
  renderKeyValueList(shortcutsList, SHORTCUTS_GROUPS);
}

showShortcutsBtn.onclick = () => {
  menuPanel.style.display = "none";
  renderShortcutsList();
  shortcutsOverlay.style.display = "flex";
};

shortcutsCloseBtn.onclick = () => {
  shortcutsOverlay.style.display = "none";
};

shortcutsOverlay.addEventListener("click", (e) => {
  if (e.target === shortcutsOverlay) shortcutsOverlay.style.display = "none";
});

function isTypingContext(target) {
  return isTextEntryElement(target);
}

document.addEventListener("keydown", (e) => {
  if (e.isComposing || e.keyCode === 229) return;
  if (modalOverlay.style.display !== "none") {
    if (e.key === "Escape") modalCancelBtn.click();
    return;
  }

  if (restoreOverlay.style.display !== "none") {
    if (e.key === "Escape") restoreOverlay.style.display = "none";
    return;
  }

  if (shortcutsOverlay.style.display !== "none") {
    if (e.key === "Escape") shortcutsOverlay.style.display = "none";
    return;
  }

  if (markdownGuideOverlay.style.display !== "none") {
    if (e.key === "Escape") markdownGuideOverlay.style.display = "none";
    return;
  }

  // Do not intercept application-wide shortcuts while typing in any field
  // other than the memo editor itself (passwords, search, tags, settings).
  if (isTypingContext(e.target) && e.target !== bodyInput && e.target !== mdPreview) return;

  const ctrlOrCmd = e.ctrlKey || e.metaKey;

  if (ctrlOrCmd && e.key.toLowerCase() === "n") {
    e.preventDefault();
    createNote();
    return;
  }

  if (ctrlOrCmd && e.key.toLowerCase() === "f") {
    e.preventDefault();
    if (isBodyFocused() && viewMode === "editor" && getActive()) {
      openNoteSearch();
    } else {
      searchInput.focus();
    }
    return;
  }

  if (ctrlOrCmd && e.key.toLowerCase() === "s") {
    e.preventDefault();
    const active = getActive();
    if (active) saveImmediately();
    return;
  }

  if (ctrlOrCmd && !e.shiftKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    printBtn.click();
    return;
  }

  if (ctrlOrCmd && e.key.toLowerCase() === "e") {
    e.preventDefault();
    exportActiveNote("txt");
    return;
  }

  if (ctrlOrCmd && !e.shiftKey && e.key.toLowerCase() === "m") {
    e.preventDefault();
    if (getActive()) markdownToggleBtn.click();
    return;
  }

  if (ctrlOrCmd && !e.shiftKey && e.key.toLowerCase() === "d") {
    e.preventDefault();
    themeToggleBtn.click();
    return;
  }

  if (ctrlOrCmd && !e.shiftKey && e.key.toLowerCase() === "l") {
    e.preventDefault();
    if (getActive()) lockToggleBtn.click();
    return;
  }

  if (ctrlOrCmd && !e.shiftKey && e.key.toLowerCase() === "t") {
    e.preventDefault();
    todoBtn.click();
    return;
  }

  if (ctrlOrCmd && e.shiftKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    if (getActive()) pinBtn.click();
    return;
  }

  if (ctrlOrCmd && !e.shiftKey && e.key.toLowerCase() === "b") {
    if (document.activeElement === bodyInput) {
      e.preventDefault();
      wrapBodySelection("**", "**");
    } else if (document.activeElement === mdPreview) {
      e.preventDefault();
      wrapMdSelection("**", "**");
    }
    return;
  }

  if (ctrlOrCmd && !e.shiftKey && e.key.toLowerCase() === "i") {
    if (document.activeElement === bodyInput) {
      e.preventDefault();
      wrapBodySelection("*", "*");
    } else if (document.activeElement === mdPreview) {
      e.preventDefault();
      wrapMdSelection("*", "*");
    }
    return;
  }

  if (ctrlOrCmd && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
    const isRedo = e.key.toLowerCase() === "y" || e.shiftKey;

    if (document.activeElement === bodyInput) {

      if (isRedo) mdRedo(); else mdUndo();
      e.preventDefault();
      return;
    }

    if (document.activeElement === mdPreview) {

      e.preventDefault();
      if (isRedo) mdRedo();
      else mdUndo();
    }
    return;
  }

  if (e.key === "Delete" && !isTypingContext(e.target)) {
    e.preventDefault();
    if (selectedIds.size > 0) {
      selectionDeleteBtn.click();
    } else {
      const active = getActive();
      if (active && viewMode === "editor") moveToTrash(active.id);
    }
    return;
  }

  if (e.key === "Escape") {
    if (noteSearchBar.style.display !== "none") {
      closeNoteSearch();
      return;
    }
    if (viewMode === "print") {
      viewMode = "editor";
      render();
      return;
    }
    if (viewMode === "todo") {
      viewMode = "editor";
      render();
      return;
    }
    if (selectedIds.size > 0) {
      clearSelection();
      render();
    }
    return;
  }
});
