use async_trait::async_trait;

use super::Mailer;
use crate::auth::codes::Purpose;

/// Development transport. It never leaves the process, so it is only useful
/// until SMTP credentials are configured on the server.
pub struct StdoutMailer;

impl StdoutMailer {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Mailer for StdoutMailer {
    async fn send_verification_code(
        &self,
        email: &str,
        code: &str,
        purpose: Purpose,
        ttl_secs: i64,
    ) -> anyhow::Result<()> {
        tracing::warn!(
            email,
            purpose = purpose.as_str(),
            code,
            ttl_seconds = ttl_secs,
            "development mail transport: verification code printed instead of emailed"
        );
        Ok(())
    }

    fn describe(&self) -> String {
        "development log transport (no SMTP configured)".to_string()
    }
}
