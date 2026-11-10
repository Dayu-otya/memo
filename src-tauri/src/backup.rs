//! バックアップ(main.js の backup:checkpoint / manual / listAuto / restoreAuto / restoreFromFile)。

use crate::datastore::{json_number_f64, mtime_ms, DataStore};
use crate::dialogs::{DialogOptions, Dialogs, Filter};
use crate::storage::{basename, parse_json, read_utf8_lossy, to_pretty_json, validate_notes};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

/// String(e) と同じく、例外の種類を頭に付けた文言にする。
pub fn err_string(e: impl std::fmt::Display) -> String {
    let s = e.to_string();
    if s.starts_with("SyntaxError: ") || s.starts_with("Error: ") || s.starts_with("TypeError: ") {
        s
    } else {
        format!("Error: {s}")
    }
}

fn read_validated(file: &Path) -> Result<Value, String> {
    let raw = read_utf8_lossy(file).map_err(err_string)?;
    let notes = parse_json(&raw)?;
    validate_notes(&notes).map_err(err_string)?;
    Ok(notes)
}

impl DataStore {
    pub fn backup_checkpoint(&self) -> bool {
        match self.read_notes() {
            Ok(n) => self.write_auto_backup(&n),
            Err(_) => false,
        }
    }

    pub fn backup_list_auto(&self) -> Value {
        if !self.backup_dir().exists() {
            return json!([]);
        }
        let r = (|| -> std::io::Result<Value> {
            let mut files = self.auto_backup_files()?;
            files.reverse();
            let mut out = Vec::new();
            for f in files {
                let p = self.backup_dir().join(&f);
                let meta = fs::metadata(&p)?;
                let count = read_utf8_lossy(&p)
                    .ok()
                    .and_then(|raw| parse_json(&raw).ok())
                    .and_then(|v| v.as_array().map(|a| a.len()))
                    .map(Value::from)
                    .unwrap_or(Value::Null);
                out.push(json!({ "fileName": f, "mtime": json_number_f64(mtime_ms(&meta)), "noteCount": count }));
            }
            Ok(Value::Array(out))
        })();
        r.unwrap_or_else(|e| {
            eprintln!("自動バックアップ一覧の取得に失敗しました: {e}");
            json!([])
        })
    }

    pub fn backup_restore_auto(&self, file_name: &Value) -> Value {
        let Some(name) = file_name.as_str() else {
            return json!({ "ok": false, "error": "TypeError [ERR_INVALID_ARG_TYPE]: The \"path\" argument must be of type string." });
        };
        let target = self.backup_dir().join(basename(name));
        if !target.exists() {
            return json!({ "ok": false, "error": "指定されたバックアップが見つかりません。" });
        }
        match read_validated(&target) {
            Ok(notes) => json!({ "ok": true, "notes": notes }),
            Err(e) => {
                eprintln!("自動バックアップの復元に失敗しました: {e}");
                json!({ "ok": false, "error": e })
            }
        }
    }

    pub fn backup_restore_from_file(&self, dialogs: &dyn Dialogs) -> Value {
        let picked = dialogs.pick_file(DialogOptions {
            title: "復元するバックアップファイルを選択".into(),
            default_file_name: None,
            filters: vec![Filter::new("メモのバックアップ(JSON)", &["json"])],
        });
        let Some(path) = picked else { return json!({ "ok": false, "canceled": true }) };
        match read_validated(&path) {
            Ok(notes) => json!({ "ok": true, "notes": notes, "filePath": path.to_string_lossy() }),
            Err(e) => {
                eprintln!("ファイルからの復元に失敗しました: {e}");
                json!({ "ok": false, "error": e })
            }
        }
    }

    /// 現行版と同じく、メモを読めないときは例外(呼び出し側で拒否)にする。
    pub fn backup_manual(&self, dialogs: &dyn Dialogs) -> Result<Value, String> {
        let notes = self.read_notes()?;
        let date = &crate::datastore::iso_now()[..10];
        let picked = dialogs.save_file(DialogOptions {
            title: "メモのバックアップを保存".into(),
            default_file_name: Some(format!("notes-backup-{date}.json")),
            filters: vec![Filter::new("JSONファイル", &["json"])],
        });
        let Some(path) = picked else { return Ok(json!({ "ok": false, "canceled": true })) };
        Ok(match fs::write(&path, to_pretty_json(&notes)) {
            Ok(()) => json!({ "ok": true, "filePath": path.to_string_lossy() }),
            Err(e) => {
                eprintln!("手動バックアップに失敗しました: {e}");
                json!({ "ok": false, "error": err_string(e) })
            }
        })
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::Mutex;

    #[derive(Default)]
    pub struct MockDialogs {
        pub open: Mutex<Option<Vec<PathBuf>>>,
        pub save: Mutex<Option<PathBuf>>,
        pub last: Mutex<Option<DialogOptions>>,
    }
    impl Dialogs for MockDialogs {
        fn pick_file(&self, o: DialogOptions) -> Option<PathBuf> {
            *self.last.lock().unwrap() = Some(o);
            self.open.lock().unwrap().clone().and_then(|v| v.into_iter().next())
        }
        fn pick_files(&self, o: DialogOptions) -> Option<Vec<PathBuf>> {
            *self.last.lock().unwrap() = Some(o);
            self.open.lock().unwrap().clone()
        }
        fn pick_folder(&self, o: DialogOptions) -> Option<PathBuf> {
            self.pick_file(o)
        }
        fn save_file(&self, o: DialogOptions) -> Option<PathBuf> {
            *self.last.lock().unwrap() = Some(o);
            self.save.lock().unwrap().clone()
        }
    }

    fn note(body: &str) -> Value {
        json!({"id":"n1","body":body,"tags":[],"createdAt":1,"updatedAt":1})
    }

    #[test]
    fn backup_generations_bounded_at_ten_even_when_saved_rapidly() {
        let d = tempfile::tempdir().unwrap();
        let s = DataStore::new(d.path());
        for i in 0..15 {
            s.notes_save(&json!([note(&i.to_string())]));
        }
        let list = s.backup_list_auto();
        assert_eq!(list.as_array().unwrap().len(), 10);
        assert_eq!(list[0]["noteCount"], 1);
        // 新しい順
        let names: Vec<_> = list.as_array().unwrap().iter().map(|x| x["fileName"].as_str().unwrap().to_string()).collect();
        let mut sorted = names.clone();
        sorted.sort();
        sorted.reverse();
        assert_eq!(names, sorted);
        assert!(names[0].starts_with("notes-") && names[0].len() == "notes-2026-11-09T16-21-03-532Z-393013ac.json".len());
    }

    #[test]
    fn backup_restoration_validates_individual_records() {
        let d = tempfile::tempdir().unwrap();
        let s = DataStore::new(d.path());
        fs::create_dir_all(s.backup_dir()).unwrap();
        fs::write(s.backup_dir().join("notes-bad.json"), "[null]").unwrap();
        assert_eq!(s.backup_restore_auto(&json!("notes-bad.json"))["ok"], false);
        assert_eq!(s.backup_restore_auto(&json!("missing.json"))["error"], "指定されたバックアップが見つかりません。");
        assert_eq!(s.backup_restore_auto(&json!(5))["ok"], false);
        fs::write(s.backup_dir().join("notes-good.json"), "[{\"id\":\"a\",\"body\":\"x\"}]").unwrap();
        // パスの区切りを含めても backups の外は読まない
        assert_eq!(s.backup_restore_auto(&json!("..\\backups\\notes-good.json"))["notes"][0]["body"], "x");
    }

    #[test]
    fn checkpoint_fails_on_corrupt_notes() {
        let d = tempfile::tempdir().unwrap();
        let s = DataStore::new(d.path());
        assert!(s.backup_checkpoint());
        fs::write(s.notes_file(), "{bad").unwrap();
        assert!(!s.backup_checkpoint());
    }

    #[test]
    fn manual_backup_and_restore_from_file_and_cancel() {
        let d = tempfile::tempdir().unwrap();
        let s = DataStore::new(d.path());
        s.notes_save(&json!([note("手動")]));
        let m = MockDialogs::default();
        assert_eq!(s.backup_manual(&m).unwrap()["canceled"], true);
        let opts = m.last.lock().unwrap().clone().unwrap();
        assert!(opts.default_file_name.unwrap().starts_with("notes-backup-20"));
        let out = d.path().join("manual.json");
        *m.save.lock().unwrap() = Some(out.clone());
        assert_eq!(s.backup_manual(&m).unwrap()["ok"], true);
        assert_eq!(s.backup_restore_from_file(&m)["canceled"], true);
        *m.open.lock().unwrap() = Some(vec![out.clone()]);
        let r = s.backup_restore_from_file(&m);
        assert_eq!(r["notes"][0]["body"], "手動");
        assert_eq!(r["filePath"], out.to_string_lossy().as_ref());
        fs::write(&out, "[null]").unwrap();
        assert_eq!(s.backup_restore_from_file(&m)["ok"], false);
        fs::write(s.notes_file(), "{bad").unwrap();
        assert!(s.backup_manual(&m).is_err());
    }
}
