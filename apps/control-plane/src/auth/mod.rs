pub mod codes;
pub mod guard;
pub mod password;
pub mod tokens;

use std::sync::Arc;

use axum::extract::FromRequestParts;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;

use crate::error::ApiError;
use crate::state::AppState;
use crate::util::now_iso;

/// Authenticated caller. Access tokens are verified cryptographically and the
/// backing session plus account status are re-checked so a disabled employee or
/// revoked session loses access before the token expires.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: String,
    pub email: String,
    pub role: String,
    /// Session row backing the token. Gateway tokens reuse it so revocation
    /// (logout, disable, password reset) applies without extra bookkeeping.
    pub sid: String,
    /// `full` for interactive sessions, `gateway` for the desktop model path.
    pub scope: String,
}

impl AuthUser {
    pub fn is_admin(&self) -> bool {
        self.role == "admin"
    }

    pub fn require_admin(&self) -> Result<(), ApiError> {
        if self.is_admin() {
            Ok(())
        } else {
            Err(ApiError::forbidden("该操作仅限管理员执行"))
        }
    }
}

/// Caller allowed to reach the model gateway: either an interactive session or
/// a long-lived gateway token. Every other route stays on [`AuthUser`], which
/// refuses gateway-scoped tokens.
pub struct GatewayUser(pub AuthUser);

impl FromRequestParts<Arc<AppState>> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, ApiError> {
        let user = authenticate(parts, state).await?;
        if user.scope != tokens::SCOPE_FULL {
            return Err(ApiError::new(
                axum::http::StatusCode::FORBIDDEN,
                "FORBIDDEN_SCOPE",
                "该令牌仅可用于模型网关，请重新登录",
            ));
        }
        Ok(user)
    }
}

impl FromRequestParts<Arc<AppState>> for GatewayUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, ApiError> {
        Ok(GatewayUser(authenticate(parts, state).await?))
    }
}

async fn authenticate(parts: &mut Parts, state: &Arc<AppState>) -> Result<AuthUser, ApiError> {
    let header = parts
        .headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ApiError::unauthorized("MISSING_TOKEN", "请先登录"))?;
    let token = header
        .strip_prefix("Bearer ")
        .or_else(|| header.strip_prefix("bearer "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::unauthorized("MISSING_TOKEN", "请先登录"))?;

    let claims = state.tokens.verify_access(token)?;
    let session_id = claims.sid.clone();
    let session_id_for_query = session_id.clone();
    let user_id = claims.sub.clone();
    let now = now_iso();

    let row = state
        .db
        .call(move |conn| {
            let row = conn
                .query_row(
                    "SELECT u.id, u.email, u.role, u.status, s.revoked_at, s.expires_at
                         FROM sessions s JOIN users u ON u.id = s.user_id
                         WHERE s.id = ?1 AND s.user_id = ?2",
                    rusqlite::params![session_id_for_query, user_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, Option<String>>(4)?,
                            row.get::<_, String>(5)?,
                        ))
                    },
                )
                .ok();
            Ok(row)
        })
        .await?;

    let Some((user_id, email, role, status, revoked_at, expires_at)) = row else {
        return Err(ApiError::unauthorized(
            "SESSION_REVOKED",
            "登录会话已失效，请重新登录",
        ));
    };
    if revoked_at.is_some() || expires_at <= now {
        return Err(ApiError::unauthorized(
            "SESSION_REVOKED",
            "登录会话已失效，请重新登录",
        ));
    }
    if status != "active" {
        return Err(ApiError::forbidden("账号已被停用，请联系管理员"));
    }

    Ok(AuthUser {
        user_id,
        email,
        role,
        sid: session_id,
        scope: claims.scope,
    })
}
