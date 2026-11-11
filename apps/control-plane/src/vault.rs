use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{anyhow, Result};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};

const NONCE_LEN: usize = 12;

/// Encrypts provider API keys before they reach the database. The key material
/// is derived from `CONTROL_PLANE_SECRET`, so a database copy alone never
/// exposes a usable gateway credential.
pub struct SecretVault {
    cipher: Aes256Gcm,
}

impl SecretVault {
    pub fn new(secret: &[u8]) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(secret);
        hasher.update(b"|control-plane/gateway-keys");
        let key = hasher.finalize();
        Self {
            cipher: Aes256Gcm::new_from_slice(&key).expect("AES-256 accepts 32-byte keys"),
        }
    }

    pub fn seal(&self, plaintext: &str) -> Result<String> {
        let mut nonce_bytes = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = self
            .cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|_| anyhow!("encrypting gateway credential failed"))?;
        let mut payload = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        payload.extend_from_slice(&nonce_bytes);
        payload.extend_from_slice(&ciphertext);
        Ok(STANDARD.encode(payload))
    }

    pub fn open(&self, sealed: &str) -> Result<String> {
        let raw = STANDARD
            .decode(sealed)
            .map_err(|_| anyhow!("stored credential is not valid base64"))?;
        if raw.len() <= NONCE_LEN {
            return Err(anyhow!("stored credential is truncated"));
        }
        let (nonce_bytes, ciphertext) = raw.split_at(NONCE_LEN);
        let plaintext = self
            .cipher
            .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
            .map_err(|_| anyhow!("decrypting gateway credential failed"))?;
        String::from_utf8(plaintext).map_err(|_| anyhow!("stored credential is not valid UTF-8"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_rejects_other_keys() {
        let vault = SecretVault::new(b"first-secret-value-with-enough-length");
        let sealed = vault.seal("sk-live-1234567890").unwrap();
        assert_eq!(vault.open(&sealed).unwrap(), "sk-live-1234567890");
        assert!(!sealed.contains("sk-live"));

        let other = SecretVault::new(b"second-secret-value-with-enough-length");
        assert!(other.open(&sealed).is_err());
    }
}
