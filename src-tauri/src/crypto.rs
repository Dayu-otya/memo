//! 現行 main.js の暗号処理の直訳。
//! 鍵: scrypt(N=16384, r=8, p=1, 32バイト)。Node.js の crypto.scryptSync の既定値と同じ値を明示する。
//! 本文: AES-256-GCM、iv 12バイト、認証タグ16バイトを本文と分けて保存する(salt, iv, authTag, data を base64)。
//! パスワード確認値: "salt(base64):hash(base64)"。比較は定時間で行う。

use aes_gcm::aead::{AeadInPlace, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce, Tag};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;

const SCRYPT_LOG_N: u8 = 14; // N = 16384
const SCRYPT_R: u32 = 8;
const SCRYPT_P: u32 = 1;
const KEY_LEN: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Payload {
    pub salt: String,
    pub iv: String,
    pub auth_tag: String,
    pub data: String,
}

fn random(n: usize) -> Vec<u8> {
    let mut b = vec![0u8; n];
    getrandom::getrandom(&mut b).expect("OSの乱数を取得できません");
    b
}

pub fn derive_key(password: &str, salt: &[u8]) -> [u8; KEY_LEN] {
    let params = scrypt::Params::new(SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P, KEY_LEN).expect("scryptの設定値は固定で有効");
    let mut key = [0u8; KEY_LEN];
    scrypt::scrypt(password.as_bytes(), salt, &params, &mut key).expect("鍵長は固定で有効");
    key
}

/// salt と iv を外から与える版(固定データ試験用)。
pub fn encrypt_with(plain: &str, password: &str, salt: &[u8], iv: &[u8]) -> Payload {
    let key = derive_key(password, salt);
    let cipher = Aes256Gcm::new_from_slice(&key).expect("鍵長は32バイト");
    let mut buf = plain.as_bytes().to_vec();
    let tag = cipher
        .encrypt_in_place_detached(Nonce::from_slice(iv), b"", &mut buf)
        .expect("AES-GCMの暗号化は入力長の上限内で失敗しない");
    Payload { salt: B64.encode(salt), iv: B64.encode(iv), auth_tag: B64.encode(tag), data: B64.encode(&buf) }
}

pub fn encrypt_text(plain: &str, password: &str) -> Payload {
    encrypt_with(plain, password, &random(16), &random(12))
}

pub fn decrypt_text(payload: &Payload, password: &str) -> Result<String, ()> {
    let salt = B64.decode(&payload.salt).map_err(|_| ())?;
    let iv = B64.decode(&payload.iv).map_err(|_| ())?;
    let tag = B64.decode(&payload.auth_tag).map_err(|_| ())?;
    let mut data = B64.decode(&payload.data).map_err(|_| ())?;
    // Node.js の createDecipheriv は12バイト以外の iv も受け付けるが、現行版が作る iv は常に12バイトである。
    if iv.len() != 12 || tag.len() != 16 {
        return Err(());
    }
    let key = derive_key(password, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| ())?;
    cipher
        .decrypt_in_place_detached(Nonce::from_slice(&iv), b"", &mut data, Tag::from_slice(&tag))
        .map_err(|_| ())?;
    // Buffer#toString("utf-8") と同じく、不正なUTF-8は置換文字にする。
    Ok(String::from_utf8_lossy(&data).into_owned())
}

pub fn hash_password_with(password: &str, salt: &[u8]) -> String {
    let hash = derive_key(password, salt);
    format!("{}:{}", B64.encode(salt), B64.encode(hash))
}

pub fn hash_password(password: &str) -> String {
    hash_password_with(password, &random(16))
}

/// Node.js の Buffer.from(x, "base64") は不正な文字を読み飛ばす寛容な解釈をする。
/// 現行版が作る値は常に正しい base64 なので、ここでは厳密に解釈し、不正なら一致しないとする。
pub fn verify_password(password: &str, stored: &str) -> bool {
    let mut parts = stored.split(':');
    let (Some(salt_b64), Some(hash_b64)) = (parts.next(), parts.next()) else { return false };
    let (Ok(salt), Ok(expected)) = (B64.decode(salt_b64), B64.decode(hash_b64)) else { return false };
    // timingSafeEqual は長さが違うと例外になり、現行版では false を返す。
    if expected.len() != KEY_LEN {
        return false;
    }
    let actual = derive_key(password, &salt);
    actual.ct_eq(&expected[..]).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aes_gcm_roundtrip_wrong_password_and_tampered_cipher() {
        let payload = encrypt_text("秘密\n本文", "pw");
        assert_eq!(decrypt_text(&payload, "pw").unwrap(), "秘密\n本文");
        assert!(decrypt_text(&payload, "wrong").is_err());
        let tampered = Payload { data: "AAAA".into(), ..payload.clone() };
        assert!(decrypt_text(&tampered, "pw").is_err());
    }

    #[test]
    fn password_hash_success_and_mismatch() {
        let stored = hash_password("pw");
        assert!(verify_password("pw", &stored));
        assert!(!verify_password("no", &stored));
        assert!(!verify_password("pw", "broken"));
        assert!(!verify_password("pw", "AAAA:AAAA"));
    }
}
