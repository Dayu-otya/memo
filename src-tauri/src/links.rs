//! 外部リンク(main.js の shell:openExternal)の検証。http と https 以外は拒否する。

use serde_json::Value;

/// 開いてよい URL なら正規化した文字列を返す。拒否する場合は返り値の error 文言を返す。
pub fn validate_external(url: &Value) -> Result<String, String> {
    let raw = crate::storage::js_string(url);
    let parsed = url::Url::parse(&raw).map_err(|_| "TypeError: Invalid URL".to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("許可されていないURLの形式です".into());
    }
    Ok(parsed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn external_non_web_protocols_are_rejected() {
        assert!(validate_external(&json!("file:///secret")).is_err());
        assert!(validate_external(&json!("javascript:alert(1)")).is_err());
        assert_eq!(validate_external(&json!("javascript:alert(1)")).unwrap_err(), "許可されていないURLの形式です");
        assert!(validate_external(&json!("not a url")).is_err());
        assert_eq!(validate_external(&json!("https://example.com")).unwrap(), "https://example.com/");
        assert_eq!(validate_external(&json!("HTTP://Example.com/a?b=1&c=2")).unwrap(), "http://example.com/a?b=1&c=2");
    }
}
