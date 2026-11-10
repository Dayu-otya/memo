//! メモ帳 Tauri 版の組立。現行 main.js の渡し口を同じ返り値の形で Rust の命令として登録する。
//! 画面側からは src/js/00-bridge.js が、現行 preload.js と同名・同形の窓口(notesAPI など)を提供する。

pub mod backup;
pub mod crypto;
pub mod datastore;
pub mod dialogs;
pub mod export;
pub mod links;
pub mod notes;
pub mod pdf;
pub mod settings;
pub mod storage;
pub mod update;
pub mod window;

use datastore::DataStore;
use dialogs::{DialogOptions, Dialogs};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};
use tauri_plugin_opener::OpenerExt;

type Store<'a> = State<'a, Arc<DataStore>>;

/// Tauri のダイアログ部品。主窓を親にして、現行版と同じく主窓に対して開く。
struct TauriDialogs<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> TauriDialogs<R> {
    fn builder(&self, o: &DialogOptions) -> FileDialogBuilder<R> {
        let mut b = self.app.dialog().file().set_title(&o.title);
        if let Some(w) = self.app.get_webview_window(window::MAIN) {
            b = b.set_parent(&w);
        }
        if let Some(name) = &o.default_file_name {
            b = b.set_file_name(name);
        }
        for f in &o.filters {
            let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            b = b.add_filter(&f.name, &exts);
        }
        b
    }
}

impl<R: Runtime> Dialogs for TauriDialogs<R> {
    fn pick_file(&self, o: DialogOptions) -> Option<PathBuf> {
        self.builder(&o).blocking_pick_file().and_then(|p| p.into_path().ok())
    }
    fn pick_files(&self, o: DialogOptions) -> Option<Vec<PathBuf>> {
        self.builder(&o)
            .blocking_pick_files()
            .map(|v| v.into_iter().filter_map(|p| p.into_path().ok()).collect())
    }
    fn pick_folder(&self, o: DialogOptions) -> Option<PathBuf> {
        self.builder(&o).set_can_create_directories(true).blocking_pick_folder().and_then(|p| p.into_path().ok())
    }
    fn save_file(&self, o: DialogOptions) -> Option<PathBuf> {
        self.builder(&o).blocking_save_file().and_then(|p| p.into_path().ok())
    }
}

/// 重い処理やダイアログで画面を止めないよう、別スレッドで実行する。
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

// ---- 保存・読込(6) ----

#[tauri::command]
async fn notes_load(store: Store<'_>) -> Result<Value, String> {
    let s = store.inner().clone();
    blocking(move || s.notes_load()).await?
}

#[tauri::command]
async fn notes_save(store: Store<'_>, notes: Value) -> Result<bool, String> {
    let s = store.inner().clone();
    blocking(move || s.notes_save(&notes)).await
}

#[tauri::command]
async fn notes_status(store: Store<'_>) -> Result<Value, String> {
    let s = store.inner().clone();
    blocking(move || s.notes_status()).await
}

#[tauri::command]
async fn notes_autosave(store: Store<'_>, notes: Value) -> Result<bool, String> {
    let s = store.inner().clone();
    blocking(move || s.notes_autosave(&notes)).await
}

#[tauri::command]
async fn notes_check_autosave(store: Store<'_>) -> Result<Value, String> {
    let s = store.inner().clone();
    blocking(move || s.notes_check_autosave()).await
}

#[tauri::command]
async fn notes_discard_autosave(store: Store<'_>) -> Result<bool, String> {
    let s = store.inner().clone();
    blocking(move || s.notes_discard_autosave()).await
}

// ---- 設定(2) ----

#[tauri::command]
async fn settings_load(store: Store<'_>) -> Result<Value, String> {
    let s = store.inner().clone();
    blocking(move || s.settings_load()).await?
}

#[tauri::command]
async fn settings_save(store: Store<'_>, settings: Value) -> Result<bool, String> {
    let s = store.inner().clone();
    blocking(move || s.settings_save(&settings)).await
}

// ---- バックアップ(5) ----

#[tauri::command]
async fn backup_checkpoint(store: Store<'_>) -> Result<bool, String> {
    let s = store.inner().clone();
    blocking(move || s.backup_checkpoint()).await
}

#[tauri::command]
async fn backup_manual<R: Runtime>(app: AppHandle<R>, store: Store<'_>) -> Result<Value, String> {
    let s = store.inner().clone();
    blocking(move || s.backup_manual(&TauriDialogs { app })).await?
}

#[tauri::command]
async fn backup_list_auto(store: Store<'_>) -> Result<Value, String> {
    let s = store.inner().clone();
    blocking(move || s.backup_list_auto()).await
}

#[tauri::command]
async fn backup_restore_auto(store: Store<'_>, file_name: Value) -> Result<Value, String> {
    let s = store.inner().clone();
    blocking(move || s.backup_restore_auto(&file_name)).await
}

#[tauri::command]
async fn backup_restore_from_file<R: Runtime>(app: AppHandle<R>, store: Store<'_>) -> Result<Value, String> {
    let s = store.inner().clone();
    blocking(move || s.backup_restore_from_file(&TauriDialogs { app })).await
}

// ---- 書き出し・取込(3) ----

#[tauri::command]
async fn notes_export<R: Runtime>(app: AppHandle<R>, note: Value) -> Result<Value, String> {
    blocking(move || {
        let assets = if note.get("format").and_then(|f| f.as_str()) == Some("pdf") { pdf::load_pdf_assets(&app) } else { Default::default() };
        let printer = pdf::WebviewPdfPrinter { app: app.clone() };
        export::export_note(&note, &TauriDialogs { app }, &printer, &assets)
    })
    .await
}

#[tauri::command]
async fn notes_export_all_markdown<R: Runtime>(app: AppHandle<R>, notes: Value) -> Result<Value, String> {
    blocking(move || export::export_all_markdown(&notes, &TauriDialogs { app })).await
}

#[tauri::command]
async fn notes_import_markdown<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    blocking(move || export::import_markdown(&TauriDialogs { app })).await
}

// ---- 外部リンク(1) ----

#[tauri::command]
async fn shell_open_external<R: Runtime>(app: AppHandle<R>, url: Value) -> Result<Value, String> {
    Ok(match links::validate_external(&url) {
        Err(e) => json!({ "ok": false, "error": e }),
        Ok(u) => match app.opener().open_url(u, None::<&str>) {
            Ok(()) => json!({ "ok": true }),
            Err(e) => {
                eprintln!("外部リンクのオープンに失敗しました: {e}");
                json!({ "ok": false, "error": format!("Error: {e}") })
            }
        },
    })
}

// ---- 暗号(4) ----

#[tauri::command]
async fn crypto_encrypt(text: String, password: String) -> Result<crypto::Payload, String> {
    blocking(move || crypto::encrypt_text(&text, &password)).await
}

#[tauri::command]
async fn crypto_decrypt(payload: Value, password: Value) -> Result<Value, String> {
    blocking(move || {
        let r = match (serde_json::from_value::<crypto::Payload>(payload), password.as_str()) {
            (Ok(p), Some(pw)) => crypto::decrypt_text(&p, pw),
            _ => Err(()),
        };
        match r {
            Ok(text) => json!({ "ok": true, "text": text }),
            Err(()) => json!({ "ok": false, "error": "パスワードが違うか、データが壊れています" }),
        }
    })
    .await
}

#[tauri::command]
async fn crypto_hash_password(password: String) -> Result<String, String> {
    blocking(move || crypto::hash_password(&password)).await
}

#[tauri::command]
async fn crypto_verify_password(password: Value, stored: Value) -> Result<bool, String> {
    blocking(move || match (password.as_str(), stored.as_str()) {
        (Some(p), Some(s)) => crypto::verify_password(p, s),
        _ => false,
    })
    .await
}

// ---- 更新(3) ----

#[tauri::command]
async fn update_check_now<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    if !update::is_packaged() {
        return Ok(json!({ "ok": false, "reason": "dev" }));
    }
    Ok(update::check_now_result(update::check(app).await))
}

#[tauri::command]
async fn update_install_now<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    Ok(update::install_now(&app))
}

#[tauri::command]
fn app_version<R: Runtime>(app: AppHandle<R>) -> String {
    app.package_info().version.to_string()
}

// ---- 窓(渡し口外): 終了前の保存の結果 ----

#[tauri::command]
fn app_close_after_flush<R: Runtime>(app: AppHandle<R>, generation: u64, ok: bool) {
    window::finish_close(&app, generation, ok);
}

pub fn run() {
    tauri::Builder::default()
        // 二重起動の防止は最初に登録する。
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| window::focus_main(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(window::CloseState::default())
        .manage(update::UpdateState::default())
        .setup(|app| {
            let dir = DataStore::legacy_location().ok_or("保存先(%APPDATA%)を特定できません。")?;
            let store = DataStore::new(dir);
            if let Err(e) = store.ensure_migration_backup() {
                // 複製できないまま書き換えるのは危険なので、起動を止める。
                return Err(format!("移行前バックアップを作れませんでした: {e}").into());
            }
            app.manage(Arc::new(store));
            window::create_main(app.handle())?;
            update::init(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            notes_load,
            notes_save,
            notes_status,
            notes_autosave,
            notes_check_autosave,
            notes_discard_autosave,
            settings_load,
            settings_save,
            backup_checkpoint,
            backup_manual,
            backup_list_auto,
            backup_restore_auto,
            backup_restore_from_file,
            notes_export,
            notes_export_all_markdown,
            notes_import_markdown,
            shell_open_external,
            crypto_encrypt,
            crypto_decrypt,
            crypto_hash_password,
            crypto_verify_password,
            update_check_now,
            update_install_now,
            app_version,
            app_close_after_flush,
        ])
        .run(tauri::generate_context!())
        .expect("メモ帳を起動できませんでした");
}
