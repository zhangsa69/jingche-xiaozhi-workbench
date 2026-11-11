use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::{bail, Context, Result};

/// Runtime configuration. Every value comes from the environment so the same
/// binary runs unchanged on a Linux server, in staging, and in tests.
#[derive(Clone, Debug)]
pub struct Config {
    pub addr: SocketAddr,
    pub data_dir: PathBuf,
    pub web_dir: PathBuf,
    pub public_url: String,
    pub secret: Vec<u8>,
    pub access_token_ttl_secs: i64,
    pub refresh_token_ttl_days: i64,
    /// Upper bound for the desktop gateway token; the session expiry caps it.
    pub gateway_token_ttl_days: i64,
    pub code_ttl_secs: i64,
    pub code_resend_cooldown_secs: i64,
    pub code_max_per_hour: i64,
    pub code_max_attempts: i64,
    pub login_max_failures: i64,
    pub registration_open: bool,
    pub admin_emails: Vec<String>,
    pub trust_proxy: bool,
    pub smtp: Option<SmtpConfig>,
}

#[derive(Clone, Debug)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub from_email: String,
    pub from_name: String,
    /// `starttls` (587), `implicit` (465), or `insecure` for a local relay.
    pub tls: SmtpTls,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SmtpTls {
    StartTls,
    Implicit,
    Insecure,
}

impl Config {
    pub fn from_env(web_dir_override: Option<PathBuf>) -> Result<Self> {
        let addr = env_or("CONTROL_PLANE_ADDR", "127.0.0.1:8787")
            .parse::<SocketAddr>()
            .context("CONTROL_PLANE_ADDR must be a host:port socket address")?;

        let data_dir = PathBuf::from(env_or("CONTROL_PLANE_DATA_DIR", "./data"));
        let web_dir = web_dir_override
            .unwrap_or_else(|| PathBuf::from(env_or("CONTROL_PLANE_WEB_DIR", "./web/dist")));

        let secret_raw = std::env::var("CONTROL_PLANE_SECRET").unwrap_or_default();
        if secret_raw.trim().len() < 32 {
            bail!(
                "CONTROL_PLANE_SECRET must be set to at least 32 characters; it signs access tokens and encrypts stored gateway keys"
            );
        }

        let public_url = env_or("CONTROL_PLANE_PUBLIC_URL", "http://127.0.0.1:8787");
        let trust_proxy = env_flag("CONTROL_PLANE_TRUST_PROXY", false);
        let registration_open = env_flag("CONTROL_PLANE_REGISTRATION_OPEN", true);

        let admin_emails = std::env::var("CONTROL_PLANE_ADMIN_EMAILS")
            .unwrap_or_default()
            .split(',')
            .map(crate::util::normalize_email)
            .filter(|value| !value.is_empty())
            .collect();

        Ok(Self {
            addr,
            data_dir,
            web_dir,
            public_url,
            secret: secret_raw.into_bytes(),
            access_token_ttl_secs: env_i64("CONTROL_PLANE_ACCESS_TTL_SECONDS", 900, 60, 86_400),
            refresh_token_ttl_days: env_i64("CONTROL_PLANE_REFRESH_TTL_DAYS", 30, 1, 365),
            gateway_token_ttl_days: env_i64("CONTROL_PLANE_GATEWAY_TOKEN_DAYS", 30, 1, 365),
            code_ttl_secs: env_i64("CONTROL_PLANE_CODE_TTL_SECONDS", 600, 60, 3_600),
            code_resend_cooldown_secs: env_i64(
                "CONTROL_PLANE_CODE_COOLDOWN_SECONDS",
                60,
                10,
                3_600,
            ),
            code_max_per_hour: env_i64("CONTROL_PLANE_CODE_MAX_PER_HOUR", 5, 1, 60),
            code_max_attempts: env_i64("CONTROL_PLANE_CODE_MAX_ATTEMPTS", 5, 1, 20),
            login_max_failures: env_i64("CONTROL_PLANE_LOGIN_MAX_FAILURES", 10, 3, 100),
            registration_open,
            admin_emails,
            trust_proxy,
            smtp: SmtpConfig::from_env()?,
        })
    }

    pub fn db_path(&self) -> PathBuf {
        if let Ok(explicit) = std::env::var("CONTROL_PLANE_DB_PATH") {
            if !explicit.trim().is_empty() {
                return PathBuf::from(explicit);
            }
        }
        self.data_dir.join("control-plane.db")
    }

    pub fn max_body_bytes(&self) -> usize {
        256 * 1024
    }
}

impl SmtpConfig {
    fn from_env() -> Result<Option<Self>> {
        let host = std::env::var("CONTROL_PLANE_SMTP_HOST")
            .unwrap_or_default()
            .trim()
            .to_string();
        let username = std::env::var("CONTROL_PLANE_SMTP_USERNAME")
            .unwrap_or_default()
            .trim()
            .to_string();
        // Mail providers show app passwords grouped in fours ("abcd efgh …");
        // the spaces are presentation only and must not be sent to the server.
        let password: String = std::env::var("CONTROL_PLANE_SMTP_PASSWORD")
            .unwrap_or_default()
            .split_whitespace()
            .collect();
        let from_email = std::env::var("CONTROL_PLANE_SMTP_FROM_EMAIL")
            .unwrap_or_default()
            .trim()
            .to_string();

        if host.is_empty() && username.is_empty() && password.is_empty() {
            return Ok(None);
        }
        if host.is_empty() || username.is_empty() || password.is_empty() || from_email.is_empty() {
            bail!(
                "SMTP configuration is incomplete: CONTROL_PLANE_SMTP_HOST, _USERNAME, _PASSWORD, and _FROM_EMAIL must all be set"
            );
        }
        let tls = match env_or("CONTROL_PLANE_SMTP_TLS", "starttls")
            .to_lowercase()
            .as_str()
        {
            "implicit" | "tls" | "wrapper" => SmtpTls::Implicit,
            "insecure" | "none" => SmtpTls::Insecure,
            _ => SmtpTls::StartTls,
        };
        let default_port = match tls {
            SmtpTls::Implicit => 465,
            _ => 587,
        };
        Ok(Some(Self {
            host,
            port: env_i64("CONTROL_PLANE_SMTP_PORT", default_port, 1, 65_535) as u16,
            username,
            password,
            from_email,
            from_name: env_or("CONTROL_PLANE_SMTP_FROM_NAME", "京车小智工作台"),
            tls,
        }))
    }
}

fn env_or(key: &str, fallback: &str) -> String {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn env_i64(key: &str, fallback: i64, min: i64, max: i64) -> i64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<i64>().ok())
        .map(|value| value.clamp(min, max))
        .unwrap_or(fallback)
}

fn env_flag(key: &str, fallback: bool) -> bool {
    match std::env::var(key) {
        Ok(value) => match value.trim().to_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => true,
            "0" | "false" | "no" | "off" => false,
            _ => fallback,
        },
        Err(_) => fallback,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_secret_is_rejected() {
        std::env::remove_var("CONTROL_PLANE_SECRET");
        let error = Config::from_env(None).expect_err("secret is mandatory");
        assert!(error.to_string().contains("CONTROL_PLANE_SECRET"));
    }

    #[test]
    fn short_secret_is_rejected() {
        std::env::set_var("CONTROL_PLANE_SECRET", "too-short");
        let result = Config::from_env(None);
        std::env::remove_var("CONTROL_PLANE_SECRET");
        assert!(result.is_err());
    }
}
