mod smtp;
mod stdout;

use async_trait::async_trait;

use crate::auth::codes::Purpose;
use crate::config::Config;

pub use smtp::SmtpMailer;
pub use stdout::StdoutMailer;

/// Transport abstraction for verification mail. Implementations must never log
/// the SMTP password or the full message body outside of a development logger.
#[async_trait]
pub trait Mailer: Send + Sync {
    async fn send_verification_code(
        &self,
        email: &str,
        code: &str,
        purpose: Purpose,
        ttl_secs: i64,
    ) -> anyhow::Result<()>;

    /// Short human-readable transport description for the admin system page.
    fn describe(&self) -> String;
}

pub fn build(config: &Config) -> std::sync::Arc<dyn Mailer> {
    match &config.smtp {
        Some(smtp_config) => {
            match SmtpMailer::new(smtp_config.clone(), config.public_url.clone()) {
                Ok(mailer) => {
                    tracing::info!(host = %smtp_config.host, port = smtp_config.port, "SMTP mail transport ready");
                    std::sync::Arc::new(mailer)
                }
                Err(error) => {
                    tracing::error!(%error, "SMTP transport configuration is invalid; falling back to stdout");
                    std::sync::Arc::new(StdoutMailer::new())
                }
            }
        }
        None => {
            tracing::warn!(
                "no SMTP configuration found; verification codes are written to the service log for development use"
            );
            std::sync::Arc::new(StdoutMailer::new())
        }
    }
}
