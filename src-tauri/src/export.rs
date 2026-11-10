//! 書き出し・取込(main.js の notes:export / exportAllMarkdown / importMarkdown)。

use crate::backup::err_string;
use crate::dialogs::{DialogOptions, Dialogs, Filter};
use crate::storage::{decode_text, js_truthy, random_hex, safe_file_stem};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// PDF を作る部品。本番は WebView2 の PrintToPdf(pdf.rs)、試験は模擬実装。
pub trait PdfPrinter: Send + Sync {
    /// html_file を A4・背景ありで描画し、out へ PDF を書く。
    fn print_to_pdf(&self, html_file: &Path, out: &Path) -> Result<(), String>;
}

/// PDF 用 HTML に塗り込む CSS。katex_css のフォント参照は data: URI に置き換え済みであること。
#[derive(Clone, Default)]
pub struct PdfAssets {
    pub style_css: String,
    pub katex_css: String,
}

fn escape_html_for_pdf(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// 現行版と同じ構造の HTML を作る。現行版は style.css と katex.min.css を file: で参照していたが、
/// Tauri 版では画面側の資源がプログラム内に埋め込まれるため、同じ内容を <style> に塗り込む。
pub fn build_pdf_html(body: &str, body_html: Option<&str>, assets: &PdfAssets) -> String {
    let lines: Vec<&str> = body.split('\n').collect();
    let first = lines.first().copied().unwrap_or("");
    let title_line = escape_html_for_pdf(if first.is_empty() { "無題のメモ" } else { first });
    let rest_html = match body_html {
        Some(h) => h.to_string(),
        None => lines
            .iter()
            .skip(1)
            .map(|l| {
                let e = escape_html_for_pdf(l);
                format!("<p>{}</p>", if e.is_empty() { "&nbsp;".to_string() } else { e })
            })
            .collect::<Vec<_>>()
            .join("\n"),
    };
    // </style> を含むCSSで要素が閉じられないようにする(自前の資源だが念のため)。
    let style_css = assets.style_css.replace("</style", "<\\/style");
    let katex_css = assets.katex_css.replace("</style", "<\\/style");
    format!(
        r#"<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:;">
<style>
{style_css}
</style>
<style>
{katex_css}
</style>
<style>
  html, body {{ height: auto; background: white; color: #222; }}
  body {{ font-family: "Hiragino Sans", "Yu Gothic", sans-serif; padding: 32px; color: #222; }}
  h1 {{ font-size: 20px; margin: 0 0 16px; }}
  h1, h2, h3 {{ margin: 0 0 8px; }}
  p {{ font-size: 13px; line-height: 1.8; margin: 0 0 4px; white-space: pre-wrap; }}
  ul {{ font-size: 13px; line-height: 1.8; margin: 0 0 8px; padding-left: 1.4em; }}
  code, pre {{ font-family: "SFMono-Regular", Consolas, monospace; }}
  pre {{ background: #f4f1e9; padding: 10px 12px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; }}
</style></head>
<body><main class="print-preview-page"><h1>{title_line}</h1>{rest_html}</main></body></html>"#
    )
}

/// katex.min.css の url(fonts/xxx) を、手元にあるフォントだけ data: URI に置き換える。
pub fn inline_katex_fonts(css: &str, mut font: impl FnMut(&str) -> Option<Vec<u8>>) -> String {
    use base64::Engine;
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(pos) = rest.find("url(fonts/") {
        out.push_str(&rest[..pos]);
        let after = &rest[pos + 4..];
        let Some(end) = after.find(')') else {
            out.push_str(&rest[pos..]);
            rest = "";
            break;
        };
        let rel = &after[..end];
        let mime = if rel.ends_with(".woff2") {
            "font/woff2"
        } else if rel.ends_with(".woff") {
            "font/woff"
        } else {
            "font/ttf"
        };
        match font(rel) {
            Some(bytes) => {
                out.push_str("url(data:");
                out.push_str(mime);
                out.push_str(";base64,");
                out.push_str(&base64::engine::general_purpose::STANDARD.encode(bytes));
                out.push(')');
            }
            None => {
                out.push_str("url(");
                out.push_str(rel);
                out.push(')');
            }
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

fn write_private_temp(contents: &str) -> std::io::Result<PathBuf> {
    let file = std::env::temp_dir().join(format!("memo-print-{}.html", random_hex(12)));
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(&file)?;
    f.write_all(contents.as_bytes())?;
    f.sync_all()?;
    Ok(file)
}

pub fn export_note(arg: &Value, dialogs: &dyn Dialogs, printer: &dyn PdfPrinter, assets: &PdfAssets) -> Value {
    let safe_title = safe_file_stem(arg.get("title"));
    let is_pdf = arg.get("format").and_then(|f| f.as_str()) == Some("pdf");
    let picked = dialogs.save_file(DialogOptions {
        title: if is_pdf { "メモをPDFとして書き出し" } else { "メモをテキストとして書き出し" }.into(),
        default_file_name: Some(format!("{safe_title}.{}", if is_pdf { "pdf" } else { "txt" })),
        filters: vec![if is_pdf { Filter::new("PDFファイル", &["pdf"]) } else { Filter::new("テキストファイル", &["txt"]) }],
    });
    let Some(file_path) = picked else { return json!({ "ok": false, "canceled": true }) };
    let fp = file_path.to_string_lossy().to_string();

    if !is_pdf {
        let Some(body) = arg.get("body").and_then(|b| b.as_str()) else {
            return json!({ "ok": false, "error": "TypeError [ERR_INVALID_ARG_TYPE]: The \"data\" argument must be of type string." });
        };
        return match fs::write(&file_path, body) {
            Ok(()) => json!({ "ok": true, "filePath": fp }),
            Err(e) => {
                eprintln!("エクスポートに失敗しました: {e}");
                json!({ "ok": false, "error": err_string(e) })
            }
        };
    }

    // String(body || "") と同じ扱い
    let body = match arg.get("body") {
        Some(v) if js_truthy(Some(v)) => crate::storage::js_string(v),
        _ => String::new(),
    };
    let body_html = arg.get("bodyHtml").and_then(|h| h.as_str());
    let html = build_pdf_html(&body, body_html, assets);
    let mut temp: Option<PathBuf> = None;
    let result = (|| -> Result<(), String> {
        let t = write_private_temp(&html).map_err(err_string)?;
        temp = Some(t.clone());
        printer.print_to_pdf(&t, &file_path)
    })();
    if let Some(t) = temp {
        if t.exists() {
            let _ = fs::remove_file(&t);
        }
    }
    match result {
        Ok(()) => json!({ "ok": true, "filePath": fp }),
        Err(e) => {
            eprintln!("PDF書き出しに失敗しました: {e}");
            json!({ "ok": false, "error": err_string(e) })
        }
    }
}

pub fn export_all_markdown(notes: &Value, dialogs: &dyn Dialogs) -> Value {
    let picked = dialogs.pick_folder(DialogOptions { title: "書き出し先のフォルダを選択".into(), ..Default::default() });
    let Some(dest) = picked else { return json!({ "ok": false, "canceled": true }) };
    let dest_s = dest.to_string_lossy().to_string();
    let mut used: HashSet<String> = HashSet::new();
    let mut count = 0u64;
    let r = (|| -> Result<(), String> {
        let list = notes.as_array().ok_or("TypeError: notes is not iterable")?;
        for n in list {
            if js_truthy(n.get("trashedAt")) || js_truthy(n.get("locked")) {
                continue;
            }
            let title = safe_file_stem(n.get("title"));
            let mut name = title.clone();
            let mut i = 2;
            while used.contains(&name.to_lowercase()) || dest.join(format!("{name}.md")).exists() {
                name = format!("{title}_{i}");
                i += 1;
            }
            used.insert(name.to_lowercase());
            let path = dest.join(format!("{name}.md"));
            let body = n.get("body").and_then(|b| b.as_str()).ok_or("TypeError [ERR_INVALID_ARG_TYPE]: The \"data\" argument must be of type string.")?;
            let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(err_string)?;
            f.write_all(body.as_bytes()).map_err(err_string)?;
            count += 1;
        }
        Ok(())
    })();
    match r {
        Ok(()) => json!({ "ok": true, "count": count, "destDir": dest_s }),
        Err(e) => {
            eprintln!("Markdown一括エクスポートに失敗しました: {e}");
            json!({ "ok": false, "error": err_string(e) })
        }
    }
}

pub fn import_markdown(dialogs: &dyn Dialogs) -> Value {
    let picked = dialogs.pick_files(DialogOptions {
        title: "インポートするMarkdownファイルを選択".into(),
        default_file_name: None,
        filters: vec![Filter::new("Markdown / テキスト", &["md", "markdown", "txt"])],
    });
    let files = match picked {
        Some(f) if !f.is_empty() => f,
        _ => return json!({ "ok": false, "canceled": true }),
    };
    let mut imported = Vec::new();
    for path in files {
        let r = fs::read(&path).map_err(err_string).and_then(|b| decode_text(&b).map_err(err_string));
        match r {
            Ok(body) => {
                let file_name = path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                imported.push(json!({ "body": body, "fileName": file_name }));
            }
            Err(e) => {
                eprintln!("Markdownインポートに失敗しました: {e}");
                return json!({ "ok": false, "error": e });
            }
        }
    }
    json!({ "ok": true, "imported": imported })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::tests::MockDialogs;
    use std::sync::Mutex;

    struct MockPrinter {
        seen: Mutex<Option<(PathBuf, String)>>,
    }
    impl PdfPrinter for MockPrinter {
        fn print_to_pdf(&self, html: &Path, out: &Path) -> Result<(), String> {
            *self.seen.lock().unwrap() = Some((html.to_path_buf(), fs::read_to_string(html).unwrap()));
            fs::write(out, "%PDF-test").map_err(|e| e.to_string())
        }
    }
    fn note(id: &str, body: &str) -> Value {
        json!({"id":id,"body":body,"tags":[],"createdAt":1,"updatedAt":1})
    }

    #[test]
    fn bulk_export_retains_existing_files_and_disambiguates_repeated_names() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("same.md"), "keep").unwrap();
        let m = MockDialogs::default();
        *m.open.lock().unwrap() = Some(vec![d.path().to_path_buf()]);
        let mut a = note("n1", "one");
        a["title"] = json!("same");
        let mut b = note("n2", "two");
        b["title"] = json!("same");
        let mut c = note("n3", "本文");
        c["locked"] = json!(true);
        let mut t = note("n4", "trash");
        t["trashedAt"] = json!(5);
        let r = export_all_markdown(&json!([a, b, c, t]), &m);
        assert_eq!(r["count"], 2);
        assert_eq!(fs::read_to_string(d.path().join("same.md")).unwrap(), "keep");
        assert_eq!(fs::read_to_string(d.path().join("same_2.md")).unwrap(), "one");
        assert_eq!(fs::read_to_string(d.path().join("same_3.md")).unwrap(), "two");
        // 題名の無いメモは「無題のメモ」、大文字小文字違いも別名にする
        let m2 = MockDialogs::default();
        let d2 = tempfile::tempdir().unwrap();
        *m2.open.lock().unwrap() = Some(vec![d2.path().to_path_buf()]);
        let mut x = note("a", "1");
        x["title"] = json!("Abc");
        let mut y = note("b", "2");
        y["title"] = json!("abc");
        let r = export_all_markdown(&json!([x, y, note("c", "3")]), &m2);
        assert_eq!(r["count"], 3);
        assert!(d2.path().join("abc_2.md").exists() && d2.path().join("無題のメモ.md").exists());
    }

    #[test]
    fn import_normalizes_bom_and_crlf() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("sample.md");
        fs::write(&f, "\u{feff}題\r\n本文").unwrap();
        let m = MockDialogs::default();
        *m.open.lock().unwrap() = Some(vec![f]);
        let r = import_markdown(&m);
        assert_eq!(r["imported"][0]["body"], "題\n本文");
        assert_eq!(r["imported"][0]["fileName"], "sample.md");
        let bad = d.path().join("bad.txt");
        fs::write(&bad, [0x82, 0xa0]).unwrap();
        *m.open.lock().unwrap() = Some(vec![bad]);
        assert_eq!(import_markdown(&m)["ok"], false);
    }

    #[test]
    fn dialog_cancellation_is_returned_without_writing() {
        let m = MockDialogs::default();
        let p = MockPrinter { seen: Mutex::new(None) };
        assert_eq!(export_note(&json!({"body":"x","format":"txt"}), &m, &p, &PdfAssets::default())["canceled"], true);
        assert_eq!(import_markdown(&m)["canceled"], true);
        assert_eq!(export_all_markdown(&json!([]), &m)["canceled"], true);
        assert!(p.seen.lock().unwrap().is_none());
    }

    #[test]
    fn text_export_is_exact_including_blank_and_terminal_lines() {
        let d = tempfile::tempdir().unwrap();
        let file = d.path().join("out.txt");
        let m = MockDialogs::default();
        *m.save.lock().unwrap() = Some(file.clone());
        let body = "題\n\n本文\n";
        let p = MockPrinter { seen: Mutex::new(None) };
        let r = export_note(&json!({"title":"題","body":body,"format":"txt"}), &m, &p, &PdfAssets::default());
        assert_eq!(r["ok"], true);
        assert_eq!(fs::read_to_string(&file).unwrap(), body);
        assert_eq!(m.last.lock().unwrap().clone().unwrap().default_file_name.unwrap(), "題.txt");
    }

    #[test]
    fn pdf_code_path_cleans_temporary_plaintext_and_writes_returned_bytes() {
        let d = tempfile::tempdir().unwrap();
        let file = d.path().join("out.pdf");
        let m = MockDialogs::default();
        *m.save.lock().unwrap() = Some(file.clone());
        let p = MockPrinter { seen: Mutex::new(None) };
        let assets = PdfAssets { style_css: ".x{}".into(), katex_css: ".k{}".into() };
        let r = export_note(&json!({"title":"題","body":"題\n本文","bodyHtml":"<p>本文</p>","format":"pdf"}), &m, &p, &assets);
        assert_eq!(r["ok"], true);
        let (html_path, html) = p.seen.lock().unwrap().clone().unwrap();
        assert!(!html_path.exists());
        assert!(html.contains("<h1>題</h1><p>本文</p>") && html.contains(".x{}") && html.contains(".k{}"));
        assert_eq!(fs::read_to_string(&file).unwrap(), "%PDF-test");
    }

    #[test]
    fn pdf_html_escapes_title_and_falls_back_to_plain_lines() {
        let h = build_pdf_html("<b>&\n\n二行目", None, &PdfAssets::default());
        assert!(h.contains("<h1>&lt;b&gt;&amp;</h1><p>&nbsp;</p>\n<p>二行目</p>"));
        assert!(build_pdf_html("", None, &PdfAssets::default()).contains("<h1>無題のメモ</h1>"));
    }

    #[test]
    fn pdf_failure_is_reported_and_temp_removed() {
        struct Fail(Mutex<Option<PathBuf>>);
        impl PdfPrinter for Fail {
            fn print_to_pdf(&self, html: &Path, _: &Path) -> Result<(), String> {
                *self.0.lock().unwrap() = Some(html.into());
                Err("boom".into())
            }
        }
        let m = MockDialogs::default();
        *m.save.lock().unwrap() = Some(std::env::temp_dir().join("never.pdf"));
        let f = Fail(Mutex::new(None));
        let r = export_note(&json!({"body":"a","format":"pdf"}), &m, &f, &PdfAssets::default());
        assert_eq!(r["ok"], false);
        assert_eq!(r["error"], "Error: boom");
        assert!(!f.0.lock().unwrap().clone().unwrap().exists());
    }

    #[test]
    fn katex_fonts_are_inlined_when_available() {
        let css = "a{src:url(fonts/A.woff2) format(\"woff2\"),url(fonts/A.woff) format(\"woff\")}";
        let out = inline_katex_fonts(css, |p| if p == "fonts/A.woff2" { Some(vec![1, 2, 3]) } else { None });
        assert_eq!(out, "a{src:url(data:font/woff2;base64,AQID) format(\"woff2\"),url(fonts/A.woff) format(\"woff\")}");
    }
}
