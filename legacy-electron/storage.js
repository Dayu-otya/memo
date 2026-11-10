const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function validateNotes(notes) {
  if (!Array.isArray(notes)) throw new Error('メモ一覧の形式が不正です。');
  const ids = new Set();
  for (const n of notes) {
    if (!n || typeof n !== 'object' || typeof n.id !== 'string' || !n.id || ids.has(n.id) || typeof n.body !== 'string') {
      throw new Error('メモのID・本文が不正、またはIDが重複しています。');
    }
    ids.add(n.id);
    if (n.tags !== undefined && (!Array.isArray(n.tags) || n.tags.some(t => typeof t !== 'string'))) throw new Error('タグの形式が不正です。');
    if (n.locked && (typeof n.passwordHash !== 'string' || !n.passwordHash)) throw new Error('ロック情報が不正です。');
    if (n.encrypted && (!n.locked || ['salt', 'iv', 'authTag', 'data'].some(k => typeof n.encrypted[k] !== 'string'))) throw new Error('暗号化データの形式が不正です。');
    for (const key of ['createdAt', 'updatedAt', 'trashedAt']) {
      if (n[key] != null && (!Number.isFinite(n[key]) || n[key] < 0)) throw new Error('日付の形式が不正です。');
    }
  }
  return notes;
}

// Write beside the destination and rename only after the complete bytes reach disk.
function atomicWrite(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, contents, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function safeFileStem(value) {
  let name = String(value || '無題のメモ').replace(/[\x00-\x1f\\/:*?"<>|]/g, '_').replace(/[. ]+$/g, '').slice(0, 80).replace(/[. ]+$/g, '');
  if (!name) name = '無題のメモ';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}

function decodeText(bytes) {
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  let text;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch (e) { throw new Error('文字コードを判定できません。UTF-8またはBOM付きUTF-16で保存してから読み込んでください。'); }
  return text.replace(/\r\n?/g, '\n');
}
module.exports = { validateNotes, atomicWrite, safeFileStem, decodeText };
