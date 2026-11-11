use std::sync::Arc;

use chrono::{DateTime, Utc};

use crate::auth::guard::LoginGuard;
use crate::auth::tokens::TokenService;
use crate::config::Config;
use crate::db::Db;
use crate::mail::Mailer;
use crate::vault::SecretVault;

/// Shared application state. Every field is immutable after startup so handler
/// concurrency cannot observe partially initialized services.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub db: Db,
    pub tokens: Arc<TokenService>,
    pub mailer: Arc<dyn Mailer>,
    pub vault: Arc<SecretVault>,
    pub login_guard: Arc<LoginGuard>,
    pub started_at: DateTime<Utc>,
}

impl AppState {
    pub fn new(config: Config, db: Db, mailer: Arc<dyn Mailer>) -> Self {
        let tokens = Arc::new(TokenService::new(&config.secret));
        let vault = Arc::new(SecretVault::new(&config.secret));
        Self {
            config: Arc::new(config),
            db,
            tokens,
            mailer,
            vault,
            login_guard: Arc::new(LoginGuard::new()),
            started_at: Utc::now(),
        }
    }

    pub fn record_audit(
        &self,
        actor: Option<(&str, &str)>,
        action: &str,
        target: Option<(&str, &str)>,
        detail: Option<serde_json::Value>,
        ip: Option<String>,
    ) {
        let (actor_id, actor_email) = match actor {
            Some((id, email)) => (Some(id.to_string()), Some(email.to_string())),
            None => (None, None),
        };
        let (target_type, target_id) = match target {
            Some((kind, id)) => (Some(kind.to_string()), Some(id.to_string())),
            None => (None, None),
        };
        let detail_text = detail.map(|value| value.to_string());
        let db = self.db.clone();
        let action = action.to_string();
        let created_at = crate::util::now_iso();
        let id = crate::util::new_id();

        tokio::spawn(async move {
            let result = db
                .call(move |conn| {
                    conn.execute(
                        "INSERT INTO audit_log (id, actor_user_id, actor_email, action, target_type, target_id, detail, ip, created_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                        rusqlite::params![
                            id,
                            actor_id,
                            actor_email,
                            action,
                            target_type,
                            target_id,
                            detail_text,
                            ip,
                            created_at
                        ],
                    )?;
                    Ok(())
                })
                .await;
            if let Err(error) = result {
                tracing::error!(%error, "writing audit entry failed");
            }
        });
    }
}
