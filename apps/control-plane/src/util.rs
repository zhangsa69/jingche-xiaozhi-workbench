use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, SecondsFormat, Utc};
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};

/// One Xiaozhi bean equals this many milli-beans. Quota math stays integral so
/// concurrent deductions remain exact.
pub const MILLIBEANS_PER_BEAN: i64 = 1_000;

pub fn now() -> DateTime<Utc> {
    Utc::now()
}

pub fn iso(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(SecondsFormat::Secs, true)
}

pub fn now_iso() -> String {
    iso(now())
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    OsRng.fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

pub fn sha256_hex(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn normalize_email(value: &str) -> String {
    value.trim().to_lowercase()
}

/// Minimal structural email validation. Deliverability is proven by the
/// verification code, not by a regex.
pub fn is_valid_email(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.len() < 6 || trimmed.len() > 254 {
        return false;
    }
    if trimmed.contains(char::is_whitespace) {
        return false;
    }
    let mut parts = trimmed.split('@');
    let (Some(local), Some(domain), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    if local.is_empty() || domain.is_empty() {
        return false;
    }
    domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
}

pub fn millibeans_to_beans(value: i64) -> f64 {
    (value as f64) / (MILLIBEANS_PER_BEAN as f64)
}

pub fn beans_to_millibeans(value: f64) -> i64 {
    (value * MILLIBEANS_PER_BEAN as f64).round() as i64
}

/// Converts provider token counts into milli-beans using the server policy.
pub fn tokens_to_millibeans(
    prompt: i64,
    completion: i64,
    per_1k_prompt: i64,
    per_1k_completion: i64,
) -> i64 {
    let prompt_part = ceil_div(prompt.max(0) * per_1k_prompt.max(0), 1_000);
    let completion_part = ceil_div(completion.max(0) * per_1k_completion.max(0), 1_000);
    prompt_part.saturating_add(completion_part)
}

fn ceil_div(value: i64, divisor: i64) -> i64 {
    if divisor <= 0 {
        return 0;
    }
    (value + divisor - 1) / divisor
}

pub fn mask_secret(secret: &str) -> String {
    let trimmed = secret.trim();
    if trimmed.len() <= 4 {
        return "****".to_string();
    }
    let tail: String = trimmed
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("****{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_validation_rejects_malformed_values() {
        assert!(is_valid_email("employee@company.com"));
        assert!(!is_valid_email("employee@company"));
        assert!(!is_valid_email("employee company@x.com"));
        assert!(!is_valid_email("@company.com"));
    }

    #[test]
    fn token_conversion_rounds_up_partial_chunks() {
        assert_eq!(tokens_to_millibeans(1000, 0, 1000, 3000), 1000);
        assert_eq!(tokens_to_millibeans(1, 0, 1000, 3000), 1);
        assert_eq!(tokens_to_millibeans(0, 500, 1000, 3000), 1500);
    }

    #[test]
    fn secret_masking_keeps_only_the_tail() {
        assert_eq!(mask_secret("sk-abcdef1234"), "****1234");
        assert_eq!(mask_secret("abc"), "****");
    }
}
