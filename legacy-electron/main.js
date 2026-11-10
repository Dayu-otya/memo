const { app, BrowserWindow, ipcMain, dialog, nativeTheme, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { validateNotes, atomicWrite, safeFileStem, decodeText } = require("./storage");
const { pathToFileURL } = require("url");

let autoUpdater = null;

const dataDir = app.getPath("userData");
const dataFile = path.join(dataDir, "notes.json");
const settingsFile = path.join(dataDir, "settings.json");
const backupDir = path.join(dataDir, "backups");
const trashRetentionDays = 30;
const autoBackupMaxGenerations = 10;

let mainWindow = null;

function readNotes() {
  try {
    if (!fs.existsSync(dataFile)) return [];
    const raw = fs.readFileSync(dataFile, "utf-8");
    return validateNotes(JSON.parse(raw));
  } catch (e) {
    console.error("メモの読み込みに失敗しました:", e);
    throw new Error("メモを読み込めません。元のデータを保護するため編集を開始しません。バックアップからの復旧が必要です。");
  }
}

function writeNotes(notes) {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    validateNotes(notes);
    atomicWrite(dataFile, JSON.stringify(notes, null, 2));
    return true;
  } catch (e) {
    console.error("メモの保存に失敗しました:", e);
    return false;
  }
}

function readSettings() {
  try {
    if (!fs.existsSync(settingsFile)) return {};
    const settings = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("設定の形式が不正です。");
    if (settings.folders !== undefined && (!Array.isArray(settings.folders) || settings.folders.some(f => !f || typeof f.id !== "string" || typeof f.name !== "string"))) throw new Error("フォルダ設定の形式が不正です。");
    return settings;
  } catch (e) {
    console.error("設定の読み込みに失敗しました:", e);
    throw new Error("設定ファイルを読み込めません。元の設定を保護するため起動を中止しました。");
  }
}

function writeSettings(settings) {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    atomicWrite(settingsFile, JSON.stringify(settings, null, 2));
    return true;
  } catch (e) {
    console.error("設定の保存に失敗しました:", e);
    return false;
  }
}

function purgeExpiredTrash(notes) {
  const now = Date.now();
  const limit = trashRetentionDays * 24 * 60 * 60 * 1000;
  return notes.filter((n) => {
    if (!n.trashedAt) return true;
    return now - n.trashedAt < limit;
  });
}

function writeAutoBackup(notes) {
  try {
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(backupDir, `notes-${stamp}-${crypto.randomBytes(4).toString("hex")}.json`);
    fs.writeFileSync(file, JSON.stringify(notes, null, 2), "utf-8");

    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith("notes-") && f.endsWith(".json"))
      .sort();

    while (files.length > autoBackupMaxGenerations) {
      const oldest = files.shift();
      fs.unlinkSync(path.join(backupDir, oldest));
    }
    return true;
  } catch (e) {
    console.error("自動バックアップに失敗しました:", e);
    return false;
  }
}

ipcMain.handle("backup:listAuto", () => {
  try {
    if (!fs.existsSync(backupDir)) return [];
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith("notes-") && f.endsWith(".json"))
      .sort()
      .reverse();
    return files.map((f) => {
      const stat = fs.statSync(path.join(backupDir, f));
      let count = null;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(backupDir, f), "utf-8"));
        count = Array.isArray(parsed) ? parsed.length : null;
      } catch (e) {
      }
      return { fileName: f, mtime: stat.mtimeMs, noteCount: count };
    });
  } catch (e) {
    console.error("自動バックアップ一覧の取得に失敗しました:", e);
    return [];
  }
});

ipcMain.handle("backup:restoreAuto", (event, fileName) => {
  try {
    const safeName = path.basename(fileName);
    const target = path.join(backupDir, safeName);
    if (!fs.existsSync(target)) return { ok: false, error: "指定されたバックアップが見つかりません。" };
    const raw = fs.readFileSync(target, "utf-8");
    const notes = validateNotes(JSON.parse(raw));
    if (!Array.isArray(notes)) return { ok: false, error: "バックアップの形式が不正です。" };
    return { ok: true, notes };
  } catch (e) {
    console.error("自動バックアップの復元に失敗しました:", e);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle("backup:restoreFromFile", async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "復元するバックアップファイルを選択",
      properties: ["openFile"],
      filters: [{ name: "メモのバックアップ(JSON)", extensions: ["json"] }],
    });
    if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
    const raw = fs.readFileSync(filePaths[0], "utf-8");
    const notes = validateNotes(JSON.parse(raw));
    if (!Array.isArray(notes)) return { ok: false, error: "選択したファイルの形式が不正です。" };
    return { ok: true, notes, filePath: filePaths[0] };
  } catch (e) {
    console.error("ファイルからの復元に失敗しました:", e);
    return { ok: false, error: String(e) };
  }
});

function deriveKey(password, salt) {
  return crypto.scryptSync(password, salt, 32);
}

function encryptText(plainText, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    data: encrypted.toString("base64"),
  };
}

function decryptText(payload, password) {
  const salt = Buffer.from(payload.salt, "base64");
  const iv = Buffer.from(payload.iv, "base64");
  const authTag = Buffer.from(payload.authTag, "base64");
  const data = Buffer.from(payload.data, "base64");
  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf-8");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `${salt.toString("base64")}:${hash.toString("base64")}`;
}

function verifyPassword(password, stored) {
  try {
    const [saltB64, hashB64] = stored.split(":");
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = crypto.scryptSync(password, salt, 32);
    return crypto.timingSafeEqual(expected, actual);
  } catch (e) {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 700,
    minHeight: 480,
    backgroundColor: "#FAF7F0",
    autoHideMenuBar: true,

    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  let closeAllowed = false;
  let closing = false;
  mainWindow.on("close", async (event) => {
    if (closeAllowed) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    try {
      const ok = await mainWindow.webContents.executeJavaScript("window.flushBeforeClose ? window.flushBeforeClose() : false");
      if (!ok) throw new Error("保存を完了できませんでした。");
      closeAllowed = true;
      mainWindow.close();
    } catch (e) {
      dialog.showErrorBox("終了を中止しました", "編集内容を保存できませんでした。保存先の空き容量・アクセス権を確認し、再度お試しください。");
    } finally { closing = false; }
  });
  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
}

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
app.on("second-instance", () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});
app.whenReady().then(() => {
  if (!hasInstanceLock) return;
  createWindow();
  initAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let updateDownloaded = false;

ipcMain.handle("app:version", () => app.getVersion());

function initAutoUpdater() {
  if (!app.isPackaged) return;
  if (!autoUpdater) autoUpdater = require("electron-updater").autoUpdater;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("update-available", (info) => {
    sendToRenderer("update:available", { version: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    sendToRenderer("update:not-available");
  });

  autoUpdater.on("download-progress", (progress) => {
    sendToRenderer("update:progress", { percent: Math.round(progress.percent) });
  });

  autoUpdater.on("update-downloaded", (info) => {
    updateDownloaded = true;
    sendToRenderer("update:downloaded", { version: info.version });
  });

  autoUpdater.on("error", (err) => {
    console.error("自動アップデートの確認に失敗しました:", err);
    sendToRenderer("update:error", { message: String(err && err.message ? err.message : err) });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => {
      console.error("アップデート確認に失敗しました:", e);
    });
  }, 5000);
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

ipcMain.handle("update:checkNow", async () => {
  if (!app.isPackaged) {
    return { ok: false, reason: "dev" };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
});

ipcMain.handle("update:installNow", () => {
  if (!updateDownloaded) return { ok: false, reason: "not-ready" };
  setImmediate(() => autoUpdater.quitAndInstall());
  return { ok: true };
});

ipcMain.handle("notes:load", () => {
  const notes = readNotes();
  const cleaned = purgeExpiredTrash(notes);
  if (cleaned.length !== notes.length) writeNotes(cleaned);
  return cleaned;
});

ipcMain.handle("notes:save", (event, notes) => {
  const ok = writeNotes(notes);
  if (ok) {
    writeAutoBackup(notes);
    clearAutosave();
    lastSavedAt = Date.now();
  }
  return ok;
});

let lastSavedAt = null;

ipcMain.handle("notes:status", () => {
  let lastAutoBackupAt = null;
  try {
    if (fs.existsSync(backupDir)) {
      const files = fs
        .readdirSync(backupDir)
        .filter((f) => f.startsWith("notes-") && f.endsWith(".json"))
        .sort();
      if (files.length > 0) {
        const stat = fs.statSync(path.join(backupDir, files[files.length - 1]));
        lastAutoBackupAt = stat.mtimeMs;
      }
    }
  } catch (e) {
    console.error("自動バックアップ状態の取得に失敗しました:", e);
  }
  return { lastSavedAt, lastAutoBackupAt };
});

const autosaveFile = path.join(dataDir, "autosave.json");

function clearAutosave() {
  try {
    if (fs.existsSync(autosaveFile)) fs.unlinkSync(autosaveFile);
  } catch (e) {
    console.error("autosaveの削除に失敗しました:", e);
  }
}

ipcMain.handle("notes:autosave", (event, notes) => {
  try {
    validateNotes(notes);
    atomicWrite(autosaveFile, JSON.stringify({ savedAt: Date.now(), notes }, null, 2));
    return true;
  } catch (e) {
    console.error("autosaveに失敗しました:", e);
    return false;
  }
});

ipcMain.handle("notes:checkAutosave", () => {
  try {
    if (!fs.existsSync(autosaveFile)) return null;
    const raw = fs.readFileSync(autosaveFile, "utf-8");
    const draft = JSON.parse(raw);
    validateNotes(draft.notes);
    return draft;
  } catch (e) {
    console.error("autosaveの読み込みに失敗しました:", e);
    return null;
  }
});

ipcMain.handle("notes:discardAutosave", () => {
  clearAutosave();
  return true;
});

ipcMain.handle("settings:load", () => readSettings());
ipcMain.handle("settings:save", (event, settings) => writeSettings(settings));

ipcMain.handle("backup:checkpoint", () => {
  try { return writeAutoBackup(readNotes()); } catch (e) { return false; }
});

ipcMain.handle("backup:manual", async () => {
  const notes = readNotes();
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "メモのバックアップを保存",
    defaultPath: `notes-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSONファイル", extensions: ["json"] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(filePath, JSON.stringify(notes, null, 2), "utf-8");
    return { ok: true, filePath };
  } catch (e) {
    console.error("手動バックアップに失敗しました:", e);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle("notes:export", async (event, { title, body, bodyHtml, format }) => {
  const safeTitle = safeFileStem(title);
  const isPdf = format === "pdf";

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: isPdf ? "メモをPDFとして書き出し" : "メモをテキストとして書き出し",
    defaultPath: `${safeTitle}.${isPdf ? "pdf" : "txt"}`,
    filters: isPdf
      ? [{ name: "PDFファイル", extensions: ["pdf"] }]
      : [{ name: "テキストファイル", extensions: ["txt"] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  if (!isPdf) {
    try {
      fs.writeFileSync(filePath, body, "utf-8");
      return { ok: true, filePath };
    } catch (e) {
      console.error("エクスポートに失敗しました:", e);
      return { ok: false, error: String(e) };
    }
  }

  let pdfWindow = null;
  let pdfHtmlFile = null;
  try {
    const escapeHtmlForPdf = (s) =>
      String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const lines = String(body || "").split("\n");
    const titleLine = escapeHtmlForPdf(lines[0] || "無題のメモ");

    const restHtml =
      typeof bodyHtml === "string"
        ? bodyHtml
        : lines
            .slice(1)
            .map((l) => `<p>${escapeHtmlForPdf(l) || "&nbsp;"}</p>`)
            .join("\n");
    const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' file:; font-src file: data:; img-src data:;">
<link rel="stylesheet" href="${pathToFileURL(path.join(__dirname, 'src', 'style.css')).href}">
<link rel="stylesheet" href="${pathToFileURL(path.join(__dirname, 'src', 'vendor', 'katex', 'katex.min.css')).href}">
<style>
  html, body { height: auto; background: white; color: #222; }
  body { font-family: "Hiragino Sans", "Yu Gothic", sans-serif; padding: 32px; color: #222; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  h1, h2, h3 { margin: 0 0 8px; }
  p { font-size: 13px; line-height: 1.8; margin: 0 0 4px; white-space: pre-wrap; }
  ul { font-size: 13px; line-height: 1.8; margin: 0 0 8px; padding-left: 1.4em; }
  code, pre { font-family: "SFMono-Regular", Consolas, monospace; }
  pre { background: #f4f1e9; padding: 10px 12px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; }
</style></head>
<body><main class="print-preview-page"><h1>${titleLine}</h1>${restHtml}</main></body></html>`;

    pdfWindow = new BrowserWindow({ show: false, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
    pdfHtmlFile = path.join(app.getPath("temp"), `memo-print-${crypto.randomBytes(12).toString("hex")}.html`);
    fs.writeFileSync(pdfHtmlFile, html, { mode: 0o600 });
    await pdfWindow.loadFile(pdfHtmlFile);
    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
    });
    fs.writeFileSync(filePath, pdfBuffer);
    return { ok: true, filePath };
  } catch (e) {
    console.error("PDF書き出しに失敗しました:", e);
    return { ok: false, error: String(e) };
  } finally {
    if (pdfWindow) pdfWindow.destroy();
    if (pdfHtmlFile && fs.existsSync(pdfHtmlFile)) fs.unlinkSync(pdfHtmlFile);
  }
});

ipcMain.handle("notes:exportAllMarkdown", async (event, notes) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "書き出し先のフォルダを選択",
    properties: ["openDirectory", "createDirectory"],
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };

  const destDir = filePaths[0];
  const usedNames = new Set();
  let count = 0;
  try {
    for (const n of notes) {
      if (n.trashedAt) continue;
      if (n.locked) continue;
      const title = safeFileStem(n.title);
      let name = title;
      let i = 2;
      while (usedNames.has(name.toLowerCase()) || fs.existsSync(path.join(destDir, `${name}.md`))) {
        name = `${title}_${i}`;
        i++;
      }
      usedNames.add(name.toLowerCase());
      const filePath = path.join(destDir, `${name}.md`);
      fs.writeFileSync(filePath, n.body, { encoding: "utf-8", flag: "wx" });
      count++;
    }
    return { ok: true, count, destDir };
  } catch (e) {
    console.error("Markdown一括エクスポートに失敗しました:", e);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle("notes:importMarkdown", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "インポートするMarkdownファイルを選択",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Markdown / テキスト", extensions: ["md", "markdown", "txt"] }],
  });
  if (canceled || !filePaths || filePaths.length === 0) return { ok: false, canceled: true };

  const imported = [];
  try {
    for (const filePath of filePaths) {
      const body = decodeText(fs.readFileSync(filePath));
      imported.push({ body, fileName: path.basename(filePath) });
    }
    return { ok: true, imported };
  } catch (e) {
    console.error("Markdownインポートに失敗しました:", e);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle("app:print", () => new Promise((resolve) => {
  if (!mainWindow || mainWindow.isDestroyed()) return resolve({ ok: false, error: "印刷対象がありません。" });
  try {
    mainWindow.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
      resolve({ ok: success, canceled: /cancel/i.test(reason || ""), error: reason || "" });
    });
  } catch (e) { resolve({ ok: false, error: String(e) }); }
}));

ipcMain.handle("shell:openExternal", async (event, url) => {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, error: "許可されていないURLの形式です" };
    }
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch (e) {
    console.error("外部リンクのオープンに失敗しました:", e);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle("crypto:encrypt", (event, { text, password }) => {
  return encryptText(text, password);
});

ipcMain.handle("crypto:decrypt", (event, { payload, password }) => {
  try {
    return { ok: true, text: decryptText(payload, password) };
  } catch (e) {
    return { ok: false, error: "パスワードが違うか、データが壊れています" };
  }
});

ipcMain.handle("crypto:hashPassword", (event, password) => hashPassword(password));
ipcMain.handle("crypto:verifyPassword", (event, { password, stored }) =>
  verifyPassword(password, stored)
);

ipcMain.handle("system:prefersDark", () => nativeTheme.shouldUseDarkColors);
