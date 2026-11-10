//! 自動更新(main.js の initAutoUpdater / update:checkNow / update:installNow)。
//! 現行と同じ流れ: 起動5秒後に確認 → 見つかれば自動で取得 → 取得後は利用者の「今すぐ導入」で導入。
//! 画面へは現行と同じ名前の5種のイベント(update:available など)を送る。

use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct UpdateState {
    downloaded: Mutex<Option<(Update, Vec<u8>)>>,
    busy: AtomicBool,
}

/// 開発中の実行(デバッグビルド)は、現行版の「app.isPackaged が false」と同じ扱いにする。
pub fn is_packaged() -> bool {
    !cfg!(debug_assertions)
}

fn send<R: Runtime>(app: &AppHandle<R>, channel: &str, payload: Value) {
    let _ = app.emit_to("main", channel, payload);
}

/// 確認だけを行い、見つかった場合の取得は裏で続ける。確認の成否を返す。
pub async fn check<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let state = app.state::<UpdateState>();
    if state.downloaded.lock().unwrap().is_some() {
        // 取得済み。現行版と同じく、再度「準備ができました」を知らせる。
        if let Some((u, _)) = state.downloaded.lock().unwrap().as_ref() {
            send(&app, "update:downloaded", json!({ "version": u.version }));
        }
        return Ok(());
    }
    if state.busy.swap(true, Ordering::SeqCst) {
        return Ok(()); // 確認または取得の途中
    }
    let result = async {
        let updater = app.updater().map_err(|e| e.to_string())?;
        updater.check().await.map_err(|e| e.to_string())
    }
    .await;
    match result {
        Err(e) => {
            state.busy.store(false, Ordering::SeqCst);
            eprintln!("自動アップデートの確認に失敗しました: {e}");
            send(&app, "update:error", json!({ "message": e }));
            Err(e)
        }
        Ok(None) => {
            state.busy.store(false, Ordering::SeqCst);
            send(&app, "update:not-available", Value::Null);
            Ok(())
        }
        Ok(Some(update)) => {
            send(&app, "update:available", json!({ "version": update.version }));
            let app2 = app.clone();
            tauri::async_runtime::spawn(async move { download(app2, update).await });
            Ok(())
        }
    }
}

async fn download<R: Runtime>(app: AppHandle<R>, update: Update) {
    let mut received: u64 = 0;
    let mut last_percent: i64 = -1;
    let app_p = app.clone();
    let r = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                if let Some(t) = total.filter(|t| *t > 0) {
                    let percent = ((received as f64 / t as f64) * 100.0).round() as i64;
                    if percent != last_percent {
                        last_percent = percent;
                        send(&app_p, "update:progress", json!({ "percent": percent }));
                    }
                }
            },
            || {},
        )
        .await;
    let state = app.state::<UpdateState>();
    match r {
        Ok(bytes) => {
            let version = update.version.clone();
            *state.downloaded.lock().unwrap() = Some((update, bytes));
            send(&app, "update:downloaded", json!({ "version": version }));
        }
        Err(e) => {
            eprintln!("更新の取得に失敗しました: {e}");
            send(&app, "update:error", json!({ "message": e.to_string() }));
        }
    }
    state.busy.store(false, Ordering::SeqCst);
}

pub fn init<R: Runtime>(app: &AppHandle<R>) {
    if !is_packaged() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let _ = check(app).await;
    });
}

pub fn check_now_result(r: Result<(), String>) -> Value {
    match r {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "reason": e }),
    }
}

/// 取得済みの更新を導入する。Windows では導入プログラムを起動してアプリを終了する。
pub fn install_now<R: Runtime>(app: &AppHandle<R>) -> Value {
    let state = app.state::<UpdateState>();
    let Some((update, bytes)) = state.downloaded.lock().unwrap().take() else {
        return json!({ "ok": false, "reason": "not-ready" });
    };
    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(50));
        if let Err(e) = update.install(&bytes) {
            eprintln!("更新の導入に失敗しました: {e}");
            send(&app2, "update:error", json!({ "message": e.to_string() }));
            // 失敗したら取得済みの状態に戻す
            *app2.state::<UpdateState>().downloaded.lock().unwrap() = Some((update, bytes));
        }
    });
    json!({ "ok": true })
}
