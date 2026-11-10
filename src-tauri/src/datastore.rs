//! 保存先の配置と、保存状態(最終保存時刻)を持つ。
//! 保存先は現行Electron版と同じ %APPDATA%\memo-app を使い、データを移動しない。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Electron は app.getPath("userData") を「%APPDATA%\<package.json の name>」とする。
/// 現行の package.json(app.asar 内も同じ)は name が memo-app で、最上位の productName が無い。
pub const LEGACY_APP_DIR_NAME: &str = "memo-app";

pub const TRASH_RETENTION_DAYS: i64 = 30;
pub const AUTO_BACKUP_MAX_GENERATIONS: usize = 10;

pub struct DataStore {
    pub data_dir: PathBuf,
    pub last_saved_at: Mutex<Option<i64>>,
}

impl DataStore {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        Self { data_dir: data_dir.into(), last_saved_at: Mutex::new(None) }
    }

    /// 現行版と同じ保存先(Windowsでは %APPDATA%\memo-app)。
    pub fn legacy_location() -> Option<PathBuf> {
        #[cfg(windows)]
        {
            std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join(LEGACY_APP_DIR_NAME))
        }
        #[cfg(target_os = "macos")]
        {
            std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support").join(LEGACY_APP_DIR_NAME))
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
                .map(|p| p.join(LEGACY_APP_DIR_NAME))
        }
    }

    pub fn notes_file(&self) -> PathBuf {
        self.data_dir.join("notes.json")
    }
    pub fn settings_file(&self) -> PathBuf {
        self.data_dir.join("settings.json")
    }
    pub fn autosave_file(&self) -> PathBuf {
        self.data_dir.join("autosave.json")
    }
    pub fn backup_dir(&self) -> PathBuf {
        self.data_dir.join("backups")
    }
    pub fn dir(&self) -> &Path {
        &self.data_dir
    }

    /// 移行前バックアップ。Tauri 版が初めて起動したとき、何かを書き換える前に、
    /// 現行版が作った notes.json と settings.json を backups の外へ複製する(世代の上限による削除の対象外)。
    /// 一度作ったら上書きしない。作れたファイル名を返す。
    pub fn ensure_migration_backup(&self) -> std::io::Result<Vec<PathBuf>> {
        let mut made = Vec::new();
        for (src, dst) in [
            (self.notes_file(), self.data_dir.join(MIGRATION_NOTES_COPY)),
            (self.settings_file(), self.data_dir.join(MIGRATION_SETTINGS_COPY)),
        ] {
            if src.exists() && !dst.exists() {
                std::fs::copy(&src, &dst)?;
                made.push(dst);
            }
        }
        Ok(made)
    }
}

pub const MIGRATION_NOTES_COPY: &str = "notes.before-tauri-2.0.0.json";
pub const MIGRATION_SETTINGS_COPY: &str = "settings.before-tauri-2.0.0.json";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_backup_is_made_once_and_never_overwritten() {
        let d = tempfile::tempdir().unwrap();
        let s = DataStore::new(d.path());
        assert!(s.ensure_migration_backup().unwrap().is_empty());
        std::fs::write(s.notes_file(), "[1]").unwrap();
        assert_eq!(s.ensure_migration_backup().unwrap().len(), 1);
        std::fs::write(s.notes_file(), "[2]").unwrap();
        assert!(s.ensure_migration_backup().unwrap().is_empty());
        assert_eq!(std::fs::read_to_string(d.path().join(MIGRATION_NOTES_COPY)).unwrap(), "[1]");
    }

    #[test]
    fn iso_stamp_matches_javascript_format() {
        let s = iso_now();
        assert_eq!(s.len(), 24);
        assert!(s.ends_with('Z') && &s[10..11] == "T" && &s[19..20] == ".");
    }
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// fs.Stats#mtimeMs と同じく、小数を含むミリ秒で返す。
pub fn mtime_ms(meta: &std::fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// new Date().toISOString() と同じ書式("2026-11-09T16:21:03.532Z")。
pub fn iso_now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

pub fn json_number_f64(v: f64) -> serde_json::Value {
    serde_json::Number::from_f64(v).map(serde_json::Value::Number).unwrap_or(serde_json::Value::Null)
}
