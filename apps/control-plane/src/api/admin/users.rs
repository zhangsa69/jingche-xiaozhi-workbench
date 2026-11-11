use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;

use super::Page;
use crate::api::helpers::{trim_optional, Pagination};
use crate::auth::AuthUser;
use crate::domain::quota;
use crate::domain::users::{self, UserView, ROLES, STATUSES};
use crate::error::{ok, ApiError, Envelope};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsersQuery {
    #[serde(flatten)]
    pub pagination: Pagination,
    pub query: Option<String>,
    pub status: Option<String>,
}

pub async fn list_users(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Query(query): Query<UsersQuery>,
) -> Result<Json<Envelope<Page<UserView>>>, ApiError> {
    auth.require_admin()?;
    let (page, page_size) = query.pagination.resolve();
    let search = trim_optional(query.query);
    let status = trim_optional(query.status).filter(|value| STATUSES.contains(&value.as_str()));
    let today = quota::period_start("daily");

    let (items, total) = state
        .db
        .call(move |conn| {
            users::list(
                conn,
                search.as_deref(),
                status.as_deref(),
                page,
                page_size,
                &today,
            )
        })
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
pub struct UpdateUserRequest {
    pub display_name: Option<String>,
    pub role: Option<String>,
    pub status: Option<String>,
}

pub async fn update_user(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(user_id): Path<String>,
    Json(body): Json<UpdateUserRequest>,
) -> Result<Json<Envelope<UserView>>, ApiError> {
    auth.require_admin()?;

    if let Some(role) = body.role.as_deref() {
        if !ROLES.contains(&role) {
            return Err(ApiError::bad_request("角色必须是 member 或 admin"));
        }
    }
    if let Some(status) = body.status.as_deref() {
        if !STATUSES.contains(&status) {
            return Err(ApiError::bad_request("状态必须是 active 或 disabled"));
        }
    }
    if body.display_name.is_none() && body.role.is_none() && body.status.is_none() {
        return Err(ApiError::bad_request("没有需要更新的字段"));
    }
    if user_id == auth.user_id && body.status.as_deref() == Some("disabled") {
        return Err(ApiError::bad_request("不能停用当前登录的管理员账号"));
    }
    if user_id == auth.user_id && body.role.as_deref() == Some("member") {
        return Err(ApiError::bad_request("不能降低当前登录账号的管理员权限"));
    }

    let display_name = body.display_name.clone();
    let name = display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if let Some(name) = name.as_deref() {
        if name.chars().count() > 60 {
            return Err(ApiError::bad_request("显示名称不能超过 60 个字符"));
        }
    }

    let role = body.role.clone();
    let status = body.status.clone();
    let audit_detail = serde_json::json!({
        "displayName": name.clone(),
        "role": role.clone(),
        "status": status.clone(),
    });

    let target = user_id.clone();
    state
        .db
        .call(move |conn| {
            let existing = users::find_by_id(conn, &target)?;
            if existing.is_none() {
                return Err(anyhow::anyhow!(ApiError::not_found("用户不存在")));
            }
            users::update(
                conn,
                &target,
                users::UserUpdate {
                    display_name: name.as_deref(),
                    role: role.as_deref(),
                    status: status.as_deref(),
                },
            )
        })
        .await?;

    state.record_audit(
        Some((&auth.user_id, &auth.email)),
        "admin.user_updated",
        Some(("user", &user_id)),
        Some(audit_detail),
        None,
    );

    let id = user_id.clone();
    let today = quota::period_start("daily");
    let view = state
        .db
        .call(move |conn| users::view(conn, &id, &today))
        .await?
        .ok_or_else(|| ApiError::not_found("用户不存在"))?;
    Ok(ok(view))
}

#[derive(Debug, Deserialize)]
pub struct GrantRequest {
    /// Positive or negative beans. Negative values claw back quota.
    pub beans: f64,
    pub reason: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantResponse {
    pub balance_beans: f64,
    pub granted_beans: f64,
}

pub async fn grant_quota(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(user_id): Path<String>,
    Json(body): Json<GrantRequest>,
) -> Result<Json<Envelope<GrantResponse>>, ApiError> {
    auth.require_admin()?;

    if !body.beans.is_finite() || body.beans == 0.0 {
        return Err(ApiError::bad_request("调整数量必须是非零数字"));
    }
    if body.beans.abs() > 1_000_000.0 {
        return Err(ApiError::bad_request("单次调整不能超过 1,000,000 小智豆"));
    }
    let millibeans = crate::util::beans_to_millibeans(body.beans);
    let reason = body
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(if millibeans > 0 {
            "管理员发放"
        } else {
            "管理员扣减"
        })
        .to_string();

    let target = user_id.clone();
    let actor = auth.user_id.clone();
    let reason_for_db = reason.clone();
    let balance = state
        .db
        .call(move |conn| {
            if users::find_by_id(conn, &target)?.is_none() {
                return Err(anyhow::anyhow!(ApiError::not_found("用户不存在")));
            }
            quota::grant(conn, &target, millibeans, &reason_for_db, Some(&actor))
        })
        .await?;

    state.record_audit(
        Some((&auth.user_id, &auth.email)),
        "admin.quota_granted",
        Some(("user", &user_id)),
        Some(serde_json::json!({ "beans": body.beans, "reason": reason })),
        None,
    );

    Ok(ok(GrantResponse {
        balance_beans: crate::util::millibeans_to_beans(balance),
        granted_beans: body.beans,
    }))
}

pub async fn user_ledger(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(user_id): Path<String>,
    Query(pagination): Query<Pagination>,
) -> Result<Json<Envelope<Page<quota::LedgerEntry>>>, ApiError> {
    auth.require_admin()?;
    let (page, page_size) = pagination.resolve();
    let target = user_id.clone();
    let (items, total) = state
        .db
        .call(move |conn| quota::ledger_page(conn, Some(&target), page, page_size))
        .await?;
    Ok(ok(Page {
        items,
        total,
        page,
        page_size,
    }))
}
