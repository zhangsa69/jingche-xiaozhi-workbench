use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::domain::quota::{self, ChargeInput, ChargeOutcome};
use crate::error::{ok, ApiError, Envelope};
use crate::state::AppState;
use crate::util::millibeans_to_beans;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChargeRequest {
    pub request_id: String,
    pub gateway_id: Option<String>,
    pub model: Option<String>,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChargeResponse {
    pub charged_beans: f64,
    pub balance_beans: f64,
    pub period_used_beans: f64,
    pub duplicate: bool,
}

/// Records provider token usage and deducts beans. Repeated `requestId` values
/// are idempotent, which makes the desktop's retry path safe.
pub async fn charge(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(body): Json<ChargeRequest>,
) -> Result<Json<Envelope<ChargeResponse>>, ApiError> {
    let request_id = body.request_id.trim().to_string();
    if request_id.is_empty() || request_id.len() > 128 {
        return Err(ApiError::bad_request("requestId 必须是 1-128 个字符"));
    }
    if body.prompt_tokens < 0 || body.completion_tokens < 0 {
        return Err(ApiError::bad_request("Token 数量不能为负数"));
    }
    if body.prompt_tokens == 0 && body.completion_tokens == 0 {
        return Err(ApiError::bad_request("Token 数量不能全部为零"));
    }

    let user_id = auth.user_id.clone();
    let gateway_id = body.gateway_id.clone();
    let model = body.model.clone();
    let prompt_tokens = body.prompt_tokens;
    let completion_tokens = body.completion_tokens;

    let outcome = state
        .db
        .call(move |conn| {
            let policy = quota::load_policy(conn)?;
            quota::charge(
                conn,
                ChargeInput {
                    user_id: &user_id,
                    request_id: &request_id,
                    gateway_id: gateway_id.as_deref(),
                    model: model.as_deref(),
                    prompt_tokens,
                    completion_tokens,
                },
                &policy,
            )
        })
        .await?;

    match outcome {
        ChargeOutcome::Applied {
            charged_millibeans,
            balance_millibeans,
            period_used_millibeans,
        } => Ok(ok(ChargeResponse {
            charged_beans: millibeans_to_beans(charged_millibeans),
            balance_beans: millibeans_to_beans(balance_millibeans),
            period_used_beans: millibeans_to_beans(period_used_millibeans),
            duplicate: false,
        })),
        ChargeOutcome::Duplicate {
            charged_millibeans,
            balance_millibeans,
        } => Ok(ok(ChargeResponse {
            charged_beans: millibeans_to_beans(charged_millibeans),
            balance_beans: millibeans_to_beans(balance_millibeans),
            period_used_beans: 0.0,
            duplicate: true,
        })),
        ChargeOutcome::Insufficient {
            required_millibeans,
            available_millibeans,
            ..
        } => Err(ApiError::insufficient_quota(format!(
            "小智豆余额不足：本次需要 {:.3} 豆，可用 {:.3} 豆",
            millibeans_to_beans(required_millibeans),
            millibeans_to_beans(available_millibeans)
        ))),
    }
}
