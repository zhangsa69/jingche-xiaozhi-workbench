use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use async_trait::async_trait;
use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};

use super::Mailer;
use crate::auth::codes::Purpose;
use crate::config::{SmtpConfig, SmtpTls};

pub struct SmtpMailer {
    transport: Arc<SmtpTransport>,
    from: Mailbox,
    from_address: String,
    host: String,
    port: u16,
}

impl SmtpMailer {
    pub fn new(config: SmtpConfig, _public_url: String) -> anyhow::Result<Self> {
        let builder = match config.tls {
            SmtpTls::StartTls => SmtpTransport::starttls_relay(&config.host)
                .context("configuring STARTTLS SMTP relay")?,
            SmtpTls::Implicit => {
                SmtpTransport::relay(&config.host).context("configuring implicit TLS SMTP relay")?
            }
            SmtpTls::Insecure => SmtpTransport::builder_dangerous(&config.host),
        };

        let transport = builder
            .port(config.port)
            .credentials(Credentials::new(
                config.username.clone(),
                config.password.clone(),
            ))
            .timeout(Some(Duration::from_secs(20)))
            .build();

        let from_address = config.from_email.clone();
        let from = Mailbox::new(
            Some(config.from_name.clone()),
            config.from_email.parse().with_context(|| {
                format!(
                    "CONTROL_PLANE_SMTP_FROM_EMAIL is not a valid address: {}",
                    config.from_email
                )
            })?,
        );

        Ok(Self {
            transport: Arc::new(transport),
            from,
            from_address,
            host: config.host,
            port: config.port,
        })
    }

    fn build_message(
        &self,
        email: &str,
        code: &str,
        purpose: Purpose,
        ttl_secs: i64,
    ) -> anyhow::Result<Message> {
        let (subject, action) = match purpose {
            Purpose::Register => ("【京车小智工作台】注册验证码", "注册账号"),
            Purpose::Reset => ("【京车小智工作台】密码重置验证码", "重置密码"),
        };
        let minutes = (ttl_secs / 60).max(1);
        let to = email
            .parse()
            .with_context(|| format!("recipient address is invalid: {email}"))?;

        let text = format!(
            "您好：\n\n您正在{action}，验证码为 {code}，{minutes} 分钟内有效。\n\n如果这不是您的操作，请忽略本邮件，您的账户不会受到影响。\n\n—— 京车小智工作台"
        );
        let html = format!(
            r#"<div style="font-family:-apple-system,'Segoe UI','Noto Sans SC',sans-serif;background:#0f172a;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
    <p style="margin:0 0 8px;color:#2563eb;font-size:13px;letter-spacing:.08em">京车小智工作台</p>
    <h1 style="margin:0 0 16px;font-size:22px;color:#0f172a">您正在进行{action}</h1>
    <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.7">请输入下方验证码完成验证，验证码 {minutes} 分钟内有效。</p>
    <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:34px;letter-spacing:10px;color:#0f172a;background:#f1f5f9;border-radius:12px;padding:18px;text-align:center">{code}</div>
    <p style="margin:24px 0 0;color:#64748b;font-size:12px;line-height:1.7">如果这不是您的操作，请忽略本邮件，您的账户不会受到影响。</p>
  </div>
</div>"#
        );

        Message::builder()
            .from(self.from.clone())
            .to(to)
            .subject(subject)
            .multipart(lettre::message::MultiPart::alternative_plain_html(
                text, html,
            ))
            .context("building verification email")
    }
}

#[async_trait]
impl Mailer for SmtpMailer {
    async fn send_verification_code(
        &self,
        email: &str,
        code: &str,
        purpose: Purpose,
        ttl_secs: i64,
    ) -> anyhow::Result<()> {
        let message = self.build_message(email, code, purpose, ttl_secs)?;
        let transport = self.transport.clone();
        let recipient = email.to_string();

        tokio::task::spawn_blocking(move || transport.send(&message))
            .await
            .context("SMTP send task panicked")?
            .with_context(|| format!("sending verification code to {recipient}"))?;
        Ok(())
    }

    fn describe(&self) -> String {
        format!(
            "SMTP {}:{} (from {})",
            self.host, self.port, self.from_address
        )
    }
}
