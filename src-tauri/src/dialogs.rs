//! ファイル選択・保存ダイアログを差し替え可能にするための窓口。
//! 本番は Tauri のダイアログ部品(lib.rs)、試験は模擬実装を使う。

use std::path::PathBuf;

#[derive(Debug, Clone, Default)]
pub struct Filter {
    pub name: String,
    pub extensions: Vec<String>,
}

impl Filter {
    pub fn new(name: &str, exts: &[&str]) -> Self {
        Self { name: name.into(), extensions: exts.iter().map(|s| s.to_string()).collect() }
    }
}

#[derive(Debug, Clone, Default)]
pub struct DialogOptions {
    pub title: String,
    pub default_file_name: Option<String>,
    pub filters: Vec<Filter>,
}

pub trait Dialogs: Send + Sync {
    /// 開くファイルを1つ選ぶ。取消は None。
    fn pick_file(&self, opts: DialogOptions) -> Option<PathBuf>;
    /// 開くファイルを複数選ぶ。取消は None。
    fn pick_files(&self, opts: DialogOptions) -> Option<Vec<PathBuf>>;
    /// フォルダーを選ぶ(新規作成も可能)。取消は None。
    fn pick_folder(&self, opts: DialogOptions) -> Option<PathBuf>;
    /// 保存先を選ぶ。取消は None。
    fn save_file(&self, opts: DialogOptions) -> Option<PathBuf>;
}
