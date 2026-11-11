mod admin;
mod auth_api;
mod gateway_proxy;
mod helpers;
mod me_api;
mod usage_api;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, State};
use axum::http::{header, HeaderMap, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::Serialize;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;

use crate::error::ApiError;
use crate::state::AppState;

pub fn router(state: AppState, web_dir: PathBuf) -> Router {
    let body_limit = state.config.max_body_bytes();
    let api = Router::new()
        .route("/auth/register/code", post(auth_api::register_code))
        .route("/auth/register", post(auth_api::register))
        .route("/auth/login", post(auth_api::login))
        .route("/auth/refresh", post(auth_api::refresh))
        .route("/auth/logout", post(auth_api::logout))
        .route("/auth/gateway-token", post(auth_api::gateway_token))
        .route("/auth/password/code", post(auth_api::reset_code))
        .route("/auth/password/reset", post(auth_api::reset_password))
        .route("/me", get(me_api::me))
        .route("/me/usage", get(me_api::my_usage))
        .route("/usage/charge", post(usage_api::charge))
        .route(
            "/gateway/chat/completions",
            post(gateway_proxy::chat_completions),
        )
        .route("/admin/overview", get(admin::overview))
        .route("/admin/users", get(admin::list_users))
        .route("/admin/users/{id}", patch(admin::update_user))
        .route("/admin/users/{id}/grant", post(admin::grant_quota))
        .route("/admin/users/{id}/ledger", get(admin::user_ledger))
        .route(
            "/admin/gateways",
            get(admin::list_gateways).post(admin::create_gateway),
        )
        .route(
            "/admin/gateways/{id}",
            patch(admin::update_gateway).delete(admin::delete_gateway),
        )
        .route("/admin/gateways/{id}/test", post(admin::test_gateway))
        .route(
            "/admin/quota-policy",
            get(admin::get_policy).put(admin::put_policy),
        )
        .route("/admin/ledger", get(admin::ledger))
        .route("/admin/audit", get(admin::audit))
        .route("/admin/system", get(admin::system));

    let index_html = web_dir.join("index.html");
    let assets_dir = web_dir.join("assets");

    Router::new()
        .nest("/api/v1", api)
        .route("/healthz", get(health))
        .route("/readyz", get(ready))
        .nest_service("/assets", ServeDir::new(assets_dir))
        .fallback(move |uri: Uri| {
            let index_html = index_html.clone();
            async move { serve_spa(uri, index_html).await }
        })
        .layer(DefaultBodyLimit::max(body_limit))
        .layer(TraceLayer::new_for_http())
        .with_state(Arc::new(state))
}

/// Serves the single-page admin console for any non-asset path so client-side
/// navigation and deep links work after a reload. Unknown API paths stay 404.
async fn serve_spa(uri: Uri, index_html: PathBuf) -> Response {
    if uri.path().starts_with("/api/") {
        return ApiError::not_found("接口不存在").into_response();
    }
    match tokio::fs::read_to_string(&index_html).await {
        Ok(html) => (
            [
                (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                (header::CACHE_CONTROL, "no-cache"),
            ],
            html,
        )
            .into_response(),
        Err(error) => {
            tracing::warn!(%error, path = %index_html.display(), "admin console bundle is missing");
            ApiError::service_unavailable("管理控制台资源缺失，请检查部署目录").into_response()
        }
    }
}

#[derive(Serialize)]
struct HealthBody {
    status: &'static str,
    version: String,
    uptime_seconds: i64,
}

async fn health(State(state): State<Arc<AppState>>) -> Json<HealthBody> {
    let uptime = (chrono::Utc::now() - state.started_at).num_seconds();
    Json(HealthBody {
        status: "ok",
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_seconds: uptime,
    })
}

#[derive(Serialize)]
struct ReadyBody {
    status: &'static str,
    database: bool,
    mail_transport: String,
}

/// Readiness also proves the database answers a query, so a proxy can take the
/// instance out of rotation when the SQLite file is locked or corrupt.
async fn ready(State(state): State<Arc<AppState>>) -> Result<Json<ReadyBody>, ApiError> {
    let probe = state
        .db
        .call(|conn| {
            let value: i64 = conn.query_row("SELECT 1", [], |row| row.get(0))?;
            Ok(value == 1)
        })
        .await?;
    if !probe {
        return Err(ApiError::service_unavailable("数据库检查失败"));
    }
    Ok(Json(ReadyBody {
        status: "ready",
        database: true,
        mail_transport: state.mailer.describe(),
    }))
}

/// Best-effort client address. Behind a reverse proxy the forwarded header is
/// only honored when the deployment explicitly opts in.
pub fn client_ip(
    headers: &HeaderMap,
    peer: Option<SocketAddr>,
    trust_proxy: bool,
) -> Option<String> {
    helpers::client_ip(headers, peer, trust_proxy)
}
