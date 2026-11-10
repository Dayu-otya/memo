//! PDF 出力。非表示の副窓で一時HTMLを開き、WebView2 の PrintToPdf を呼ぶ(Windows のみ)。
//! 現行版の printToPDF({ pageSize: "A4", printBackground: true }) に合わせ、
//! A4(210×297 mm)、余白は Electron の既定値と同じ 1 cm、背景あり、ヘッダー・フッターなしを明示する。

use crate::export::{PdfAssets, PdfPrinter};
use std::path::Path;
use tauri::{AppHandle, Runtime};

pub const PAGE_WIDTH_IN: f64 = 210.0 / 25.4;
pub const PAGE_HEIGHT_IN: f64 = 297.0 / 25.4;
pub const MARGIN_IN: f64 = 10.0 / 25.4;

pub struct WebviewPdfPrinter<R: Runtime> {
    pub app: AppHandle<R>,
}

/// 画面側の資源(プログラムに埋め込まれた style.css と KaTeX)から、PDF 用 HTML に塗り込む CSS を作る。
pub fn load_pdf_assets<R: Runtime>(app: &AppHandle<R>) -> PdfAssets {
    let resolver = app.asset_resolver();
    let text = |p: &str| resolver.get(p.to_string()).map(|a| String::from_utf8_lossy(&a.bytes).into_owned()).unwrap_or_default();
    let style_css = text("style.css");
    let katex_raw = text("vendor/katex/katex.min.css");
    let katex_css = crate::export::inline_katex_fonts(&katex_raw, |rel| resolver.get(format!("vendor/katex/{rel}")).map(|a| a.bytes.to_vec()));
    PdfAssets { style_css, katex_css }
}

impl<R: Runtime> PdfPrinter for WebviewPdfPrinter<R> {
    #[cfg(windows)]
    fn print_to_pdf(&self, html_file: &Path, out: &Path) -> Result<(), String> {
        windows_impl::print(&self.app, html_file, out)
    }

    #[cfg(not(windows))]
    fn print_to_pdf(&self, _html_file: &Path, _out: &Path) -> Result<(), String> {
        let _ = &self.app;
        Err("PDF書き出しはWindows版でのみ利用できます。".into())
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use std::sync::{mpsc, Mutex};
    use std::time::Duration;
    use tauri::webview::{NewWindowResponse, PageLoadEvent};
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    pub fn print<R: Runtime>(app: &AppHandle<R>, html_file: &Path, out: &Path) -> Result<(), String> {
        let url = tauri::Url::from_file_path(html_file).map_err(|_| "一時ファイルのURLを作れません。".to_string())?;
        let allowed = url.to_string();
        let label = format!("pdf-{}", crate::storage::random_hex(6));
        let (load_tx, load_rx) = mpsc::channel::<()>();
        let load_tx = Mutex::new(Some(load_tx));
        let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
            .title("PDF")
            .visible(false)
            .focused(false)
            .skip_taskbar(true)
            .inner_size(794.0, 1123.0)
            .disable_drag_drop_handler()
            .on_navigation(move |u| u.as_str() == allowed)
            .on_new_window(|_, _| NewWindowResponse::Deny)
            .on_page_load(move |_w, p| {
                if p.event() == PageLoadEvent::Finished {
                    if let Some(tx) = load_tx.lock().unwrap().take() {
                        let _ = tx.send(());
                    }
                }
            })
            .build()
            .map_err(|e| e.to_string())?;

        let result = (|| -> Result<(), String> {
            load_rx.recv_timeout(Duration::from_secs(30)).map_err(|_| "PDF用の表示が時間内に完了しませんでした。".to_string())?;
            let (tx, rx) = mpsc::channel::<Result<(), String>>();
            let out_path = out.to_path_buf();
            win.with_webview(move |pw| {
                let tx2 = tx.clone();
                if let Err(e) = unsafe { start_print(&pw, &out_path, tx) } {
                    let _ = tx2.send(Err(e));
                }
            })
            .map_err(|e| e.to_string())?;
            rx.recv_timeout(Duration::from_secs(120)).map_err(|_| "PDF出力が時間内に終わりませんでした。".to_string())?
        })();
        let _ = win.destroy();
        result
    }

    /// UI スレッド上で呼ばれる。完了は tx へ送る。
    unsafe fn start_print(pw: &tauri::webview::PlatformWebview, out: &Path, tx: mpsc::Sender<Result<(), String>>) -> Result<(), String> {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Environment6, ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
        };
        use webview2_com::PrintToPdfCompletedHandler;
        use windows_core::{Interface, HSTRING};
        let e = |x: windows_core::Error| x.to_string();

        let core = pw.controller().CoreWebView2().map_err(e)?;
        let core7: ICoreWebView2_7 = core.cast().map_err(|_| "この端末のWebView2はPDF出力(PrintToPdf)に対応していません。WebView2ランタイムを更新してください。".to_string())?;
        let env6: ICoreWebView2Environment6 = pw.environment().cast().map_err(|_| "この端末のWebView2は印刷設定に対応していません。WebView2ランタイムを更新してください。".to_string())?;
        let s = env6.CreatePrintSettings().map_err(e)?;
        s.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT).map_err(e)?;
        s.SetPageWidth(PAGE_WIDTH_IN).map_err(e)?;
        s.SetPageHeight(PAGE_HEIGHT_IN).map_err(e)?;
        s.SetMarginTop(MARGIN_IN).map_err(e)?;
        s.SetMarginBottom(MARGIN_IN).map_err(e)?;
        s.SetMarginLeft(MARGIN_IN).map_err(e)?;
        s.SetMarginRight(MARGIN_IN).map_err(e)?;
        s.SetScaleFactor(1.0).map_err(e)?;
        s.SetShouldPrintBackgrounds(true).map_err(e)?;
        s.SetShouldPrintHeaderAndFooter(false).map_err(e)?;
        s.SetShouldPrintSelectionOnly(false).map_err(e)?;

        let handler = PrintToPdfCompletedHandler::create(Box::new(move |hr, ok| {
            let _ = tx.send(match (hr, ok) {
                (Ok(()), true) => Ok(()),
                (Err(err), _) => Err(err.to_string()),
                (Ok(()), false) => Err("PDF出力に失敗しました。保存先に書き込めるか確認してください。".into()),
            });
            Ok(())
        }));
        let path = HSTRING::from(out.as_os_str());
        core7.PrintToPdf(&path, &s, &handler).map_err(e)?;
        Ok(())
    }
}
