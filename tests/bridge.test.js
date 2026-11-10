// 橋渡し層(src/js/00-bridge.js)の試験。既存試験と同じ vm 方式で window.__TAURI__ を偽物に差し替え、
// 渡し口25本の名前・引数・返り値の形と、通知5種、終了時の保存の流れを確かめる(計画書 第5節)。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/js/00-bridge.js'), 'utf8');

function load({ invokeImpl, withTauri = true } = {}) {
  const calls = [];
  const listeners = new Map();
  const unlistened = [];
  const appended = [];
  let printed = 0;
  const window = {
    print() { printed++; },
  };
  if (withTauri) {
    window.__TAURI__ = {
      core: { invoke: async (cmd, args) => { calls.push([cmd, args]); return invokeImpl ? invokeImpl(cmd, args) : { cmd }; } },
      event: {
        listen: async (name, handler) => { listeners.set(name, handler); return () => unlistened.push(name); },
      },
    };
  }
  const document = { head: { appendChild: (el) => appended.push(el) }, createElement: () => ({ textContent: '' }) };
  const ctx = vm.createContext({ window, document, console: { error() {}, log() {} }, Promise, Error, Object, Array, String });
  vm.runInContext(source, ctx, { filename: '00-bridge.js' });
  return { window, calls, listeners, unlistened, appended, printed: () => printed, emit: (n, p) => listeners.get(n)({ payload: p }) };
}

const tick = () => new Promise((r) => setImmediate(r));
const plain = (v) => JSON.parse(JSON.stringify(v));

test('outside Tauri the bridge defines nothing', () => {
  const b = load({ withTauri: false });
  for (const n of ['notesAPI', 'settingsAPI', 'backupAPI', 'printAPI', 'shellAPI', 'cryptoAPI', 'updateAPI']) assert.equal(b.window[n], undefined);
});

test('same seven windows and member names as preload.js (minus unused prefersDark)', () => {
  const b = load();
  const preload = fs.readFileSync(path.join(__dirname, '../legacy-electron/preload.js'), 'utf8');
  const expected = {};
  for (const m of preload.matchAll(/exposeInMainWorld\("(\w+)", \{([\s\S]*?)\n\}\);/g)) {
    expected[m[1]] = Array.from(m[2].matchAll(/^\s{2}(\w+):/gm), (x) => x[1]).filter((k) => k !== 'prefersDark');
  }
  assert.equal(Object.keys(expected).length, 7);
  let total = 0;
  for (const [name, members] of Object.entries(expected)) {
    assert.deepEqual(Object.keys(b.window[name]).sort(), members.slice().sort(), name);
    total += members.length;
  }
  assert.equal(total, 30); // 渡し口25本 + 通知5種
  assert.equal(b.window.settingsAPI.prefersDark, undefined);
});

test('each invoke-style entry maps to its Rust command with the right argument names', async () => {
  const b = load();
  const w = b.window;
  const notes = [{ id: 'n', body: 'x' }];
  const cases = [
    [() => w.notesAPI.load(), 'notes_load', {}],
    [() => w.notesAPI.save(notes), 'notes_save', { notes }],
    [() => w.notesAPI.export({ title: 't', body: 'b', format: 'txt' }), 'notes_export', { note: { title: 't', body: 'b', format: 'txt' } }],
    [() => w.notesAPI.exportAllMarkdown(notes), 'notes_export_all_markdown', { notes }],
    [() => w.notesAPI.importMarkdown(), 'notes_import_markdown', {}],
    [() => w.notesAPI.autosave(notes), 'notes_autosave', { notes }],
    [() => w.notesAPI.checkAutosave(), 'notes_check_autosave', {}],
    [() => w.notesAPI.discardAutosave(), 'notes_discard_autosave', {}],
    [() => w.notesAPI.status(), 'notes_status', {}],
    [() => w.settingsAPI.load(), 'settings_load', {}],
    [() => w.settingsAPI.save({ theme: 'dark' }), 'settings_save', { settings: { theme: 'dark' } }],
    [() => w.backupAPI.checkpoint(), 'backup_checkpoint', {}],
    [() => w.backupAPI.manual(), 'backup_manual', {}],
    [() => w.backupAPI.listAuto(), 'backup_list_auto', {}],
    [() => w.backupAPI.restoreAuto('notes-a.json'), 'backup_restore_auto', { fileName: 'notes-a.json' }],
    [() => w.backupAPI.restoreFromFile(), 'backup_restore_from_file', {}],
    [() => w.shellAPI.openExternal('https://example.com'), 'shell_open_external', { url: 'https://example.com' }],
    [() => w.cryptoAPI.encrypt('t', 'p'), 'crypto_encrypt', { text: 't', password: 'p' }],
    [() => w.cryptoAPI.decrypt({ data: 'd' }, 'p'), 'crypto_decrypt', { payload: { data: 'd' }, password: 'p' }],
    [() => w.cryptoAPI.hashPassword('p'), 'crypto_hash_password', { password: 'p' }],
    [() => w.cryptoAPI.verifyPassword('p', 's:h'), 'crypto_verify_password', { password: 'p', stored: 's:h' }],
    [() => w.updateAPI.checkNow(), 'update_check_now', {}],
    [() => w.updateAPI.installNow(), 'update_install_now', {}],
    [() => w.updateAPI.getVersion(), 'app_version', {}],
  ];
  assert.equal(cases.length + 1, 25); // + printAPI.print
  for (const [fn, cmd, args] of cases) {
    b.calls.length = 0;
    assert.deepEqual(await fn(), { cmd });
    assert.equal(b.calls.length, 1, cmd);
    assert.equal(b.calls[0][0], cmd);
    assert.deepEqual(JSON.parse(JSON.stringify(b.calls[0][1])), args, cmd);
  }
});

test('Rust rejections become Error objects with the Electron message format', async () => {
  const b = load({ invokeImpl: async () => { throw 'メモを読み込めません。'; } });
  await assert.rejects(b.window.notesAPI.load(), (e) => e instanceof Error && e.message === "Error invoking remote method 'notes:load': Error: メモを読み込めません。");
});

test('lone surrogates are replaced before sending, as Node.js did when writing UTF-8', async () => {
  const b = load();
  await b.window.notesAPI.save([{ id: 'n', body: 'a\ud83db\udc00c😀', tags: ['\udfff'], drop: undefined }]);
  assert.deepEqual(JSON.parse(JSON.stringify(b.calls[0][1].notes)), [{ id: 'n', body: 'a�b�c😀', tags: ['�'] }]);
});

test('print opens the native print UI and treats completion as success (cancel is not a failure)', async () => {
  const b = load();
  assert.deepEqual(JSON.parse(JSON.stringify(await b.window.printAPI.print())), { ok: true, canceled: false, error: '' });
  assert.equal(b.printed(), 1);
  assert.equal(b.calls.length, 0);
});

test('five update notifications keep their payload shapes and return an unsubscribe function', async () => {
  const b = load();
  const got = [];
  const offs = [
    b.window.updateAPI.onAvailable((p) => got.push(['available', p])),
    b.window.updateAPI.onNotAvailable((...a) => got.push(['not-available', a.length])),
    b.window.updateAPI.onProgress((p) => got.push(['progress', p])),
    b.window.updateAPI.onDownloaded((p) => got.push(['downloaded', p])),
    b.window.updateAPI.onError((p) => got.push(['error', p])),
  ];
  for (const off of offs) assert.equal(typeof off, 'function');
  await tick();
  b.emit('update:available', { version: '2.0.1' });
  b.emit('update:not-available', null);
  b.emit('update:progress', { percent: 42 });
  b.emit('update:downloaded', { version: '2.0.1' });
  b.emit('update:error', { message: 'x' });
  assert.deepEqual(JSON.parse(JSON.stringify(got)), [['available', { version: '2.0.1' }], ['not-available', 0], ['progress', { percent: 42 }], ['downloaded', { version: '2.0.1' }], ['error', { message: 'x' }]]);
  offs[2]();
  assert.ok(b.unlistened.includes('update:progress'));
});

test('unsubscribing before listen resolves still detaches', async () => {
  const b = load();
  const off = b.window.updateAPI.onProgress(() => {});
  off();
  await tick();
  assert.ok(b.unlistened.includes('update:progress'));
});

test('close request waits for flushBeforeClose and reports the result with its generation', async () => {
  const b = load({ invokeImpl: async () => null });
  let release;
  b.window.flushBeforeClose = () => new Promise((r) => { release = r; });
  await tick();
  b.emit('app:flush-before-close', 7);
  await tick();
  assert.equal(b.calls.length, 0); // まだ保存中
  release(true);
  await tick(); await tick();
  assert.deepEqual(plain(b.calls.at(-1)), ['app_close_after_flush', { generation: 7, ok: true }]);
  b.window.flushBeforeClose = async () => { throw new Error('disk full'); };
  b.emit('app:flush-before-close', 8);
  await tick(); await tick(); await tick();
  assert.deepEqual(plain(b.calls.at(-1)), ['app_close_after_flush', { generation: 8, ok: false }]);
  delete b.window.flushBeforeClose;
  b.emit('app:flush-before-close', 9);
  await tick(); await tick(); await tick();
  assert.deepEqual(plain(b.calls.at(-1)), ['app_close_after_flush', { generation: 9, ok: false }]);
});

test('print styles keep backgrounds like printBackground: true', () => {
  const b = load();
  assert.match(b.appended[0].textContent, /print-color-adjust: exact/);
});

test('index.html loads the bridge first and no longer carries a CSP that blocks IPC', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  const scripts = Array.from(html.matchAll(/<script src="([^"]+)"/g), (m) => m[1]);
  assert.equal(scripts[0], 'js/00-bridge.js');
  assert.equal(scripts[1], 'js/01-core-state.js');
  assert.doesNotMatch(html, /http-equiv="Content-Security-Policy"/);
  const conf = JSON.parse(fs.readFileSync(path.join(__dirname, '../src-tauri/tauri.conf.json'), 'utf8'));
  assert.match(conf.app.security.csp, /connect-src ipc: http:\/\/ipc\.localhost/);
  assert.equal(conf.app.withGlobalTauri, true);
});
