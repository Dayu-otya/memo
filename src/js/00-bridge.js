// 橋渡し層: 現行 preload.js が公開していた7つの窓口(notesAPI ほか)を、同じ名前・同じ形で Tauri の上に作る。
// 画面側の他のスクリプト(01〜15)は変更しない。Tauri の外(試験など)で読まれたときは何もしない。
(function () {
  "use strict";
  var T = window.__TAURI__;
  if (!T || !T.core || !T.event) return;

  var invoke = T.core.invoke;
  var listen = T.event.listen;

  // Electron の ipcRenderer.invoke が失敗したときと同じ文言の Error にする(画面側は e.message を表示する)。
  function call(channel, command, args) {
    return invoke(command, args || {}).catch(function (e) {
      var detail = typeof e === "string" ? e : (e && e.message) || String(e);
      throw new Error("Error invoking remote method '" + channel + "': Error: " + detail);
    });
  }

  // 現行版はファイルへ書くとき、対にならないサロゲートを U+FFFD に置き換えていた(Node.js の UTF-8 変換)。
  // Rust 側の JSON 解析はそれを受け付けないため、送る前に同じ置き換えをする。
  function wellFormed(value) {
    if (typeof value === "string") {
      return typeof value.toWellFormed === "function" ? value.toWellFormed()
        : value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, function (m) {
          return m.length === 2 ? m[0] + "�" : "�";
        });
    }
    if (Array.isArray(value)) return value.map(wellFormed);
    if (value && typeof value === "object") {
      var out = {};
      Object.keys(value).forEach(function (k) {
        var v = value[k];
        if (v !== undefined && typeof v !== "function") out[wellFormed(k)] = wellFormed(v);
      });
      return out;
    }
    return value;
  }

  // ipcRenderer.on と同じく、すぐに「購読をやめる関数」を返す。
  function subscribe(eventName, handler) {
    var unlisten = null;
    var disposed = false;
    listen(eventName, function (event) { handler(event.payload); }).then(function (u) {
      if (disposed) u(); else unlisten = u;
    }).catch(function (e) { console.error("通知の購読に失敗しました:", eventName, e); });
    return function () { disposed = true; if (unlisten) unlisten(); };
  }

  window.notesAPI = {
    load: function () { return call("notes:load", "notes_load"); },
    save: function (notes) { return call("notes:save", "notes_save", { notes: wellFormed(notes) }); },
    export: function (note) { return call("notes:export", "notes_export", { note: wellFormed(note) }); },
    exportAllMarkdown: function (notes) { return call("notes:exportAllMarkdown", "notes_export_all_markdown", { notes: wellFormed(notes) }); },
    importMarkdown: function () { return call("notes:importMarkdown", "notes_import_markdown"); },
    autosave: function (notes) { return call("notes:autosave", "notes_autosave", { notes: wellFormed(notes) }); },
    checkAutosave: function () { return call("notes:checkAutosave", "notes_check_autosave"); },
    discardAutosave: function () { return call("notes:discardAutosave", "notes_discard_autosave"); },
    status: function () { return call("notes:status", "notes_status"); },
  };

  // 現行 preload は settingsAPI.prefersDark も公開していたが、画面側で使われていないため移植しない(計画書 第2節)。
  window.settingsAPI = {
    load: function () { return call("settings:load", "settings_load"); },
    save: function (settings) { return call("settings:save", "settings_save", { settings: wellFormed(settings) }); },
  };

  window.backupAPI = {
    checkpoint: function () { return call("backup:checkpoint", "backup_checkpoint"); },
    manual: function () { return call("backup:manual", "backup_manual"); },
    listAuto: function () { return call("backup:listAuto", "backup_list_auto"); },
    restoreAuto: function (fileName) { return call("backup:restoreAuto", "backup_restore_auto", { fileName: fileName === undefined ? null : fileName }); },
    restoreFromFile: function () { return call("backup:restoreFromFile", "backup_restore_from_file"); },
  };

  // 印刷: WebView2 では window.print() が標準の印刷画面を開き、閉じるまで戻らない。
  // 成功と取消を区別する手段がないため、取消を失敗扱いにしないことを優先し、常に成功として返す(計画書 第3節)。
  var nativePrint = window.print.bind(window);
  window.printAPI = {
    print: function () {
      return new Promise(function (resolve) {
        try { nativePrint(); resolve({ ok: true, canceled: false, error: "" }); }
        catch (e) { resolve({ ok: false, canceled: false, error: String(e) }); }
      });
    },
  };

  window.shellAPI = {
    openExternal: function (url) { return call("shell:openExternal", "shell_open_external", { url: url === undefined ? null : url }); },
  };

  window.cryptoAPI = {
    encrypt: function (text, password) { return call("crypto:encrypt", "crypto_encrypt", { text: wellFormed(text), password: wellFormed(password) }); },
    decrypt: function (payload, password) { return call("crypto:decrypt", "crypto_decrypt", { payload: payload === undefined ? null : payload, password: password === undefined ? null : wellFormed(password) }); },
    hashPassword: function (password) { return call("crypto:hashPassword", "crypto_hash_password", { password: wellFormed(password) }); },
    verifyPassword: function (password, stored) { return call("crypto:verifyPassword", "crypto_verify_password", { password: password === undefined ? null : wellFormed(password), stored: stored === undefined ? null : stored }); },
  };

  window.updateAPI = {
    checkNow: function () { return call("update:checkNow", "update_check_now"); },
    installNow: function () { return call("update:installNow", "update_install_now"); },
    getVersion: function () { return call("app:version", "app_version"); },
    onAvailable: function (cb) { return subscribe("update:available", function (p) { cb(p); }); },
    onNotAvailable: function (cb) { return subscribe("update:not-available", function () { cb(); }); },
    onProgress: function (cb) { return subscribe("update:progress", function (p) { cb(p); }); },
    onDownloaded: function (cb) { return subscribe("update:downloaded", function (p) { cb(p); }); },
    onError: function (cb) { return subscribe("update:error", function (p) { cb(p); }); },
  };

  // 終了時: Rust 側が閉じる要求を止めてこの通知を送る。画面側の保存を待ち、結果を返す。
  subscribe("app:flush-before-close", function (generation) {
    Promise.resolve()
      .then(function () { return window.flushBeforeClose ? window.flushBeforeClose() : false; })
      .then(function (ok) { return !!ok; }, function (e) { console.error("終了前の保存に失敗しました:", e); return false; })
      .then(function (ok) { return invoke("app_close_after_flush", { generation: generation, ok: ok }); })
      .catch(function (e) { console.error("終了処理の連絡に失敗しました:", e); });
  });

  // Electron 版は印刷時に背景を出力していた(printBackground: true)。
  // WebView2 の印刷画面は「背景のグラフィック」が既定で無効のため、印刷用の表示に限り背景色を保つよう指定する。
  var printStyle = document.createElement("style");
  printStyle.textContent = "@media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }";
  (document.head || document.documentElement).appendChild(printStyle);
})();
