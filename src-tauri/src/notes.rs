//! 保存・読込(main.js の notes:load / save / status / autosave / checkAutosave / discardAutosave)。

use crate::datastore::{json_number_f64, mtime_ms, now_ms, DataStore, AUTO_BACKUP_MAX_GENERATIONS, TRASH_RETENTION_DAYS};
use crate::storage::{atomic_write, parse_json, random_hex, read_utf8_lossy, to_pretty_json, validate_notes};
use serde_json::{json, Value};
use std::fs;

pub const ERR_READ_NOTES: &str = "メモを読み込めません。元のデータを保護するため編集を開始しません。バックアップからの復旧が必要です。";

impl DataStore {
    pub fn read_notes(&self) -> Result<Value, String> {
        let file = self.notes_file();
        let inner = || -> Result<Value, String> {
            if !file.exists() {
                return Ok(json!([]));
            }
            let raw = read_utf8_lossy(&file).map_err(|e| e.to_string())?;
            let v = parse_json(&raw)?;
            validate_notes(&v)?;
            Ok(v)
        };
        inner().map_err(|e| {
            eprintln!("メモの読み込みに失敗しました: {e}");
            ERR_READ_NOTES.to_string()
        })
    }

    pub fn write_notes(&self, notes: &Value) -> bool {
        let r = (|| -> Result<(), String> {
            fs::create_dir_all(self.dir()).map_err(|e| e.to_string())?;
            validate_notes(notes)?;
            atomic_write(&self.notes_file(), &to_pretty_json(notes)).map_err(|e| e.to_string())
        })();
        if let Err(e) = &r {
            eprintln!("メモの保存に失敗しました: {e}");
        }
        r.is_ok()
    }

    pub fn purge_expired_trash(notes: &Value, now: i64) -> Value {
        let limit = (TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000) as f64;
        let list = notes.as_array().cloned().unwrap_or_default();
        Value::Array(
            list.into_iter()
                .filter(|n| {
                    let t = n.get("trashedAt");
                    if !crate::storage::js_truthy(t) {
                        return true;
                    }
                    let t = t.and_then(|x| x.as_f64()).unwrap_or(f64::NAN);
                    (now as f64) - t < limit
                })
                .collect(),
        )
    }

    pub(crate) fn auto_backup_files(&self) -> std::io::Result<Vec<String>> {
        let mut files: Vec<String> = fs::read_dir(self.backup_dir())?
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|f| f.starts_with("notes-") && f.ends_with(".json"))
            .collect();
        files.sort();
        Ok(files)
    }

    pub fn write_auto_backup(&self, notes: &Value) -> bool {
        let r = (|| -> std::io::Result<()> {
            let dir = self.backup_dir();
            fs::create_dir_all(&dir)?;
            let stamp = crate::datastore::iso_now().replace([':', '.'], "-");
            let file = dir.join(format!("notes-{stamp}-{}.json", random_hex(4)));
            fs::write(&file, to_pretty_json(notes))?;
            let mut files = self.auto_backup_files()?;
            while files.len() > AUTO_BACKUP_MAX_GENERATIONS {
                let oldest = files.remove(0);
                fs::remove_file(dir.join(oldest))?;
            }
            Ok(())
        })();
        if let Err(e) = &r {
            eprintln!("自動バックアップに失敗しました: {e}");
        }
        r.is_ok()
    }

    fn clear_autosave(&self) {
        let f = self.autosave_file();
        if f.exists() {
            if let Err(e) = fs::remove_file(&f) {
                eprintln!("autosaveの削除に失敗しました: {e}");
            }
        }
    }

    // ---- 渡し口 ----

    pub fn notes_load(&self) -> Result<Value, String> {
        let notes = self.read_notes()?;
        let cleaned = Self::purge_expired_trash(&notes, now_ms());
        if cleaned.as_array().map(|a| a.len()) != notes.as_array().map(|a| a.len()) {
            self.write_notes(&cleaned);
        }
        Ok(cleaned)
    }

    pub fn notes_save(&self, notes: &Value) -> bool {
        let ok = self.write_notes(notes);
        if ok {
            self.write_auto_backup(notes);
            self.clear_autosave();
            *self.last_saved_at.lock().unwrap() = Some(now_ms());
        }
        ok
    }

    pub fn notes_status(&self) -> Value {
        let mut last_auto: Value = Value::Null;
        if self.backup_dir().exists() {
            match self.auto_backup_files() {
                Ok(files) => {
                    if let Some(last) = files.last() {
                        match fs::metadata(self.backup_dir().join(last)) {
                            Ok(m) => last_auto = json_number_f64(mtime_ms(&m)),
                            Err(e) => eprintln!("自動バックアップ状態の取得に失敗しました: {e}"),
                        }
                    }
                }
                Err(e) => eprintln!("自動バックアップ状態の取得に失敗しました: {e}"),
            }
        }
        let saved = *self.last_saved_at.lock().unwrap();
        json!({ "lastSavedAt": saved, "lastAutoBackupAt": last_auto })
    }

    pub fn notes_autosave(&self, notes: &Value) -> bool {
        let r = (|| -> Result<(), String> {
            validate_notes(notes)?;
            let doc = json!({ "savedAt": now_ms(), "notes": notes });
            atomic_write(&self.autosave_file(), &to_pretty_json(&doc)).map_err(|e| e.to_string())
        })();
        if let Err(e) = &r {
            eprintln!("autosaveに失敗しました: {e}");
        }
        r.is_ok()
    }

    pub fn notes_check_autosave(&self) -> Value {
        let f = self.autosave_file();
        if !f.exists() {
            return Value::Null;
        }
        let r = (|| -> Result<Value, String> {
            let raw = read_utf8_lossy(&f).map_err(|e| e.to_string())?;
            let draft = parse_json(&raw)?;
            // draft.notes が無い(undefined)場合も現行版では検証で例外になる。
            let notes = draft.get("notes").cloned().unwrap_or(Value::Null);
            validate_notes(&notes)?;
            Ok(draft)
        })();
        match r {
            Ok(d) => d,
            Err(e) => {
                eprintln!("autosaveの読み込みに失敗しました: {e}");
                Value::Null
            }
        }
    }

    pub fn notes_discard_autosave(&self) -> bool {
        self.clear_autosave();
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn store() -> (tempfile::TempDir, DataStore) {
        let d = tempfile::tempdir().unwrap();
        let s = DataStore::new(d.path().join("data"));
        (d, s)
    }
    fn note(body: &str) -> Value {
        json!({"id":"n1","body":body,"tags":[],"createdAt":1,"updatedAt":1})
    }

    #[test]
    fn corrupt_notes_cannot_be_silently_loaded_as_an_empty_list() {
        let (_d, s) = store();
        fs::create_dir_all(s.dir()).unwrap();
        fs::write(s.notes_file(), "{bad").unwrap();
        assert_eq!(s.notes_load().unwrap_err(), ERR_READ_NOTES);
        assert_eq!(fs::read_to_string(s.notes_file()).unwrap(), "{bad");
    }

    #[test]
    fn missing_file_is_empty_list() {
        let (_d, s) = store();
        assert_eq!(s.notes_load().unwrap(), json!([]));
    }

    #[test]
    fn normal_save_roundtrip_and_invalid_save_does_not_replace_original() {
        let (_d, s) = store();
        assert!(s.notes_save(&json!([note("本文")])));
        assert!(!s.notes_save(&json!([null])));
        assert_eq!(s.notes_load().unwrap()[0]["body"], "本文");
    }

    #[test]
    fn expired_trash_is_purged_active_recent_trash_kept() {
        let (_d, s) = store();
        let mut old = note("本文");
        old["id"] = json!("old");
        old["trashedAt"] = json!(1);
        let mut recent = note("本文");
        recent["id"] = json!("recent");
        recent["trashedAt"] = json!(now_ms());
        s.notes_save(&json!([note("本文"), old, recent]));
        let ids: Vec<_> = s.notes_load().unwrap().as_array().unwrap().iter().map(|n| n["id"].as_str().unwrap().to_string()).collect();
        assert_eq!(ids, vec!["n1", "recent"]);
        // 削除結果はファイルにも書き戻される
        let on_disk: Value = serde_json::from_str(&fs::read_to_string(s.notes_file()).unwrap()).unwrap();
        assert_eq!(on_disk.as_array().unwrap().len(), 2);
    }

    #[test]
    fn autosave_roundtrip_and_successful_save_clears_recovery_draft() {
        let (_d, s) = store();
        assert!(s.notes_autosave(&json!([note("draft")])));
        assert_eq!(s.notes_check_autosave()["notes"][0]["body"], "draft");
        s.notes_save(&json!([note("saved")]));
        assert_eq!(s.notes_check_autosave(), Value::Null);
    }

    #[test]
    fn autosave_rejects_invalid_and_discard_removes() {
        let (_d, s) = store();
        assert!(!s.notes_autosave(&json!({})));
        assert!(s.notes_autosave(&json!([note("x")])));
        assert!(s.notes_discard_autosave());
        assert_eq!(s.notes_check_autosave(), Value::Null);
        fs::write(s.autosave_file(), "{\"savedAt\":1}").unwrap();
        assert_eq!(s.notes_check_autosave(), Value::Null);
    }

    #[test]
    fn status_reports_last_save_and_backup() {
        let (_d, s) = store();
        let st = s.notes_status();
        assert!(st["lastSavedAt"].is_null() && st["lastAutoBackupAt"].is_null());
        s.notes_save(&json!([note("x")]));
        let st = s.notes_status();
        assert!(st["lastSavedAt"].is_i64() && st["lastAutoBackupAt"].is_number());
    }

    #[test]
    fn saved_file_is_two_space_pretty_json() {
        let (_d, s) = store();
        s.notes_save(&json!([{"id":"a","body":"b","z":1,"a":[]}]));
        assert_eq!(fs::read_to_string(s.notes_file()).unwrap(), "[\n  {\n    \"id\": \"a\",\n    \"body\": \"b\",\n    \"z\": 1,\n    \"a\": []\n  }\n]");
    }
}
