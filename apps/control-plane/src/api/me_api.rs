use std::sync::Arc;

use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::domain::quota::{self, DailyUsage, QuotaSnapshot};
use crate::domain::{gateways, users};
use crate::error::{ok, ApiError, Envelope};
use crate::state::AppState;
use crate::util::iso;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewaySummary {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub base_url: String,
    pub model: Option<String>,
    pub enabled: bool,
    pub proxy_endpoint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    pub name: String,
    pub version: String,
    pub mail_transport: String,
    pub proxy_enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeResponse {
    pub user: users::UserView,
    pub quota: QuotaSnapshot,
    pub gateway: Option<GatewaySummary>,
    pub service: ServiceInfo,
    pub quota_policy: quota::PolicyView,
}

pub async fn me(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<Json<Envelope<MeResponse>>, ApiError> {
    let user_id = auth.user_id.clone();
    let today = quota::period_start("daily");
    let user = state
        .db
        .call(move |conn| users::view(conn, &user_id, &today))
        .await?
        .ok_or_else(|| ApiError::not_found("用户不存在"))?;

    let user_id = auth.user_id.clone();
    let data = state
        .db
        .call(move |conn| {
            let policy = quota::load_policy(conn)?;
            let snapshot = quota::snapshot(conn, &user_id, &policy)?;
            let gateway = gateways::find_default(conn)?;
            Ok((policy, snapshot, gateway))
        })
        .await?;

    let (policy, snapshot, gateway) = data;
    let proxy_endpoint = format!(
        "{}/api/v1/gateway/chat/completions",
        state.config.public_url.trim_end_matches('/')
    );

    Ok(ok(MeResponse {
        user,
        quota: snapshot,
        gateway: gateway.map(|record| GatewaySummary {
            id: record.id,
            name: record.name,
            provider: record.provider,
            base_url: record.base_url,
            model: record.model,
            enabled: record.enabled,
            proxy_endpoint,
        }),
        service: ServiceInfo {
            name: "京车小智工作台管控中心".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            mail_transport: state.mailer.describe(),
            proxy_enabled: true,
        },
        quota_policy: policy.view(),
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageQuery {
    pub days: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MyUsageResponse {
    pub days: i64,
    pub trend: Vec<DailyUsage>,
    pub total_beans: f64,
    pub total_requests: i64,
    pub balance_beans: f64,
    pub period_used_beans: f64,
    pub generated_at: String,
}

pub async fn my_usage(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Query(query): Query<UsageQuery>,
) -> Result<Json<Envelope<MyUsageResponse>>, ApiError> {
    let days = query.days.unwrap_or(30).clamp(1, 90);
    let user_id = auth.user_id.clone();

    let (trend, snapshot) = state
        .db
        .call(move |conn| {
            let policy = quota::load_policy(conn)?;
            let snapshot = quota::snapshot(conn, &user_id, &policy)?;
            let mut statement = conn.prepare(
                "SELECT substr(created_at, 1, 10) AS day, COALESCE(SUM(millibeans), 0), COUNT(*)
                 FROM usage_events WHERE user_id = ?1 AND created_at >= ?2
                 GROUP BY day ORDER BY day ASC",
            )?;
            let rows = statement.query_map(
                rusqlite::params![
                    user_id,
                    crate::util::iso(crate::util::now() - chrono::Duration::days(days))
                ],
                |row| {
                    Ok(DailyUsage {
                        day: row.get(0)?,
                        beans: crate::util::millibeans_to_beans(row.get::<_, i64>(1)?),
                        requests: row.get(2)?,
                    })
                },
            )?;
            let mut trend = Vec::new();
            for row in rows {
                trend.push(row?);
            }
            Ok((trend, snapshot))
        })
        .await?;

    let total_beans: f64 = trend.iter().map(|entry| entry.beans).sum();
    let total_requests: i64 = trend.iter().map(|entry| entry.requests).sum();

    Ok(ok(MyUsageResponse {
        days,
        trend,
        total_beans,
        total_requests,
        balance_beans: snapshot.balance_beans,
        period_used_beans: snapshot.period_used_beans,
        generated_at: iso(crate::util::now()),
    }))
}
