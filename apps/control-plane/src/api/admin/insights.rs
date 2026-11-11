use std::sync::Arc;

use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use super::Page;
use crate::api::helpers::{trim_optional, Pagination};
use crate::auth::AuthUser;
use crate::domain::gateways::{self, GatewayView};
use crate::domain::quota::{self, DailyUsage, LedgerEntry, PolicyView};
use crate::error::{ok, ApiError, Envelope};
use crate::state::AppState;
use crate::util::{millibeans_to_beans, now};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserTotals {
    pub total: i64,
    pub active: i64,
    pub disabled: i64,
    pub admins: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayTotals {
    pub beans: f64,
    pub requests: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodTotals {
    pub label: String,
    pub used_beans: f64,
    pub limit_beans: f64,
    pub resets_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub actor_email: Option<String>,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub detail: Option<String>,
    pub ip: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewResponse {
    pub users: UserTotals,
    pub today: TodayTotals,
    pub period: PeriodTotals,
    pub total_balance_beans: f64,
    pub trend: Vec<DailyUsage>,
    pub gateway: Option<GatewayView>,
    pub recent_audit: Vec<AuditEntry>,
    pub policy: PolicyView,
}

pub async fn overview(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<Json<Envelope<OverviewResponse>>, ApiError> {
    auth.require_admin()?;
    let today_start = quota::period_start("daily");

    let data = state
        .db
        .call(move |conn| {
            let users = UserTotals {
                total: conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?,
                active: conn.query_row("SELECT COUNT(*) FROM users WHERE status = 'active'", [], |row| row.get(0))?,
                disabled: conn.query_row("SELECT COUNT(*) FROM users WHERE status = 'disabled'", [], |row| row.get(0))?,
                admins: conn.query_row("SELECT COUNT(*) FROM users WHERE role = 'admin'", [], |row| row.get(0))?,
            };
            let (today_beans, today_requests): (i64, i64) = conn.query_row(
                "SELECT COALESCE(SUM(millibeans), 0), COUNT(*) FROM usage_events WHERE created_at >= ?1",
                rusqlite::params![today_start],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let total_balance: i64 =
                conn.query_row("SELECT COALESCE(SUM(balance_millibeans), 0) FROM quota_accounts", [], |row| row.get(0))?;
            let policy = quota::load_policy(conn)?;
            let period_used: i64 = conn.query_row(
                "SELECT COALESCE(SUM(millibeans), 0) FROM usage_events WHERE created_at >= ?1",
                rusqlite::params![quota::period_start(&policy.period)],
                |row| row.get(0),
            )?;
            let trend = quota::usage_trend(conn, 14)?;
            let gateway = gateways::find_default(conn)?;
            let mut statement = conn.prepare(
                "SELECT id, actor_email, action, target_type, target_id, detail, ip, created_at
                 FROM audit_log ORDER BY created_at DESC LIMIT 8",
            )?;
            let rows = statement.query_map([], |row| {
                Ok(AuditEntry {
                    id: row.get(0)?,
                    actor_email: row.get(1)?,
                    action: row.get(2)?,
                    target_type: row.get(3)?,
                    target_id: row.get(4)?,
                    detail: row.get(5)?,
                    ip: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })?;
            let mut recent_audit = Vec::new();
            for row in rows {
                recent_audit.push(row?);
            }
            Ok((users, today_beans, today_requests, total_balance, policy, period_used, trend, gateway, recent_audit))
        })
        .await?;

    let (
        users,
        today_beans,
        today_requests,
        total_balance,
        policy,
        period_used,
        trend,
        gateway,
        recent_audit,
    ) = data;

    Ok(ok(OverviewResponse {
        users,
        today: TodayTotals {
            beans: millibeans_to_beans(today_beans),
            requests: today_requests,
        },
        period: PeriodTotals {
            label: match policy.period.as_str() {
                "daily" => "今日周期".to_string(),
                "monthly" => "本月周期".to_string(),
                _ => "不限制周期".to_string(),
            },
            used_beans: millibeans_to_beans(period_used),
            limit_beans: millibeans_to_beans(policy.period_millibeans),
            resets_at: quota::period_reset_at(&policy.period),
        },
        total_balance_beans: millibeans_to_beans(total_balance),
        trend,
        gateway: gateway.map(|record| record.view()),
        recent_audit,
        policy: policy.view(),
    }))
}

pub async fn get_policy(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<Json<Envelope<PolicyView>>, ApiError> {
    auth.require_admin()?;
    let policy = state.db.call(|conn| quota::load_policy(conn)).await?;
    Ok(ok(policy.view()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyRequest {
    pub beans_per_1k_prompt: f64,
    pub beans_per_1k_completion: f64,
    pub period: String,
    pub period_beans: f64,
    pub default_grant_beans: f64,
}

pub async fn put_policy(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(body): Json<PolicyRequest>,
) -> Result<Json<Envelope<PolicyView>>, ApiError> {
    auth.require_admin()?;

    if !["none", "daily", "monthly"].contains(&body.period.as_str()) {
        return Err(ApiError::bad_request("周期只能是 none、daily 或 monthly"));
    }
    for value in [
        body.beans_per_1k_prompt,
        body.beans_per_1k_completion,
        body.period_beans,
        body.default_grant_beans,
    ] {
        if !value.is_finite() || value < 0.0 {
            return Err(ApiError::bad_request("配额参数必须是非负数字"));
        }
        if value > 1_000_000.0 {
            return Err(ApiError::bad_request("配额参数过大"));
        }
    }
    if body.period != "none" && body.period_beans <= 0.0 {
        return Err(ApiError::bad_request("启用周期限制时，周期额度必须大于 0"));
    }

    let prompt = crate::util::beans_to_millibeans(body.beans_per_1k_prompt);
    let completion = crate::util::beans_to_millibeans(body.beans_per_1k_completion);
    let period_millibeans = crate::util::beans_to_millibeans(body.period_beans);
    let default_grant = crate::util::beans_to_millibeans(body.default_grant_beans);
    let period = body.period.clone();
    let actor = auth.user_id.clone();

    state
        .db
        .call(move |conn| {
            quota::save_policy(
                conn,
                prompt,
                completion,
                &period,
                period_millibeans,
                default_grant,
                Some(&actor),
            )
        })
        .await?;

    state.record_audit(
        Some((&auth.user_id, &auth.email)),
        "admin.quota_policy_updated",
        Some(("policy", "1")),
        Some(serde_json::json!({
            "beansPer1kPrompt": body.beans_per_1k_prompt,
            "beansPer1kCompletion": body.beans_per_1k_completion,
            "period": body.period,
            "periodBeans": body.period_beans,
            "defaultGrantBeans": body.default_grant_beans,
        })),
        None,
    );

    let policy = state.db.call(|conn| quota::load_policy(conn)).await?;
    Ok(ok(policy.view()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerQuery {
    #[serde(flatten)]
    pub pagination: Pagination,
    pub user_id: Option<String>,
}

pub async fn ledger(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Query(query): Query<LedgerQuery>,
) -> Result<Json<Envelope<Page<LedgerEntry>>>, ApiError> {
    auth.require_admin()?;
    let (page, page_size) = query.pagination.resolve();
    let user_id = trim_optional(query.user_id);
    let (items, total) = state
        .db
        .call(move |conn| quota::ledger_page(conn, user_id.as_deref(), page, page_size))
        .await?;
    Ok(ok(Page {
        items,
        total,
        page,
        page_size,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditQuery {
    #[serde(flatten)]
    pub pagination: Pagination,
    pub action: Option<String>,
    pub query: Option<String>,
}

pub async fn audit(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Query(query): Query<AuditQuery>,
) -> Result<Json<Envelope<Page<AuditEntry>>>, ApiError> {
    auth.require_admin()?;
    let (page, page_size) = query.pagination.resolve();
    let offset = (page - 1) * page_size;
    let action = trim_optional(query.action);
    let search = trim_optional(query.query).map(|value| format!("%{}%", value.to_lowercase()));

    let (items, total) = state
        .db
        .call(move |conn| {
            let total: i64 = conn.query_row(
                "SELECT COUNT(*) FROM audit_log
                 WHERE (?1 IS NULL OR action = ?1)
                   AND (?2 IS NULL OR lower(COALESCE(actor_email, '')) LIKE ?2 OR lower(action) LIKE ?2)",
                rusqlite::params![action, search],
                |row| row.get(0),
            )?;
            let mut statement = conn.prepare(
                "SELECT id, actor_email, action, target_type, target_id, detail, ip, created_at
                 FROM audit_log
                 WHERE (?1 IS NULL OR action = ?1)
                   AND (?2 IS NULL OR lower(COALESCE(actor_email, '')) LIKE ?2 OR lower(action) LIKE ?2)
                 ORDER BY created_at DESC LIMIT ?3 OFFSET ?4",
            )?;
            let rows = statement.query_map(rusqlite::params![action, search, page_size, offset], |row| {
                Ok(AuditEntry {
                    id: row.get(0)?,
                    actor_email: row.get(1)?,
                    action: row.get(2)?,
                    target_type: row.get(3)?,
                    target_id: row.get(4)?,
                    detail: row.get(5)?,
                    ip: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })?;
            let mut items = Vec::new();
            for row in rows {
                items.push(row?);
            }
            Ok((items, total))
        })
        .await?;

    Ok(ok(Page {
        items,
        total,
        page,
        page_size,
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemResponse {
    pub version: String,
    pub uptime_seconds: i64,
    pub schema_version: i64,
    pub mail_transport: String,
    pub smtp_configured: bool,
    pub registration_open: bool,
    pub database_bytes: u64,
    pub gateway_count: i64,
    pub ledger_entries: i64,
    pub audit_entries: i64,
    pub server_time: String,
    pub build_profile: &'static str,
}

pub async fn system(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<Json<Envelope<SystemResponse>>, ApiError> {
    auth.require_admin()?;
    let counts = state
        .db
        .call(|conn| {
            let gateway_count: i64 =
                conn.query_row("SELECT COUNT(*) FROM gateways", [], |row| row.get(0))?;
            let ledger_entries: i64 =
                conn.query_row("SELECT COUNT(*) FROM quota_ledger", [], |row| row.get(0))?;
            let audit_entries: i64 =
                conn.query_row("SELECT COUNT(*) FROM audit_log", [], |row| row.get(0))?;
            let schema_version: i64 =
                conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
            Ok((gateway_count, ledger_entries, audit_entries, schema_version))
        })
        .await?;

    let database_bytes = std::fs::metadata(state.config.db_path())
        .map(|meta| meta.len())
        .unwrap_or(0);

    Ok(ok(SystemResponse {
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_seconds: (now() - state.started_at).num_seconds(),
        schema_version: counts.3,
        mail_transport: state.mailer.describe(),
        smtp_configured: state.config.smtp.is_some(),
        registration_open: state.config.registration_open,
        database_bytes,
        gateway_count: counts.0,
        ledger_entries: counts.1,
        audit_entries: counts.2,
        server_time: crate::util::now_iso(),
        build_profile: if cfg!(debug_assertions) {
            "development"
        } else {
            "release"
        },
    }))
}
