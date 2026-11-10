//! 現行 storage.js の直訳。メモの形式検証、原子的書込、ファイル名の整形、文字コード判定を行う。
//! メモは型を固定せず serde_json::Value のまま扱い、検証する項目だけを調べる(未知の項目を落とさないため)。

use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::Path;

/// JavaScript の真偽判定(truthy)を JSON 値に対して再現する。
pub fn js_truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(true),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(_)) | Some(Value::Object(_)) => true,
    }
}

/// JavaScript の String(value) を、メモの題名として現れうる範囲で再現する。
pub fn js_string(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => js_number_string(n),
        Value::String(s) => s.clone(),
        Value::Array(a) => a
            .iter()
            .map(|x| if x.is_null() { String::new() } else { js_string(x) })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

fn js_number_string(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    let f = n.as_f64().unwrap_or(0.0);
    if f.fract() == 0.0 && f.abs() < 1e21 {
        format!("{}", f as i128)
    } else {
        f.to_string()
    }
}

pub const ERR_LIST: &str = "メモ一覧の形式が不正です。";
pub const ERR_RECORD: &str = "メモのID・本文が不正、またはIDが重複しています。";
pub const ERR_TAGS: &str = "タグの形式が不正です。";
pub const ERR_LOCK: &str = "ロック情報が不正です。";
pub const ERR_CIPHER: &str = "暗号化データの形式が不正です。";
pub const ERR_DATE: &str = "日付の形式が不正です。";

/// storage.js の validateNotes と同じ規則で検証する。成功時は何も変えない。
pub fn validate_notes(notes: &Value) -> Result<(), String> {
    let list = notes.as_array().ok_or_else(|| ERR_LIST.to_string())?;
    let mut ids = std::collections::HashSet::new();
    for n in list {
        let obj = match n {
            // JavaScript では配列も typeof 'object' だが、id を持たないため同じく不正になる。
            Value::Object(o) => o,
            _ => return Err(ERR_RECORD.into()),
        };
        let id = match obj.get("id") {
            Some(Value::String(s)) if !s.is_empty() => s,
            _ => return Err(ERR_RECORD.into()),
        };
        if ids.contains(id) || !matches!(obj.get("body"), Some(Value::String(_))) {
            return Err(ERR_RECORD.into());
        }
        ids.insert(id.clone());
        if let Some(tags) = obj.get("tags") {
            match tags {
                Value::Array(a) if a.iter().all(|t| t.is_string()) => {}
                _ => return Err(ERR_TAGS.into()),
            }
        }
        let locked = js_truthy(obj.get("locked"));
        if locked {
            match obj.get("passwordHash") {
                Some(Value::String(s)) if !s.is_empty() => {}
                _ => return Err(ERR_LOCK.into()),
            }
        }
        if js_truthy(obj.get("encrypted")) {
            let enc = obj.get("encrypted").unwrap();
            let ok = locked
                && ["salt", "iv", "authTag", "data"]
                    .iter()
                    .all(|k| matches!(enc.get(k), Some(Value::String(_))));
            if !ok {
                return Err(ERR_CIPHER.into());
            }
        }
        for key in ["createdAt", "updatedAt", "trashedAt"] {
            match obj.get(key) {
                None | Some(Value::Null) => {}
                Some(Value::Number(num)) => {
                    let f = num.as_f64().unwrap_or(f64::NAN);
                    if !f.is_finite() || f < 0.0 {
                        return Err(ERR_DATE.into());
                    }
                }
                Some(_) => return Err(ERR_DATE.into()),
            }
        }
    }
    Ok(())
}

pub fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).expect("OSの乱数を取得できません");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// 同じフォルダーに一時ファイルを作り、内容をディスクへ書き切ってから名前を変える。
/// 失敗したときは既存ファイルを残し、一時ファイルを消す。
pub fn atomic_write(file: &Path, contents: &str) -> std::io::Result<()> {
    if let Some(parent) = file.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let mut temp_name = file.as_os_str().to_owned();
    temp_name.push(format!(".{}.tmp", random_hex(8)));
    let temp = std::path::PathBuf::from(temp_name);
    let result = (|| {
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&temp)?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()?;
        drop(f);
        fs::rename(&temp, file)
    })();
    if temp.exists() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn is_forbidden(c: char) -> bool {
    (c as u32) <= 0x1f || matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
}

fn trim_trailing_dot_space(s: &str) -> &str {
    s.trim_end_matches(['.', ' '])
}

/// JavaScript の String.prototype.slice(0, n) を UTF-16 単位で再現する。
/// サロゲート対の途中で切れる場合、Node.js がファイル名へ変換するときと同じく U+FFFD にする。
fn slice_utf16(s: &str, max: usize) -> String {
    let mut out = String::new();
    let mut units = 0;
    for c in s.chars() {
        let len = c.len_utf16();
        if units + len > max {
            if units < max {
                out.push('\u{FFFD}');
            }
            break;
        }
        out.push(c);
        units += len;
    }
    out
}

/// storage.js の safeFileStem と同じ規則でファイル名の本体を作る。
pub fn safe_file_stem(value: Option<&Value>) -> String {
    let raw = if js_truthy(value) { js_string(value.unwrap()) } else { "無題のメモ".to_string() };
    let replaced: String = raw.chars().map(|c| if is_forbidden(c) { '_' } else { c }).collect();
    let sliced = slice_utf16(trim_trailing_dot_space(&replaced), 80);
    let mut name = trim_trailing_dot_space(&sliced).to_string();
    if name.is_empty() {
        name = "無題のメモ".into();
    }
    if is_reserved_device_name(&name) {
        name.insert(0, '_');
    }
    name
}

fn is_reserved_device_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let b = lower.as_bytes();
    let rest = if lower.starts_with("con") || lower.starts_with("prn") || lower.starts_with("aux") || lower.starts_with("nul") {
        &b[3..]
    } else if (lower.starts_with("com") || lower.starts_with("lpt")) && b.len() >= 4 && (b'1'..=b'9').contains(&b[3]) {
        &b[4..]
    } else {
        return false;
    };
    rest.is_empty() || rest[0] == b'.'
}

pub const ERR_ENCODING: &str = "文字コードを判定できません。UTF-8またはBOM付きUTF-16で保存してから読み込んでください。";

/// storage.js の decodeText と同じ規則で、BOMで UTF-8 / UTF-16LE / UTF-16BE を判定し、
/// 不正なときは置換せず拒否する。改行は \n に統一する。
pub fn decode_text(bytes: &[u8]) -> Result<String, String> {
    let text = if bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] == 0xfe {
        decode_utf16(&bytes[2..], false)?
    } else if bytes.len() >= 2 && bytes[0] == 0xfe && bytes[1] == 0xff {
        decode_utf16(&bytes[2..], true)?
    } else {
        let body = bytes.strip_prefix(&[0xef, 0xbb, 0xbf][..]).unwrap_or(bytes);
        String::from_utf8(body.to_vec()).map_err(|_| ERR_ENCODING.to_string())?
    };
    Ok(normalize_newlines(&text))
}

fn decode_utf16(body: &[u8], big_endian: bool) -> Result<String, String> {
    if body.len() % 2 != 0 {
        return Err(ERR_ENCODING.into());
    }
    let units = body.chunks_exact(2).map(|p| if big_endian { u16::from_be_bytes([p[0], p[1]]) } else { u16::from_le_bytes([p[0], p[1]]) });
    char::decode_utf16(units).collect::<Result<String, _>>().map_err(|_| ERR_ENCODING.to_string())
}

pub fn normalize_newlines(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
            out.push('\n');
        } else {
            out.push(c);
        }
    }
    out
}

/// JSON.stringify(value, null, 2) と同じ字下げで書く。
pub fn to_pretty_json(v: &Value) -> String {
    serde_json::to_string_pretty(v).expect("JSON値は常に文字列化できる")
}

/// fs.readFileSync(file, "utf-8") と同じく、不正なUTF-8は置換文字にして読む。
pub fn read_utf8_lossy(file: &Path) -> std::io::Result<String> {
    let bytes = fs::read(file)?;
    Ok(match String::from_utf8(bytes) {
        Ok(s) => s,
        Err(e) => String::from_utf8_lossy(e.as_bytes()).into_owned(),
    })
}

/// JSON.parse 相当。JavaScript が書き出しうる「対にならないサロゲートの \u エスケープ」を
/// serde_json は受け付けないため、その箇所だけ U+FFFD に置き換えてから解析する。
pub fn parse_json(text: &str) -> Result<Value, String> {
    match serde_json::from_str::<Value>(text) {
        Ok(v) => Ok(v),
        Err(first) => {
            let fixed = replace_lone_surrogate_escapes(text);
            if fixed != text {
                serde_json::from_str::<Value>(&fixed).map_err(|e| format!("SyntaxError: {e}"))
            } else {
                Err(format!("SyntaxError: {first}"))
            }
        }
    }
}

fn hex4(b: &[u8]) -> Option<u16> {
    if b.len() < 4 {
        return None;
    }
    u16::from_str_radix(std::str::from_utf8(&b[..4]).ok()?, 16).ok()
}

fn replace_lone_surrogate_escapes(text: &str) -> String {
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    let mut in_string = false;
    let mut last = 0;
    while i < b.len() {
        let c = b[i];
        if !in_string {
            if c == b'"' {
                in_string = true;
            }
            i += 1;
            continue;
        }
        match c {
            b'"' => {
                in_string = false;
                i += 1;
            }
            b'\\' if i + 1 < b.len() && b[i + 1] == b'u' => {
                let unit = hex4(&b[i + 2..]);
                match unit {
                    Some(u) if (0xD800..0xDC00).contains(&u) => {
                        let next_low = if b.len() >= i + 12 && b[i + 6] == b'\\' && b[i + 7] == b'u' { hex4(&b[i + 8..]) } else { None };
                        if matches!(next_low, Some(l) if (0xDC00..0xE000).contains(&l)) {
                            i += 12;
                        } else {
                            out.push_str(&text[last..i]);
                            out.push_str("\\ufffd");
                            i += 6;
                            last = i;
                        }
                    }
                    Some(u) if (0xDC00..0xE000).contains(&u) => {
                        out.push_str(&text[last..i]);
                        out.push_str("\\ufffd");
                        i += 6;
                        last = i;
                    }
                    _ => i += 2,
                }
            }
            b'\\' => i += 2,
            _ => i += 1,
        }
    }
    out.push_str(&text[last..]);
    out
}

/// Node.js の path.basename と同じく、/ と \ の両方を区切りとして最後の要素を返す(Windows版の挙動)。
pub fn basename(name: &str) -> String {
    let trimmed = name.trim_end_matches(['/', '\\']);
    trimmed.rsplit(['/', '\\']).next().unwrap_or("").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn note(body: &str) -> Value {
        json!({"id":"n1","body":body,"tags":[],"createdAt":1,"updatedAt":1})
    }
    fn with(mut v: Value, k: &str, x: Value) -> Value {
        v[k] = x;
        v
    }

    #[test]
    fn atomic_save_creates_parent_and_preserves_utf8_newlines() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("nested/notes.json");
        atomic_write(&file, &serde_json::to_string(&json!([note("題名\n日本語\n\n終端\n")])).unwrap()).unwrap();
        let v: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(v[0]["body"], "題名\n日本語\n\n終端\n");
    }

    #[test]
    fn failed_rename_preserves_existing_destination_and_removes_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("existing");
        fs::create_dir(&file).unwrap();
        fs::write(file.join("keep"), "original").unwrap();
        assert!(atomic_write(&file, "new").is_err());
        assert_eq!(fs::read_to_string(file.join("keep")).unwrap(), "original");
        let tmp = fs::read_dir(dir.path()).unwrap().filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().ends_with(".tmp")).count();
        assert_eq!(tmp, 0);
    }

    #[test]
    fn invalid_backup_rejected() {
        let cases = vec![
            ("object", json!({})),
            ("null record", json!([null])),
            ("numeric body", json!([{"id":"n","body":123}])),
            ("duplicate IDs", json!([note("本文"), note("本文")])),
            ("invalid tags", json!([with(note("本文"), "tags", json!([null]))])),
            ("invalid date", json!([with(note("本文"), "updatedAt", json!("x"))])),
            ("invalid lock", json!([with(note("本文"), "locked", json!(true))])),
            ("invalid cipher", json!([with(with(with(note("本文"), "locked", json!(true)), "passwordHash", json!("x")), "encrypted", json!({}))])),
        ];
        for (label, data) in cases {
            assert!(validate_notes(&data).is_err(), "invalid backup rejected: {label}");
        }
    }

    #[test]
    fn empty_and_legacy_plain_records_remain_readable() {
        assert!(validate_notes(&json!([])).is_ok());
        let legacy = json!([{"id":"old","body":"旧形式"}]);
        assert!(validate_notes(&legacy).is_ok());
        assert_eq!(legacy[0]["body"], "旧形式");
    }

    #[test]
    fn windows_filename() {
        for (name, expected) in [("CON", "_CON"), ("nul.txt", "_nul.txt"), ("A/B:C", "A_B_C"), ("...", "無題のメモ"), ("name. ", "name"), ("a\u{0000}b", "a_b")] {
            assert_eq!(safe_file_stem(Some(&json!(name))), expected, "Windows filename: {name:?}");
        }
        assert_eq!(safe_file_stem(None), "無題のメモ");
        assert_eq!(safe_file_stem(Some(&json!("COM10"))), "COM10");
        assert_eq!(safe_file_stem(Some(&json!("lpt9.md"))), "_lpt9.md");
        assert_eq!(safe_file_stem(Some(&json!("x".repeat(100)))).chars().count(), 80);
    }

    #[test]
    fn utf8_bom_and_crlf_normalize() {
        assert_eq!(decode_text("\u{feff}題\r\n本文\r末尾".as_bytes()).unwrap(), "題\n本文\n末尾");
    }

    #[test]
    fn utf16le_bom_decodes() {
        let mut b = vec![0xff, 0xfe];
        for u in "日本語".encode_utf16() {
            b.extend_from_slice(&u.to_le_bytes());
        }
        assert_eq!(decode_text(&b).unwrap(), "日本語");
    }

    #[test]
    fn utf16be_bom_decodes() {
        assert_eq!(decode_text(&[254, 255, 0, 65, 0, 66]).unwrap(), "AB");
    }

    #[test]
    fn invalid_encoding_is_rejected_instead_of_replacing_text() {
        assert!(decode_text(&[0x82, 0xa0]).is_err());
        assert!(decode_text(&[0xff, 0xfe, 0x41]).is_err());
    }

    #[test]
    fn lone_surrogate_escape_is_readable() {
        let v = parse_json(r#"[{"id":"a","body":"x\ud83dy😀z\\ud83d"}]"#).unwrap();
        assert_eq!(v[0]["body"], "x\u{FFFD}y😀z\\ud83d");
    }

    #[test]
    fn basename_handles_both_separators() {
        assert_eq!(basename("..\\..\\x.json"), "x.json");
        assert_eq!(basename("../a/b.json"), "b.json");
        assert_eq!(basename("plain.json"), "plain.json");
    }
}
