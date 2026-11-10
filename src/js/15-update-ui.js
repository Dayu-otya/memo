

function showUpdateBanner(text, { withAction = false } = {}) {
  updateBannerText.textContent = text;
  updateBannerActionBtn.style.display = withAction ? "inline-flex" : "none";
  updateBanner.style.display = "flex";
}

updateBannerDismissBtn.onclick = () => {
  updateBanner.style.display = "none";
};

updateBannerActionBtn.onclick = async () => {
  try {
    if (!await window.flushBeforeClose()) { await notify("保存できなかったため更新を中止しました。"); return; }
  } catch (e) {
    console.error("更新適用前の保存に失敗しました:", e);
    return;
  }
  const result = await window.updateAPI.installNow();
  if (!result.ok) {
    await notify("更新の適用に失敗しました。アプリを再起動して、もう一度お試しください。");
  }
};

async function initUpdateUI() {
  if (!window.updateAPI) return;

  try {
    const version = await window.updateAPI.getVersion();
    if (version) appVersionText.textContent = `バージョン ${version}`;
  } catch (e) {
    console.error("バージョン情報の取得に失敗しました:", e);
  }

  window.updateAPI.onAvailable((info) => {
    showUpdateBanner(`新しいバージョン(${info.version})をダウンロードしています…`);
  });

  window.updateAPI.onProgress((progress) => {
    showUpdateBanner(`更新をダウンロード中… ${progress.percent}%`);
  });

  window.updateAPI.onDownloaded((info) => {
    showUpdateBanner(
      `新しいバージョン(${info.version})の準備ができました。`,
      { withAction: true }
    );
  });

  window.updateAPI.onNotAvailable(() => {
  });

  window.updateAPI.onError((err) => {
    console.error("自動アップデートでエラーが発生しました:", err.message);
  });
}

checkUpdateBtn.onclick = async () => {
  menuPanel.style.display = "none";
  if (!window.updateAPI) {
    await notify("この機能は、インストール済みのアプリでのみ利用できます。");
    return;
  }
  const result = await window.updateAPI.checkNow();
  if (!result.ok && result.reason === "dev") {
    await notify("開発中の実行では、更新確認はスキップされます。");
  } else if (!result.ok) {
    await notify("更新の確認に失敗しました。インターネット接続をご確認ください。");
  } else {
    await notify("更新を確認しています。新しいバージョンがあれば、まもなく通知されます。");
  }
};

initUpdateUI();
