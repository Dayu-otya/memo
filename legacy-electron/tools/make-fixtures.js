// 現行(Electron)版の main.js と storage.js をそのまま動かして、移植先の互換試験に使う固定データを作る。
// 乱数だけを決まった値に差し替えるため、暗号文は現行版の実装が出す結果そのものになる。
// 使い方: node legacy-electron/tools/make-fixtures.js <出力先フォルダー>
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const realCrypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const root = path.resolve(__dirname, '..');
const outDir = path.resolve(process.argv[2] || path.join(root, '..', 'fixtures'));

function harness(dataDir, randomQueue) {
  const handlers = new Map();
  const app = new EventEmitter();
  Object.assign(app, { getPath: () => dataDir, getVersion: () => '1.0.6', requestSingleInstanceLock: () => true,
    whenReady: () => ({ then() {} }), quit() {}, isPackaged: false });
  class BrowserWindow extends EventEmitter {}
  const electron = { app, BrowserWindow, ipcMain: { handle: (n, f) => handlers.set(n, f) },
    dialog: {}, nativeTheme: { shouldUseDarkColors: false }, shell: {} };
  const crypto = Object.assign({}, realCrypto, {
    randomBytes(n) {
      if (randomQueue.length === 0) return realCrypto.randomBytes(n);
      const b = randomQueue.shift();
      if (b.length !== n) throw new Error(`fixed random length mismatch: want ${n}, got ${b.length}`);
      return Buffer.from(b);
    },
  });
  const req = (name) => name === 'electron' ? electron : name === './storage' ? require(path.join(root, 'storage.js'))
    : name === 'crypto' ? crypto : require(name);
  const ctx = vm.createContext({ require: req, __dirname: root, console: { log() {}, error() {} }, process, Buffer,
    setTimeout() {}, setImmediate, URL, TextDecoder });
  vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), ctx);
  return (name, ...args) => handlers.get(name)({}, ...args);
}

const bytes = (seed, n) => Buffer.from(Array.from({ length: n }, (_, i) => (seed * 31 + i * 7) & 0xff));

// 1. 暗号の固定ベクトル
const cases = [
  ['ascii', 'pw', 'secret'],
  ['japanese', 'パスワード', '秘密\n本文\n\n終端\n'],
  ['emoji', 'p😀w', '絵文字🙂と改行\r\nを含む'],
  ['empty-text', 'pw', ''],
  ['empty-password', '', 'パスワードなし'],
  ['long', 'x'.repeat(300), '長文'.repeat(5000)],
];
const vectors = cases.map(([name, password, text], i) => {
  const salt = bytes(i + 1, 16); const iv = bytes(i + 101, 12);
  const call = harness(os.tmpdir(), [salt, iv]);
  const payload = call('crypto:encrypt', { text, password });
  const hashSalt = bytes(i + 201, 16);
  const callH = harness(os.tmpdir(), [hashSalt]);
  const stored = callH('crypto:hashPassword', password);
  if (call('crypto:decrypt', { payload, password }).text !== text) throw new Error('self check failed');
  return { name, password, text, salt: salt.toString('base64'), iv: iv.toString('base64'), payload,
    hashSalt: hashSalt.toString('base64'), stored };
});
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'crypto-vectors.json'), JSON.stringify({ generator: 'legacy-electron/main.js 1.0.6', vectors }, null, 2));

// 2. 実データ相当の基準データ(現行版の保存処理で作る)
const dataDir = path.join(outDir, 'userdata');
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });
const call = harness(dataDir, []);
const lockedText = 'ロック済みの本文\n二行目';
const enc = call('crypto:encrypt', { text: lockedText, password: 'lockpw' });
const now = Date.now();
const notes = [
  { id: 'n-plain', body: '普通のメモ\n本文です。\n', tags: ['仕事', 'メモ'], createdAt: 1700000000000, updatedAt: 1700000500000,
    pinned: true, folderId: 'f-1', color: 'blue', markdownPreview: false, zUnknownField: { nested: [1, 2.5, 'x'], flag: null } },
  { id: 'n-locked', body: '', tags: [], createdAt: 1700000000001, updatedAt: 1700000000002, locked: true,
    passwordHash: call('crypto:hashPassword', 'lockpw'), encrypted: enc, title: '秘密' },
  { id: 'n-trash-recent', body: '最近ごみ箱へ', trashedAt: now - 1000, createdAt: 1, updatedAt: 2 },
  { id: 'n-math', body: '数式\n$$\\int_0^1 x^2 dx = \\frac{1}{3}$$\nインライン $a^2+b^2=c^2$\n```js\nconsole.log("code")\n```',
    markdownPreview: true, createdAt: 3, updatedAt: 4, numberLike: 1e21, big: 12345678901234567, neg: -0.5 },
  { id: 'n-long', body: '長文\n' + 'あいうえお'.repeat(4000), createdAt: 5, updatedAt: 6 },
];
if (call('notes:save', notes) !== true) throw new Error('save failed');
call('settings:save', { theme: 'dark', fontSize: 18, folders: [{ id: 'f-1', name: '私用', extra: true }], zKey: 'keep' });
// 期限切れのごみ箱を含む別ファイル(読込時の削除の確認用)
fs.writeFileSync(path.join(outDir, 'notes-with-expired-trash.json'), JSON.stringify([
  { id: 'keep', body: 'a' }, { id: 'old', body: 'b', trashedAt: 1 }], null, 2));
fs.writeFileSync(path.join(outDir, 'locked-note-secret.json'), JSON.stringify({ id: 'n-locked', password: 'lockpw', text: lockedText }, null, 2));
console.log('fixtures written to', outDir, 'vectors:', vectors.length);
