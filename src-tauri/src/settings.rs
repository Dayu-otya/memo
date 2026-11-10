//! 設定(main.js の settings:load / settings:save)。

use crate::datastore::DataStore;
use crate::storage::{atomic_write, js_truthy, parse_json, read_utf8_lossy, to_pretty_json};
use serde_json::{json, Value};
use std::fs;

pub const ERR_READ_SETTINGS: &str = "設定ファイルを読み込めません。元の設定を保護するため起動を中止しました。";

fn validate_settings(v: &Value) -> Result<(), String> {
    let obj = v.as_object().ok_or("設定の形式が不正です。")?;
    if let Some(folders) = obj.get("folders") {
        let ok = match folders {
            Value::Array(list) => list.iter().all(|f| {
                js_truthy(Some(f)) && matches!(f.get("id"), Some(Value::String(_))) && matches!(f.get("name"), Some(Value::String(_)))
            }),
            _ => false,
        };
        if !ok {
            return Err("フォルダ設定の形式が不正です。".into());
        }
    }
    Ok(())
}

impl DataStore {
    pub fn settings_load(&self) -> Result<Value, String> {
        let file = self.settings_file();
        let r = (|| -> Result<Value, String> {
            if !file.exists() {
                return Ok(json!({}));
            }
            let v = parse_json(&read_utf8_lossy(&file).map_err(|e| e.to_string())?)?;
            validate_settings(&v)?;
            Ok(v)
        })();
        r.map_err(|e| {
            eprintln!("設定の読み込みに失敗しました: {e}");
            ERR_READ_SETTINGS.to_string()
        })
    }

    pub fn settings_save(&self, settings: &Value) -> bool {
        let r = (|| -> std::io::Result<()> {
            fs::create_dir_all(self.dir())?;
            atomic_write(&self.settings_file(), &to_pretty_json(settings))
        })();
        if let Err(e) = &r {
            eprintln!("設定の保存に失敗しました: {e}");
        }
        r.is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrupt_settings_cannot_silently_reset_folder_definitions() {
        let d = tempfile::tempdir().unwrap();
        let s = DataStore::new(d.path());
        fs::write(s.settings_file(), "{broken").unwrap();
        assert_eq!(s.settings_load().unwrap_err(), ERR_READ_SETTINGS);
        assert_eq!(fs::read_to_string(s.settings_file()).unwrap(), "{broken");
    }

    #[test]
    fn malformed_folder_settings_are_rejected_before_rendering() {
        let d = tempfile::tempdir().unwrap();
        let s = DataStore::new(d.path());
        fs::write(s.settings_file(), serde_json::to_string(&json!({"folders":[null]})).unwrap()).unwrap();
        assert!(s.settings_load().is_err());
        fs::write(s.settings_file(), "[]").unwrap();
        assert!(s.settings_load().is_err());
    }

    #[test]
    fn settings_roundtrip_keeps_unknown_keys_and_order() {
        let d = tempfile::tempdir().unwrap();
        let s = DataStore::new(d.path().join("new"));
        assert_eq!(s.settings_load().unwrap(), json!({}));
        let v: Value = serde_json::from_str(r#"{"zeta":1,"theme":"dark","folders":[{"id":"f","name":"私用","x":true}]}"#).unwrap();
        assert!(s.settings_save(&v));
        let text = fs::read_to_string(s.settings_file()).unwrap();
        assert!(text.find("zeta").unwrap() < text.find("theme").unwrap());
        assert_eq!(s.settings_load().unwrap(), v);
    }
}
