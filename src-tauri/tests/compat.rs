//! 固定データ試験と実データ互換試験(移植計画書 第5節)。
//! fixtures/ は現行 Electron 版の main.js・storage.js をそのまま動かして作ったもの
//! (legacy-electron/tools/make-fixtures.js)。

use memo_app_lib::crypto::{self, Payload};
use memo_app_lib::datastore::DataStore;
use memo_app_lib::storage::validate_notes;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures")
}

fn b64(s: &str) -> Vec<u8> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(s).unwrap()
}

#[test]
fn ciphertext_is_byte_identical_to_legacy_and_decryptable() {
    let v: Value = serde_json::from_str(&fs::read_to_string(fixtures().join("crypto-vectors.json")).unwrap()).unwrap();
    let vectors = v["vectors"].as_array().unwrap();
    assert!(vectors.len() >= 6);
    for t in vectors {
        let name = t["name"].as_str().unwrap();
        let password = t["password"].as_str().unwrap();
        let text = t["text"].as_str().unwrap();
        let expected: Payload = serde_json::from_value(t["payload"].clone()).unwrap();
        // 同じパスワード・salt・iv で、現行版と1バイトも違わない暗号文になる
        let mine = crypto::encrypt_with(text, password, &b64(t["salt"].as_str().unwrap()), &b64(t["iv"].as_str().unwrap()));
        assert_eq!(mine, expected, "暗号文が一致しない: {name}");
        // 現行版の暗号文を復号できる
        assert_eq!(crypto::decrypt_text(&expected, password).unwrap(), text, "復号できない: {name}");
        // 誤パスワードと改ざんを拒否する
        assert!(crypto::decrypt_text(&expected, &format!("{password}x")).is_err(), "誤パスワードを受け入れた: {name}");
        let mut tag = b64(&expected.auth_tag);
        tag[0] ^= 1;
        use base64::Engine;
        let tampered = Payload { auth_tag: base64::engine::general_purpose::STANDARD.encode(tag), ..expected.clone() };
        assert!(crypto::decrypt_text(&tampered, password).is_err(), "改ざんを受け入れた: {name}");
        // パスワード確認値も同じになり、現行版の値で確認できる
        let stored = t["stored"].as_str().unwrap();
        assert_eq!(crypto::hash_password_with(password, &b64(t["hashSalt"].as_str().unwrap())), stored, "確認値が一致しない: {name}");
        assert!(crypto::verify_password(password, stored));
        assert!(!crypto::verify_password(&format!("{password}x"), stored));
    }
}

#[test]
fn legacy_locked_note_in_real_data_decrypts() {
    let secret: Value = serde_json::from_str(&fs::read_to_string(fixtures().join("locked-note-secret.json")).unwrap()).unwrap();
    let store = DataStore::new(fixtures().join("userdata"));
    let notes = store.read_notes().unwrap();
    let locked = notes.as_array().unwrap().iter().find(|n| n["id"] == secret["id"]).unwrap();
    let pw = secret["password"].as_str().unwrap();
    assert!(crypto::verify_password(pw, locked["passwordHash"].as_str().unwrap()));
    let payload: Payload = serde_json::from_value(locked["encrypted"].clone()).unwrap();
    assert_eq!(crypto::decrypt_text(&payload, pw).unwrap(), secret["text"].as_str().unwrap());
}

fn copy_dir(from: &std::path::Path, to: &std::path::Path) {
    fs::create_dir_all(to).unwrap();
    for e in fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let p = e.path();
        if p.is_dir() {
            copy_dir(&p, &to.join(e.file_name()));
        } else {
            fs::copy(&p, to.join(e.file_name())).unwrap();
        }
    }
}

#[test]
fn real_data_load_save_reload_keeps_unknown_fields_order_and_format() {
    let d = tempfile::tempdir().unwrap();
    copy_dir(&fixtures().join("userdata"), d.path());
    let original = fs::read_to_string(d.path().join("notes.json")).unwrap();
    let store = DataStore::new(d.path());

    let loaded = store.notes_load().unwrap();
    assert!(store.notes_save(&loaded));
    let rewritten = fs::read_to_string(d.path().join("notes.json")).unwrap();
    let reloaded = store.notes_load().unwrap();

    // 内容(未知の項目・文字・数値)は完全に同じ
    let orig_v: Value = serde_json::from_str(&original).unwrap();
    assert_eq!(reloaded, orig_v);
    assert_eq!(loaded["pinned"], orig_v["pinned"]);
    // キー順も同じ
    let keys = |v: &Value| v[0].as_object().unwrap().keys().cloned().collect::<Vec<_>>();
    assert_eq!(keys(&reloaded), keys(&orig_v));
    assert_eq!(reloaded[0]["zUnknownField"]["nested"][1], 2.5);

    // 書式(2字下げ、指数表記 1e+21、2^53 を超える整数を含む)まで1バイトも変わらない
    assert!(original.contains("\"numberLike\": 1e+21"));
    assert_eq!(rewritten, original, "保存し直すと書式が変わった");

    // 設定も同じ
    let settings_orig = fs::read_to_string(d.path().join("settings.json")).unwrap();
    let s = store.settings_load().unwrap();
    assert!(store.settings_save(&s));
    assert_eq!(fs::read_to_string(d.path().join("settings.json")).unwrap(), settings_orig);

    // 現行版のバックアップを一覧・復元できる
    let list = store.backup_list_auto();
    let first = list[0]["fileName"].as_str().unwrap().to_string();
    let restored = store.backup_restore_auto(&Value::String(first));
    assert_eq!(restored["ok"], true);
    assert!(validate_notes(&restored["notes"]).is_ok());
}

#[test]
fn expired_trash_in_legacy_file_is_purged_on_load() {
    let d = tempfile::tempdir().unwrap();
    fs::copy(fixtures().join("notes-with-expired-trash.json"), d.path().join("notes.json")).unwrap();
    let store = DataStore::new(d.path());
    let loaded = store.notes_load().unwrap();
    assert_eq!(loaded.as_array().unwrap().len(), 1);
    assert_eq!(loaded[0]["id"], "keep");
}
