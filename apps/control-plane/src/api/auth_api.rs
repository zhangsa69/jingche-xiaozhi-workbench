use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::{Deserialize, Serialize};

use super::client_ip;
use super::helpers::require_display_name;
use crate::auth::{codes, password};
use crate::domain::quota;
use crate::domain::users;
use crate::error::{ok, ApiError, Envelope};
use crate::state::AppState;
use crate::util::{iso, new_id, normalize_email, now, now_iso};

#[derive(Debug, Deserialize)]
pub struct EmailRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRequest {
    pub email: String,
    pub code: String,
    pub password: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetRequest {
    pub email: String,
    pub code: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogoutRequest {
    pub refresh_token: String,
}

#[derive(Debug, Serialize)]
pub struct MessageBody {
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthPayload {
    pub access_token: String,
    pub access_token_expires_at: String,
    pub refresh_token: String,
    pub refresh_token_expires_at: String,
    pub user: users::UserView,
}

pub async fn register_code(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<EmailRequest>,
) -> Result<Json<Envelope<MessageBody>>, ApiError> {
    if !state.config.registration_open {
        return Err(ApiError::forbidden(
            "当前未开放自助注册，请联系管理员开通账号",
        ));
    }
    let email = normalize_email(&body.email);
    let email_for_lookup = email.clone();
    let existing = state
        .db
        .call(move |conn| Ok(users::find_by_email(conn, &email_for_lookup)?.is_some()))
        .await?;
    if existing {
        return Err(ApiError::conflict(
            "EMAIL_ALREADY_REGISTERED",
            "该邮箱已注册，请直接登录或重置密码",
        ));
    }

    let ip = client_ip(&headers, Some(peer), state.config.trust_proxy);
    codes::request_code(&state, &email, codes::Purpose::Register, ip.clone()).await?;
    state.record_audit(
        None,
        "auth.register_code_requested",
        Some(("email", &email)),
        None,
        ip,
    );
    Ok(ok(MessageBody {
        message: "验证码已发送，请查收邮箱".to_string(),
    }))
}

pub async fn register(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<Envelope<AuthPayload>>, ApiError> {
    if !state.config.registration_open {
        return Err(ApiError::forbidden(
            "当前未开放自助注册，请联系管理员开通账号",
        ));
    }
    let email = normalize_email(&body.email);
    password::validate_strength(&body.password).map_err(ApiError::bad_request)?;
    let display_name = require_display_name(body.display_name.as_deref(), &email)?;

    let email_for_lookup = email.clone();
    let existing = state
        .db
        .call(move |conn| Ok(users::find_by_email(conn, &email_for_lookup)?.is_some()))
        .await?;
    if existing {
        return Err(ApiError::conflict(
            "EMAIL_ALREADY_REGISTERED",
            "该邮箱已注册，请直接登录",
        ));
    }

    codes::consume_code(&state, &email, codes::Purpose::Register, &body.code).await?;

    let role = if state
        .config
        .admin_emails
        .iter()
        .any(|admin| admin == &email)
    {
        "admin"
    } else {
        "member"
    };
    let raw_password = body.password.clone();
    let password_hash = tokio::task::spawn_blocking(move || password::hash_password(&raw_password))
        .await
        .map_err(|error| {
            tracing::error!(%error, "password hashing task failed");
            ApiError::internal("创建账号失败，请稍后重试")
        })?
        .map_err(|error| {
            tracing::error!(%error, "hashing password failed");
            ApiError::internal("创建账号失败，请稍后重试")
        })?;

    let user_id = new_id();
    let default_grant = state
        .db
        .call(|conn| Ok(quota::load_policy(conn)?.default_grant_millibeans))
        .await?;

    let id_for_insert = user_id.clone();
    let email_for_insert = email.clone();
    let role_owned = role.to_string();
    state
        .db
        .call(move |conn| {
            users::create(
                conn,
                &id_for_insert,
                &email_for_insert,
                &display_name,
                &password_hash,
                &role_owned,
                default_grant,
            )
        })
        .await?;

    let ip = client_ip(&headers, Some(peer), state.config.trust_proxy);
    state.record_audit(
        Some((&user_id, &email)),
        "auth.registered",
        Some(("user", &user_id)),
        Some(serde_json::json!({ "role": role, "defaultGrantBeans": crate::util::millibeans_to_beans(default_grant) })),
        ip,
    );

    let user = load_user(&state, &user_id).await?;
    let payload = issue_session(&state, &user, &headers).await?;
    Ok(ok(payload))
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<Json<Envelope<AuthPayload>>, ApiError> {
    let email = normalize_email(&body.email);
    let guard_key = format!(
        "{}|{}",
        email,
        client_ip(&headers, Some(peer), state.config.trust_proxy)
            .unwrap_or_else(|| "unknown".to_string())
    );
    if state
        .login_guard
        .is_blocked(&guard_key, state.config.login_max_failures)
    {
        return Err(ApiError::too_many_requests(
            "登录失败次数过多，请 15 分钟后再试",
        ));
    }

    let email_for_lookup = email.clone();
    let user = state
        .db
        .call(move |conn| users::find_by_email(conn, &email_for_lookup))
        .await?
        .ok_or_else(ApiError::invalid_credentials)?;

    if user.status != "active" {
        return Err(ApiError::forbidden("账号已被停用，请联系管理员"));
    }

    let submitted = body.password.clone();
    let stored = user.password_hash.clone();
    let verified =
        tokio::task::spawn_blocking(move || password::verify_password(&submitted, &stored))
            .await
            .map_err(|error| {
                tracing::error!(%error, "password verification task failed");
                ApiError::internal("登录处理失败，请稍后重试")
            })?;
    if !verified {
        state.login_guard.record_failure(&guard_key);
        state.record_audit(
            None,
            "auth.login_failed",
            Some(("user", &user.id)),
            Some(serde_json::json!({ "email": user.email })),
            client_ip(&headers, Some(peer), state.config.trust_proxy),
        );
        return Err(ApiError::invalid_credentials());
    }
    state.login_guard.clear(&guard_key);

    let user_id = user.id.clone();
    state
        .db
        .call(move |conn| users::touch_login(conn, &user_id))
        .await?;

    let ip = client_ip(&headers, Some(peer), state.config.trust_proxy);
    state.record_audit(
        Some((&user.id, &user.email)),
        "auth.login",
        Some(("user", &user.id)),
        None,
        ip,
    );

    let user = load_user(&state, &user.id).await?;
    let payload = issue_session(&state, &user, &headers).await?;
    Ok(ok(payload))
}

pub async fn refresh(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<RefreshRequest>,
) -> Result<Json<Envelope<AuthPayload>>, ApiError> {
    let hash = state.tokens.hash_refresh(body.refresh_token.trim());
    let now = now_iso();

    let row = state
        .db
        .call(move |conn| {
            let row = conn
                .query_row(
                    "SELECT s.id, s.user_id, s.expires_at, s.revoked_at, u.role, u.status
                     FROM sessions s JOIN users u ON u.id = s.user_id
                     WHERE s.refresh_hash = ?1",
                    rusqlite::params![hash],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                        ))
                    },
                )
                .ok();
            Ok(row)
        })
        .await?;

    let Some((session_id, user_id, expires_at, revoked_at, _role, status)) = row else {
        return Err(ApiError::unauthorized(
            "SESSION_REVOKED",
            "登录会话已失效，请重新登录",
        ));
    };
    if revoked_at.is_some() || expires_at <= now || status != "active" {
        return Err(ApiError::unauthorized(
            "SESSION_REVOKED",
            "登录会话已失效，请重新登录",
        ));
    }

    let (new_refresh, new_hash) = state.tokens.issue_refresh();
    let (refresh_expires, refresh_expires_iso) =
        crate::auth::tokens::session_expiry(state.config.refresh_token_ttl_days);
    let session_for_update = session_id.clone();
    state
        .db
        .call(move |conn| {
            conn.execute(
                "UPDATE sessions SET refresh_hash = ?1, expires_at = ?2, last_used_at = ?3 WHERE id = ?4",
                rusqlite::params![new_hash, refresh_expires_iso, now, session_for_update],
            )?;
            Ok(())
        })
        .await?;

    let user = load_user(&state, &user_id).await?;
    let access = state.tokens.issue_access(
        &user.id,
        &user.role,
        &session_id,
        state.config.access_token_ttl_secs,
    )?;
    let _ = &headers;
    Ok(ok(AuthPayload {
        access_token: access.token,
        access_token_expires_at: iso(access.expires_at),
        refresh_token: new_refresh,
        refresh_token_expires_at: iso(refresh_expires),
        user,
    }))
}

pub async fn logout(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LogoutRequest>,
) -> Result<Json<Envelope<MessageBody>>, ApiError> {
    let hash = state.tokens.hash_refresh(body.refresh_token.trim());
    let now = now_iso();
    state
        .db
        .call(move |conn| {
            conn.execute(
                "UPDATE sessions SET revoked_at = ?1 WHERE refresh_hash = ?2 AND revoked_at IS NULL",
                rusqlite::params![now, hash],
            )?;
            Ok(())
        })
        .await?;
    Ok(ok(MessageBody {
        message: "已退出登录".to_string(),
    }))
}

pub async fn reset_code(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<EmailRequest>,
) -> Result<Json<Envelope<MessageBody>>, ApiError> {
    let email = normalize_email(&body.email);
    let email_for_lookup = email.clone();
    let exists = state
        .db
        .call(move |conn| Ok(users::find_by_email(conn, &email_for_lookup)?.is_some()))
        .await?;

    // Unknown mailboxes get the same response so the endpoint cannot be used to
    // enumerate employees.
    if !exists {
        return Ok(ok(MessageBody {
            message: "如果该邮箱已注册，验证码将在稍后送达".to_string(),
        }));
    }

    let ip = client_ip(&headers, Some(peer), state.config.trust_proxy);
    codes::request_code(&state, &email, codes::Purpose::Reset, ip.clone()).await?;
    state.record_audit(
        None,
        "auth.reset_code_requested",
        Some(("email", &email)),
        None,
        ip,
    );
    Ok(ok(MessageBody {
        message: "验证码已发送，请查收邮箱".to_string(),
    }))
}

pub async fn reset_password(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<ResetRequest>,
) -> Result<Json<Envelope<MessageBody>>, ApiError> {
    let email = normalize_email(&body.email);
    password::validate_strength(&body.password).map_err(ApiError::bad_request)?;

    codes::consume_code(&state, &email, codes::Purpose::Reset, &body.code).await?;

    let email_for_lookup = email.clone();
    let user = state
        .db
        .call(move |conn| users::find_by_email(conn, &email_for_lookup))
        .await?
        .ok_or_else(|| ApiError::bad_request("该邮箱尚未注册"))?;

    let raw_password = body.password.clone();
    let password_hash = tokio::task::spawn_blocking(move || password::hash_password(&raw_password))
        .await
        .map_err(|error| {
            tracing::error!(%error, "password hashing task failed");
            ApiError::internal("重置密码失败，请稍后重试")
        })?
        .map_err(|error| {
            tracing::error!(%error, "hashing password failed");
            ApiError::internal("重置密码失败，请稍后重试")
        })?;

    let user_id = user.id.clone();
    state
        .db
        .call(move |conn| {
            users::update_password(conn, &user_id, &password_hash)?;
            users::revoke_all_sessions(conn, &user_id)
        })
        .await?;

    state.record_audit(
        None,
        "auth.password_reset",
        Some(("user", &user.id)),
        None,
        client_ip(&headers, Some(peer), state.config.trust_proxy),
    );
    Ok(ok(MessageBody {
        message: "密码已重置，请使用新密码登录".to_string(),
    }))
}

pub async fn load_user(state: &AppState, user_id: &str) -> Result<users::UserView, ApiError> {
    let id = user_id.to_string();
    let today = quota::period_start("daily");
    let view = state
        .db
        .call(move |conn| users::view(conn, &id, &today))
        .await?
        .ok_or_else(|| ApiError::not_found("用户不存在"))?;
    Ok(view)
}

async fn issue_session(
    state: &AppState,
    user: &users::UserView,
    headers: &HeaderMap,
) -> Result<AuthPayload, ApiError> {
    let (refresh_token, refresh_hash) = state.tokens.issue_refresh();
    let (refresh_expires, refresh_expires_iso) =
        crate::auth::tokens::session_expiry(state.config.refresh_token_ttl_days);
    let session_id = new_id();
    let user_agent = headers
        .get("user-agent")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.chars().take(200).collect::<String>());
    let created_at = now_iso();
    let user_id = user.id.clone();
    let session_for_insert = session_id.clone();

    state
        .db
        .call(move |conn| {
            conn.execute(
                "INSERT INTO sessions (id, user_id, refresh_hash, created_at, expires_at, last_used_at, user_agent)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?6)",
                rusqlite::params![session_for_insert, user_id, refresh_hash, created_at, refresh_expires_iso, user_agent],
            )?;
            Ok(())
        })
        .await?;

    let access = state.tokens.issue_access(
        &user.id,
        &user.role,
        &session_id,
        state.config.access_token_ttl_secs,
    )?;
    let _ = now();
    Ok(AuthPayload {
        access_token: access.token,
        access_token_expires_at: iso(access.expires_at),
        refresh_token,
        refresh_token_expires_at: iso(refresh_expires),
        user: user.clone(),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayTokenBody {
    pub token: String,
    pub expires_at: String,
    pub scope: String,
}

/// Exchanges a full session for a gateway-scoped token the desktop runtime can
/// persist as a provider credential.
///
/// It stays bound to the same session row, so logout, account disabling, and a
/// password reset revoke it immediately, while `/me`, admin routes and the
/// ledger refuse it because they require the `full` scope.
pub async fn gateway_token(
    State(state): State<Arc<AppState>>,
    auth: crate::auth::AuthUser,
) -> Result<Json<Envelope<GatewayTokenBody>>, ApiError> {
    let session_id = auth.sid.clone();
    let expires_at = state
        .db
        .call(move |conn| {
            conn.query_row(
                "SELECT expires_at FROM sessions WHERE id = ?1",
                rusqlite::params![session_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|error| anyhow::anyhow!("reading session expiry: {error}"))
        })
        .await
        .map_err(|_| ApiError::unauthorized("SESSION_REVOKED", "登录会话已失效，请重新登录"))?;

    let session_ends = chrono::DateTime::parse_from_rfc3339(&expires_at)
        .map(|value| value.with_timezone(&chrono::Utc))
        .map_err(|_| ApiError::unauthorized("SESSION_REVOKED", "登录会话已失效，请重新登录"))?;
    let remaining = (session_ends - now()).num_seconds();
    let ttl = remaining
        .min(state.config.gateway_token_ttl_days * 86_400)
        .max(60);

    let issued = state
        .tokens
        .issue_gateway(&auth.user_id, &auth.role, &auth.sid, ttl)?;

    Ok(ok(GatewayTokenBody {
        token: issued.token,
        expires_at: iso(issued.expires_at),
        scope: crate::auth::tokens::SCOPE_GATEWAY.to_string(),
    }))
}
