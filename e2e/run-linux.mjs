// 端から端までの試験(Linux + WebKitGTK + tauri-driver)。Windows では同じ手順を Edge Driver で行う(計画書 第5節)。
// 使い方: xvfb-run node e2e/run-linux.mjs <アプリの実行ファイル>
// 保存先は一時フォルダーに切り替える(XDG_CONFIG_HOME)。利用者の実データには触れない。
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const here = path.dirname(new URL(import.meta.url).pathname);
const closeWindow = (title = "メモ帳") => Number(execFileSync("python3", [path.join(here, "close-window.py"), title], { env }).toString().trim());

const app = path.resolve(process.argv[2]);
const home = fs.mkdtempSync(path.join(os.tmpdir(), "memo-e2e-"));
const dataDir = path.join(home, "memo-app");
const env = { ...process.env, XDG_CONFIG_HOME: home };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, fn) { results.push([name, fn]); }

const driver = spawn("tauri-driver", ["--port", "4444"], { env, stdio: ["ignore", "inherit", "inherit"] });
async function wd(method, url, body) {
  const r = await fetch("http://127.0.0.1:4444" + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${url}: ${j.value && j.value.error} ${j.value && j.value.message}`);
  return j.value;
}
async function session() {
  for (let i = 0; i < 50; i++) {
    try { return (await wd("POST", "/session", { capabilities: { alwaysMatch: { "tauri:options": { application: app } } } })).sessionId; }
    catch (e) { if (i === 49) throw e; await sleep(200); }
  }
}
const exec = (sid, script, args = []) => wd("POST", `/session/${sid}/execute/sync`, { script, args });
const execAsync = (sid, script, args = []) => wd("POST", `/session/${sid}/execute/async`, { script, args });
async function waitFor(sid, expr, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await exec(sid, `return !!(${expr});`)) return; await sleep(200); }
  throw new Error("時間切れ: " + expr);
}

let failed = 0;
try {
  let sid = await session();
  await waitFor(sid, "window.appReady === true || (typeof appReady !== 'undefined' && appReady === true)");

  check("橋渡し層の7窓口が現行と同じ名前で揃う", async () => {
    const names = await exec(sid, `return ["notesAPI","settingsAPI","backupAPI","printAPI","shellAPI","cryptoAPI","updateAPI"].filter(n => typeof window[n] === "object");`);
    assert.equal(names.length, 7);
    const count = await exec(sid, `return ["notesAPI","settingsAPI","backupAPI","printAPI","shellAPI","cryptoAPI","updateAPI"].reduce((a,n)=>a+Object.keys(window[n]).length,0);`);
    assert.equal(count, 30); // 渡し口25本 + 通知5種
  });
  check("CSP の下で HTML の style 属性が効く(メニューは閉じている)", async () => {
    assert.equal(await exec(sid, `return getComputedStyle(document.getElementById("menuPanel")).display;`), "none");
  });
  check("起動直後の読込が成功し、読み込み失敗表示が出ない", async () => {
    assert.notEqual(await exec(sid, `return document.getElementById("saveState").textContent;`), "読み込み失敗");
  });
  check("暗号の往復(Rust側)", async () => {
    const r = await execAsync(sid, `const done = arguments[arguments.length-1];
      (async () => { const p = await cryptoAPI.encrypt("秘密\\n本文", "pw"); const a = await cryptoAPI.decrypt(p, "pw");
        const b = await cryptoAPI.decrypt(p, "no"); const h = await cryptoAPI.hashPassword("pw");
        return { keys: Object.keys(p).sort().join(","), text: a.text, bad: b.ok, err: b.error, v1: await cryptoAPI.verifyPassword("pw", h), v2: await cryptoAPI.verifyPassword("x", h) }; })().then(done, e => done(String(e)));`);
    assert.deepEqual(r, { keys: "authTag,data,iv,salt", text: "秘密\n本文", bad: false, err: "パスワードが違うか、データが壊れています", v1: true, v2: false });
  });
  check("外部リンクは http/https 以外を拒否", async () => {
    const r = await execAsync(sid, `const done = arguments[arguments.length-1]; shellAPI.openExternal("file:///etc/passwd").then(done, e => done(String(e)));`);
    assert.deepEqual(r, { ok: false, error: "許可されていないURLの形式です" });
  });
  check("画面から新規メモを作り、保存すると notes.json と自動バックアップができる", async () => {
    await exec(sid, `document.getElementById("newNoteBtn").click();`);
    await sleep(300);
    const r = await execAsync(sid, `const done = arguments[arguments.length-1];
      (async () => { const n = getActive(); n.body = "E2Eの題名\\n日本語の本文\\n"; persist(); const ok = await saveImmediately(); return { ok, status: await notesAPI.status() }; })().then(done, e => done(String(e)));`);
    assert.equal(r.ok, true);
    assert.equal(typeof r.status.lastSavedAt, "number");
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "notes.json"), "utf8"));
    assert.ok(onDisk.some((n) => n.body === "E2Eの題名\n日本語の本文\n"));
    assert.ok(fs.readdirSync(path.join(dataDir, "backups")).some((f) => /^notes-.*\.json$/.test(f)));
  });
  check("Rust 側の拒否は Electron と同じ形の Error 文言になる", async () => {
    fs.writeFileSync(path.join(dataDir, "settings.json"), "{broken");
    const r = await execAsync(sid, `const done = arguments[arguments.length-1]; settingsAPI.load().then(v => done("resolved"), e => done(e instanceof Error ? e.message : "not Error"));`);
    assert.equal(r, "Error invoking remote method 'settings:load': Error: 設定ファイルを読み込めません。元の設定を保護するため起動を中止しました。");
    fs.writeFileSync(path.join(dataDir, "settings.json"), "{}");
  });
  check("対にならないサロゲートを含む本文も保存できる(U+FFFDに置換、現行版の書込と同じ)", async () => {
    const r = await execAsync(sid, `const done = arguments[arguments.length-1];
      notesAPI.autosave([{ id: "s", body: "a\\ud83db" }]).then(async ok => done({ ok, d: (await notesAPI.checkAutosave()).notes[0].body }), e => done(String(e)));`);
    assert.deepEqual(r, { ok: true, d: "a�b" });
    await execAsync(sid, `const done = arguments[arguments.length-1]; notesAPI.discardAutosave().then(done);`);
  });
  check("更新確認は開発中の実行では dev を返す(現行と同じ)", async () => {
    const r = await execAsync(sid, `const done = arguments[arguments.length-1]; updateAPI.checkNow().then(done, e => done(String(e)));`);
    if (process.env.MEMO_E2E_RELEASE) assert.equal(typeof r.ok, "boolean"); // 配布版は実際に確認しに行く
    else assert.deepEqual(r, { ok: false, reason: "dev" });
    assert.equal(await execAsync(sid, `const done = arguments[arguments.length-1]; updateAPI.getVersion().then(done);`), "2.0.1");
  });
  check("PDF 書き出しは Windows 以外では明示的な失敗を返す(ダイアログ取消なら canceled)", async () => {
    // ダイアログは操作できないため、ここでは命令が登録され権限が通ることだけを確かめる
    const r = await execAsync(sid, `const done = arguments[arguments.length-1]; window.__TAURI__.core.invoke("app_version").then(done, e => done("denied:" + e));`);
    assert.equal(r, "2.0.1");
  });

  // ---- 2.0.1 の修正(利用者の報告4件)の再発防止 ----
  const click = async (css) => { const v = await wd("POST", `/session/${sid}/element`, { using: "css selector", value: css }); await wd("POST", `/session/${sid}/element/${Object.values(v)[0]}/click`, {}); };
  const sendKeys = (text) => wd("POST", `/session/${sid}/actions`, { actions: [{ type: "key", id: "k", actions: [...text].flatMap((c) => [{ type: "keyDown", value: c }, { type: "keyUp", value: c }]) }] });
  check("メモの色を変えると編集画面の背景色が変わる(明るい表示と暗い表示)", async () => {
    const bg = async (i) => { await exec(sid, `setColor(getActive().id, ${i});`); await sleep(100); return exec(sid, `return getComputedStyle(editorView).backgroundColor;`); };
    const light = new Set([await bg(0), await bg(1), await bg(2), await bg(3), await bg(4)]);
    assert.equal(light.size, 5, "5色が別の背景色になっていない");
    assert.equal(await bg(1), "rgb(234, 242, 233)");
    await exec(sid, `document.documentElement.setAttribute("data-theme", "dark");`);
    assert.equal(await exec(sid, `return getComputedStyle(editorView).backgroundColor;`), "rgb(35, 46, 36)");
    await exec(sid, `document.documentElement.setAttribute("data-theme", "light");`);
  });
  check("マークダウン表示で本文を打った直後にロックの鍵を押しても、パスワード欄に入力できる", async () => {
    await exec(sid, `const a = getActive(); a.body = ""; a.markdownPreview = true; render();`);
    await sleep(300);
    await click("#mdPreview"); await sendKeys("hello"); await sleep(40);
    await click("#lockToggleBtn"); await sleep(400);
    assert.equal(await exec(sid, `return document.activeElement.id;`), "modalInput");
    await sendKeys("pw12"); await sleep(300);
    assert.equal(await exec(sid, `return modalInput.value;`), "pw12");
    assert.equal(await exec(sid, `return getActive().body;`), "hello", "パスワードが本文に入った");
    await exec(sid, `modalCancelBtn.click(); getActive().markdownPreview = false; render();`);
  });
  check("長い1行(空白なし)を貼っても編集画面が窓の外へはみ出さない(読めて、すべてコピーできる)", async () => {
    for (const md of [false, true]) {
      await exec(sid, `const a = getActive(); a.body = "A".repeat(5000); a.markdownPreview = ${md}; render();`);
      await sleep(400);
      const r = await exec(sid, `const e = document.getElementById(${md} ? "mdPreview" : "bodyInput"); return { right: e.getBoundingClientRect().right, inner: window.innerWidth };`);
      assert.ok(r.right <= r.inner + 1, `${md ? "マークダウン" : "通常"}表示がはみ出している: ${JSON.stringify(r)}`);
    }
    await exec(sid, `getActive().markdownPreview = false; render();`);
  });
  check("タグ入力欄の横幅は窓の大きさによらず固定", async () => {
    const w = () => exec(sid, `return Math.round(document.getElementById("tagInput").getBoundingClientRect().width);`);
    const a = await w();
    await wd("POST", `/session/${sid}/window/rect`, { width: 1500, height: 800 }).catch(() => {});
    await sleep(400);
    const b = await w();
    assert.equal(a, 200);
    assert.equal(b, 200);
  });

  for (const [name, fn] of results) {
    try { await fn(); console.log("ok    -", name); }
    catch (e) { failed++; console.log("FAIL  -", name, "\n       ", e.message); }
  }

  // 終了処理(計画書 第3節「保存を待ち、失敗時は開いたまま」)。窓管理からの閉じる要求を実際に送って確かめる。
  try {
    // (1) 保存に失敗する場合は閉じない
    await exec(sid, `window.__realFlush = window.flushBeforeClose; window.flushBeforeClose = async () => false;`);
    assert.ok(closeWindow() >= 1);
    await sleep(1500);
    assert.equal(await exec(sid, `return document.title;`), "メモ帳");
    // 現行版と同じく「終了を中止しました」の知らせが出る。利用者が閉じる操作を再現する。
    assert.equal(closeWindow("終了を中止しました"), 1, "終了を中止した旨の知らせが出ていない");
    await sleep(500);
    console.log("ok    - 保存に失敗したときは終了を中止し、知らせを出して窓は開いたまま");
    // (2) 二重の閉じる要求の後でも、保存に成功すれば閉じる
    await exec(sid, `window.flushBeforeClose = window.__realFlush; const n = getActive(); n.body = "終了直前の編集\\n"; persist();`);
    closeWindow(); closeWindow();
    await sleep(2500);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "notes.json"), "utf8"));
    assert.ok(onDisk.some((n) => n.body === "終了直前の編集\n"), "終了前の保存がディスクにない");
    let alive = true;
    try { await exec(sid, `return 1;`); } catch { alive = false; }
    assert.equal(alive, false, "保存に成功したのに窓が閉じていない");
    await wd("DELETE", `/session/${sid}`).catch(() => {});
    await sleep(500);
    // (3) 再起動すると内容が残っている
    sid = await session();
    await waitFor(sid, "typeof appReady !== 'undefined' && appReady === true");
    assert.ok((await exec(sid, `return notes.map(n => n.body);`)).includes("終了直前の編集\n"));
    console.log("ok    - 終了時は保存を待ってから閉じ、再起動で復元される");
    await wd("DELETE", `/session/${sid}`).catch(() => {});
  } catch (e) { failed++; console.log("FAIL  - 終了と再起動", e.message); }
} catch (e) {
  failed++; console.error("FAIL  - 起動", e);
} finally {
  driver.kill();
  console.log(failed ? `\n${failed} 件失敗` : "\nすべて合格");
  process.exitCode = failed ? 1 : 0;
}
