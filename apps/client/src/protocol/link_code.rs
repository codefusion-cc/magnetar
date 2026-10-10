//! The code a person types to link a browser. The device side of `packages/protocol/src/linkCode.ts`, whose notes say
//! why it is 100 bits; `link-code-vector.json` is checked by both.

use hkdf::Hkdf;
use sha2::Sha256;

use super::e2e::KEY_BYTES;
use super::encoding::{random_bytes, to_base64url};

/// Crockford's base 32: no I, L, O or U.
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
pub const LINK_CODE_LENGTH: usize = 20;
const SALT: &[u8] = b"magnetar-link-code-v1";
const KEY_ID_BYTES: usize = 9;

/// A new random code, 20 symbols. Each symbol is 5 random bits, so every symbol is equally likely.
pub fn generate() -> String {
    random_bytes(LINK_CODE_LENGTH).into_iter().map(|b| char::from(ALPHABET[usize::from(b & 31)])).collect()
}

/// `XXXXX-XXXXX-XXXXX-XXXXX`, for showing a code.
pub fn format(code: &str) -> String {
    code.as_bytes().chunks(5).map(|group| String::from_utf8_lossy(group).into_owned()).collect::<Vec<_>>().join("-")
}

/// The 100 bits of a code as 13 bytes, the last four bits zero. None for a string that is not 20 symbols of the alphabet.
fn code_bytes(code: &str) -> Option<Vec<u8>> {
    if code.len() != LINK_CODE_LENGTH {
        return None;
    }
    let mut bytes = Vec::with_capacity(13);
    let (mut held, mut bits) = (0u32, 0u32);
    for symbol in code.bytes() {
        held = (held << 5) | ALPHABET.iter().position(|&a| a == symbol)? as u32;
        bits += 5;
        while bits >= 8 {
            bits -= 8;
            bytes.push((held >> bits) as u8);
        }
        held &= (1 << bits) - 1;
    }
    if bits > 0 {
        bytes.push((held << (8 - bits)) as u8);
    }
    Some(bytes)
}

/// The key id and browser key a code stands for; None for a string that is not a code.
pub fn derive(code: &str) -> Option<(String, Vec<u8>)> {
    let hkdf = Hkdf::<Sha256>::new(Some(SALT), &code_bytes(code)?);
    let mut key_id = [0u8; KEY_ID_BYTES];
    let mut key = vec![0u8; KEY_BYTES];
    hkdf.expand(b"key id", &mut key_id).ok()?;
    hkdf.expand(b"key", &mut key).ok()?;
    Some((to_base64url(&key_id), key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::encoding::from_base64url;

    /// Fixed inputs computed by the TypeScript implementation: both ends must derive the same id and key.
    #[test]
    fn matches_the_typescript_vector() {
        let vector: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../../../../packages/protocol/src/link-code-vector.json")).unwrap();
        assert!(vector.len() >= 4);
        for case in vector {
            let (key_id, key) = derive(case["code"].as_str().unwrap()).unwrap();
            assert_eq!(key_id, case["keyId"].as_str().unwrap());
            assert_eq!(key, from_base64url(case["key"].as_str().unwrap()).unwrap());
        }
    }

    #[test]
    fn a_generated_code_is_twenty_symbols_that_differ_each_time() {
        let codes: std::collections::HashSet<_> = (0..500).map(|_| generate()).collect();
        assert_eq!(codes.len(), 500);
        assert!(codes.iter().all(|c| c.len() == 20 && c.bytes().all(|b| ALPHABET.contains(&b))));
        let code = generate();
        let shown = format(&code);
        assert_eq!(shown.len(), 23);
        assert_eq!(shown.replace('-', ""), code);
    }

    #[test]
    fn what_is_not_a_code_stands_for_no_key() {
        assert!(derive("").is_none());
        assert!(derive(&"0".repeat(19)).is_none());
        assert!(derive(&"0".repeat(21)).is_none());
        assert!(derive(&format!("{}U", "0".repeat(19))).is_none(), "U is not in the alphabet");
        assert!(derive(&"o".repeat(20)).is_none(), "the device only ever derives from the spelling it made");
    }

    #[test]
    fn one_symbol_apart_is_another_key() {
        let a = derive("K7QM29TXFAW4HNPZR6BD").unwrap();
        let b = derive("K7QM29TXFAW4HNPZR6BE").unwrap();
        assert_ne!(a.0, b.0);
        assert_ne!(a.1, b.1);
    }
}
