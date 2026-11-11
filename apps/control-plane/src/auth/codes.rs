use chrono::Duration;
use rand::Rng;

use crate::error::ApiError;
use crate::state::AppState;
use crate::util::{iso, new_id, now, now_iso};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    Register,
    Reset,
}

impl Purpose {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Register => "register",
            Self::Reset => "reset",
        }
    }
}

/// Issues a six-digit code for the mailbox, enforcing cooldown and hourly caps
/// before any mail is sent.
pub async fn request_code(
    state: &AppState,
    email: &str,
    purpose: Purpose,
    ip: Option<String>,
) -> Result<(), ApiError> {
    let normalized = crate::util::normalize_email(email);
    if !crate::util::is_valid_email(&normalized) {
        return Err(ApiError::bad_request("请输入有效的企业邮箱地址"));
    }

    let config = state.config.clone();
    let cooldown = config.code_resend_cooldown_secs;
    let hourly_cap = config.code_max_per_hour;
    let ttl = config.code_ttl_secs;
    let purpose_key = purpose.as_str().to_string();
    let email_for_db = normalized.clone();

    let recent = state
        .db
        .call(move |conn| {
            let since = iso(now() - Duration::hours(1));
            let last_created: Option<String> = conn
                .query_row(
                    "SELECT created_at FROM email_codes WHERE email = ?1 AND purpose = ?2 ORDER BY created_at DESC LIMIT 1",
                    rusqlite::params![email_for_db, purpose_key],
                    |row| row.get(0),
                )
                .ok();
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM email_codes WHERE email = ?1 AND purpose = ?2 AND created_at >= ?3",
                rusqlite::params![email_for_db, purpose_key, since],
                |row| row.get(0),
            )?;
            Ok((last_created, count))
        })
        .await?;

    if let Some(last) = recent.0 {
        let wait = cooldown - (now().timestamp() - parse_iso(&last));
        if wait > 0 {
            return Err(ApiError::too_many_requests(format!(
                "验证码发送过于频繁，请 {wait} 秒后重试"
            )));
        }
    }
    if recent.1 >= hourly_cap {
        return Err(ApiError::too_many_requests(
            "该邮箱一小时内请求验证码次数过多，请稍后再试",
        ));
    }

    let code = generate_code();
    let digest = state.tokens.code_digest(&code);
    let expires_at = iso(now() + Duration::seconds(ttl));
    let code_id = new_id();
    let created_at = now_iso();
    let email_for_insert = normalized.clone();
    let purpose_for_insert = purpose.as_str().to_string();

    state
        .db
        .call(move |conn| {
            conn.execute(
                "INSERT INTO email_codes (id, email, purpose, code_hash, expires_at, attempts, requested_ip, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
                rusqlite::params![
                    code_id,
                    email_for_insert,
                    purpose_for_insert,
                    digest,
                    expires_at,
                    ip,
                    created_at
                ],
            )?;
            Ok(())
        })
        .await?;

    state
        .mailer
        .send_verification_code(&normalized, &code, purpose, ttl)
        .await
        .map_err(|error| {
            tracing::error!(%error, "sending verification code");
            ApiError::service_unavailable("验证码邮件发送失败，请联系管理员检查邮件服务配置")
        })
}

/// Validates and consumes a code. Each failed attempt is persisted so a stolen
/// mailbox cannot be brute-forced within the code lifetime.
pub async fn consume_code(
    state: &AppState,
    email: &str,
    purpose: Purpose,
    code: &str,
) -> Result<(), ApiError> {
    let normalized = crate::util::normalize_email(email);
    let submitted = code.trim();
    if submitted.is_empty() {
        return Err(ApiError::bad_request("请输入邮箱验证码"));
    }
    let digest = state.tokens.code_digest(submitted);
    let max_attempts = state.config.code_max_attempts;
    let purpose_key = purpose.as_str().to_string();

    let outcome = state
        .db
        .call(move |conn| {
            let row = conn
                .query_row(
                    "SELECT id, code_hash, attempts, expires_at FROM email_codes
                     WHERE email = ?1 AND purpose = ?2 AND consumed_at IS NULL
                     ORDER BY created_at DESC LIMIT 1",
                    rusqlite::params![normalized, purpose_key],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    },
                )
                .ok();

            let Some((id, stored_hash, attempts, expires_at)) = row else {
                return Ok(Outcome::Missing);
            };
            if attempts >= max_attempts {
                return Ok(Outcome::Exhausted);
            }
            if parse_iso(&expires_at) <= now().timestamp() {
                return Ok(Outcome::Expired);
            }
            if stored_hash != digest {
                conn.execute(
                    "UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?1",
                    [&id],
                )?;
                return Ok(Outcome::Mismatch);
            }
            conn.execute(
                "UPDATE email_codes SET consumed_at = ?1, attempts = attempts + 1 WHERE id = ?2",
                rusqlite::params![now_iso(), id],
            )?;
            Ok(Outcome::Consumed)
        })
        .await?;

    match outcome {
        Outcome::Consumed => Ok(()),
        Outcome::Missing => Err(ApiError::bad_request("验证码不存在，请重新获取")),
        Outcome::Expired => Err(ApiError::bad_request("验证码已过期，请重新获取")),
        Outcome::Exhausted => Err(ApiError::too_many_requests(
            "验证码尝试次数过多，请重新获取",
        )),
        Outcome::Mismatch => Err(ApiError::bad_request("验证码不正确")),
    }
}

enum Outcome {
    Consumed,
    Missing,
    Expired,
    Exhausted,
    Mismatch,
}

fn generate_code() -> String {
    let value: u32 = rand::thread_rng().gen_range(0..1_000_000);
    format!("{value:06}")
}

fn parse_iso(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.timestamp())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_codes_are_six_digits() {
        for _ in 0..50 {
            let code = generate_code();
            assert_eq!(code.len(), 6);
            assert!(code.chars().all(|c| c.is_ascii_digit()));
        }
    }

    #[test]
    fn rfc3339_timestamps_round_trip() {
        let stamp = now_iso();
        assert_eq!(parse_iso(&stamp), now().timestamp());
    }
}
