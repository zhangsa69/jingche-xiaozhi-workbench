mod api;
mod auth;
mod config;
mod db;
mod domain;
mod error;
mod mail;
mod state;
mod util;
mod vault;

use std::net::SocketAddr;

use anyhow::{bail, Context, Result};
use rand::Rng;
use tracing_subscriber::EnvFilter;

use crate::auth::codes::Purpose;
use crate::config::Config;
use crate::db::Db;
use crate::mail::{Mailer, SmtpMailer};
use crate::state::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let args: Vec<String> = std::env::args().collect();
    if let Some(position) = args.iter().position(|arg| arg == "--check-mail") {
        let recipient = args.get(position + 1).map(String::as_str).context(
            "usage: control-plane --check-mail <recipient>  (reads CONTROL_PLANE_SMTP_*)",
        )?;
        return check_mail(recipient).await;
    }

    let config = Config::from_env(None).context("invalid control plane configuration")?;
    let db_path = config.db_path();
    let db =
        Db::open(&db_path).with_context(|| format!("opening database {}", db_path.display()))?;
    let mailer = mail::build(&config);
    let addr = config.addr;
    let web_dir = config.web_dir.clone();

    tracing::info!(
        database = %db_path.display(),
        web_dir = %web_dir.display(),
        registration_open = config.registration_open,
        "starting control plane"
    );

    let state = AppState::new(config, db, mailer);
    let app = api::router(state, web_dir);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("binding {addr}"))?;
    tracing::info!(%addr, "control plane listening");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .context("serving HTTP traffic")?;

    tracing::info!("control plane stopped");
    Ok(())
}

/// Sends one real message through the configured SMTP relay.
///
/// Operators run this after changing credentials: it bypasses the development
/// log fallback on purpose, so a broken relay fails the command instead of
/// quietly writing the code to the service log. Nothing secret is printed —
/// only the relay endpoint, the transport flavour and the outcome.
async fn check_mail(recipient: &str) -> Result<()> {
    let config = Config::from_env(None).context("invalid control plane configuration")?;
    let Some(smtp) = config.smtp.clone() else {
        bail!(
            "CONTROL_PLANE_SMTP_* is not configured; the service would fall back to the development log transport"
        );
    };

    let mailer = SmtpMailer::new(smtp.clone(), config.public_url.clone())
        .context("SMTP configuration is invalid")?;
    let code: u32 = rand::thread_rng().gen_range(0..1_000_000);
    let code = format!("{code:06}");

    tracing::info!(
        host = %smtp.host,
        port = smtp.port,
        tls = ?smtp.tls,
        "sending SMTP self-check"
    );
    mailer
        .send_verification_code(recipient, &code, Purpose::Register, 600)
        .await
        .with_context(|| format!("SMTP self-check to {recipient} failed"))?;
    tracing::info!(recipient, "SMTP self-check delivered");
    Ok(())
}

fn init_tracing() {
    use std::io::IsTerminal;

    let filter =
        EnvFilter::try_from_env("CONTROL_PLANE_LOG").unwrap_or_else(|_| EnvFilter::new("info"));
    // journald and file sinks capture plain text; ANSI escapes only when a
    // terminal is attached.
    let ansi = std::io::stdout().is_terminal();
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_ansi(ansi)
        .with_writer(std::io::stdout)
        .init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(%error, "listening for Ctrl+C failed");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                tracing::error!(%error, "installing SIGTERM handler failed");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown signal received");
}
