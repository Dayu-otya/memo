//! 窓の振る舞い(main.js の createWindow と close 処理)。
//! 寸法 1100×720(最小 700×480)、背景色 #FAF7F0、表示準備ができてから表示、新規窓と画面遷移の禁止、
//! 終了時に画面側の flushBeforeClose を待ち、失敗したときは開いたままにする。

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, Runtime, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

pub const MAIN: &str = "main";
pub const FLUSH_EVENT: &str = "app:flush-before-close";
/// 画面側が保存の結果を返さないまま固まった場合に、閉じる要求を受け付け直すまでの時間。
const FLUSH_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct CloseState {
    allowed: AtomicBool,
    closing: AtomicBool,
    generation: AtomicU64,
}

/// アプリ自身の画面(tauri://localhost または http(s)://tauri.localhost)だけを表示してよい。
pub fn is_app_url(u: &Url) -> bool {
    match u.scheme() {
        "tauri" => u.host_str() == Some("localhost"),
        "http" | "https" => u.host_str() == Some("tauri.localhost"),
        _ => false,
    }
}

pub fn create_main<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    let win = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("メモ帳")
        .inner_size(1100.0, 720.0)
        .min_inner_size(700.0, 480.0)
        .background_color(Color(0xFA, 0xF7, 0xF0, 0xFF))
        .visible(false)
        // 画面側はメモをフォルダーへ移す操作に HTML のドラッグ&ドロップを使う。
        // Tauri の既定のファイル投下処理が有効だと、Windows でこの操作が効かなくなるため無効にする。
        .disable_drag_drop_handler()
        .on_navigation(|u| is_app_url(u))
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_page_load(|w, p| {
            if p.event() == PageLoadEvent::Finished {
                let _ = w.show();
            }
        })
        .build()?;

    let w2 = win.clone();
    win.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            let state = w2.state::<CloseState>();
            if state.allowed.load(Ordering::SeqCst) {
                return;
            }
            api.prevent_close();
            if state.closing.swap(true, Ordering::SeqCst) {
                return; // すでに保存を待っている
            }
            let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
            if w2.emit_to(MAIN, FLUSH_EVENT, generation).is_err() {
                finish_close(w2.app_handle(), generation, false);
                return;
            }
            let app = w2.app_handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(FLUSH_TIMEOUT);
                finish_close(&app, generation, false);
            });
        }
        WindowEvent::Destroyed => {
            // 主窓が閉じたらアプリを終える(PDF用の副窓が残っていても終える)。
            w2.app_handle().exit(0);
        }
        _ => {}
    });
    Ok(win)
}

/// 画面側から保存結果を受け取ったとき(または時間切れ)に呼ぶ。
pub fn finish_close<R: Runtime>(app: &AppHandle<R>, generation: u64, ok: bool) {
    let state = app.state::<CloseState>();
    if state.generation.load(Ordering::SeqCst) != generation || !state.closing.swap(false, Ordering::SeqCst) {
        return; // 古い要求への返事、または処理済み
    }
    if ok {
        state.allowed.store(true, Ordering::SeqCst);
        if let Some(w) = app.get_webview_window(MAIN) {
            let _ = w.close();
        }
    } else {
        app.dialog()
            .message("編集内容を保存できませんでした。保存先の空き容量・アクセス権を確認し、再度お試しください。")
            .title("終了を中止しました")
            .kind(MessageDialogKind::Error)
            .show(|_| {});
    }
}

/// 二つ目の起動時に、既存の窓を元の大きさに戻して前面へ出す。
pub fn focus_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window(MAIN) {
        if w.is_minimized().unwrap_or(false) {
            let _ = w.unminimize();
        }
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_app_origin_is_navigable() {
        for ok in ["tauri://localhost/index.html", "http://tauri.localhost/index.html", "https://tauri.localhost/"] {
            assert!(is_app_url(&Url::parse(ok).unwrap()), "{ok}");
        }
        for ng in ["https://example.com/", "file:///C:/x.html", "http://tauri.localhost.evil.com/", "javascript:alert(1)", "data:text/html,x"] {
            assert!(!is_app_url(&Url::parse(ng).unwrap()), "{ng}");
        }
    }
}
