use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rand::rngs::OsRng;
use rand::RngCore;

/// Minimum length for employee passwords. Composition rules are deliberately
/// avoided; length and a server-side blocklist matter more than character
/// classes.
pub const MIN_PASSWORD_LEN: usize = 10;
pub const MAX_PASSWORD_LEN: usize = 200;

pub fn validate_strength(password: &str) -> Result<(), &'static str> {
    let length = password.chars().count();
    if length < MIN_PASSWORD_LEN {
        return Err("密码至少需要 10 个字符");
    }
    if length > MAX_PASSWORD_LEN {
        return Err("密码过长，请控制在 200 个字符以内");
    }
    if password.trim() != password {
        return Err("密码不能以空白字符开头或结尾");
    }
    if is_common_password(password) {
        return Err("这个密码过于常见，请更换为更难猜测的组合");
    }
    Ok(())
}

pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let mut salt_bytes = [0u8; 16];
    OsRng.fill_bytes(&mut salt_bytes);
    let salt = SaltString::encode_b64(&salt_bytes)?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
}

pub fn verify_password(password: &str, stored: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(stored) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

fn is_common_password(password: &str) -> bool {
    const BLOCKED: &[&str] = &[
        "password123",
        "12345678910",
        "qwertyuiop",
        "password1234",
        "administrator",
        "iloveyou123",
    ];
    let lower = password.to_lowercase();
    BLOCKED.iter().any(|candidate| lower == *candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_password() {
        let hash = hash_password("jingche-2026-strong").expect("hash");
        assert!(verify_password("jingche-2026-strong", &hash));
        assert!(!verify_password("jingche-2026-stronger", &hash));
    }

    #[test]
    fn rejects_short_and_padded_passwords() {
        assert!(validate_strength("short").is_err());
        assert!(validate_strength(" leading-space-password").is_err());
        assert!(validate_strength("acceptable-passphrase").is_ok());
    }
}
