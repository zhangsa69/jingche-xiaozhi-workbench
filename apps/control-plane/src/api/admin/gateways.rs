use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use super::{message, MessageBody};
use crate::auth::AuthUser;
use crate::domain::gateways::{self, GatewayUpdate, GatewayView, NewGateway, PROVIDERS};
use crate::error::{ok, ApiError, Envelope};
use crate::state::AppState;
use crate::util::{mask_secret, now};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayInput {
    pub name: String,
    pub provider: String,
    pub base_url: String,
    pub model: Option<String>,
    pub api_key: Option<String>,
    pub enabled: Option<bool>,
    pub is_default: Option<bool>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayList {
    pub items: Vec<GatewayView>,
}

pub async fn list_gateways(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<Json<Envelope<GatewayList>>, ApiError> {
    auth.require_admin()?;
    let items = state.db.call(|conn| gateways::list(conn)).await?;
    Ok(ok(GatewayList { items }))
}

pub async fn create_gateway(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(body): Json<GatewayInput>,
) -> Result<Json<Envelope<GatewayView>>, ApiError> {
    auth.require_admin()?;
    validate(&body.name, &body.provider, &body.base_url)?;

    let sealed = match body
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(key) => Some((
            state.vault.seal(key).map_err(|error| {
                tracing::error!(%error, "sealing gateway credential");
                ApiError::internal("保存网关密钥失败")
            })?,
            mask_secret(key),
        )),
        None => None,
    };

    let name = body.name.trim().to_string();
    let provider = body.provider.clone();
    let base_url = body.base_url.trim().to_string();
    let model = body
        .model
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let notes = body
        .notes
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let enabled = body.enabled.unwrap_or(true);
    let is_default = body.is_default.unwrap_or(false);

    let cipher = sealed.as_ref().map(|(cipher, _)| cipher.clone());
    let hint = sealed.as_ref().map(|(_, hint)| hint.clone());

    let id = state
        .db
        .call(move |conn| {
            gateways::create(
                conn,
                NewGateway {
                    name: &name,
                    provider: &provider,
                    base_url: &base_url,
                    model: model.as_deref(),
                    api_key_cipher: cipher.as_deref(),
                    api_key_hint: hint.as_deref(),
                    enabled,
                    is_default,
                    notes: notes.as_deref(),
                },
            )
        })
        .await?;

    state.record_audit(
        Some((&auth.user_id, &auth.email)),
        "admin.gateway_created",
        Some(("gateway", &id)),
        Some(serde_json::json!({ "name": body.name, "provider": body.provider, "isDefault": is_default })),
        None,
    );

    let id_for_read = id.clone();
    let record = state
        .db
        .call(move |conn| gateways::find(conn, &id_for_read))
        .await?
        .ok_or_else(|| ApiError::not_found("网关不存在"))?;
    Ok(ok(record.view()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayPatch {
    pub name: Option<String>,
    pub provider: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub api_key: Option<String>,
    pub enabled: Option<bool>,
    pub is_default: Option<bool>,
    pub notes: Option<String>,
}

pub async fn update_gateway(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(gateway_id): Path<String>,
    Json(body): Json<GatewayPatch>,
) -> Result<Json<Envelope<GatewayView>>, ApiError> {
    auth.require_admin()?;

    if let Some(name) = body.name.as_deref() {
        validate(
            name,
            body.provider.as_deref().unwrap_or("openai-compatible"),
            body.base_url
                .as_deref()
                .unwrap_or("https://placeholder.invalid"),
        )?;
    }
    if let Some(provider) = body.provider.as_deref() {
        if !PROVIDERS.contains(&provider) {
            return Err(ApiError::bad_request("不支持的网关类型"));
        }
    }
    if let Some(base_url) = body.base_url.as_deref() {
        if !(base_url.starts_with("https://") || base_url.starts_with("http://")) {
            return Err(ApiError::bad_request(
                "网关地址必须以 http:// 或 https:// 开头",
            ));
        }
    }

    // An explicit empty string clears the stored credential.
    let (cipher_update, hint_update) = match body.api_key.as_deref().map(str::trim) {
        Some("") => (Some(None), Some(None)),
        Some(key) => {
            let sealed = state.vault.seal(key).map_err(|error| {
                tracing::error!(%error, "sealing gateway credential");
                ApiError::internal("保存网关密钥失败")
            })?;
            (Some(Some(sealed)), Some(Some(mask_secret(key))))
        }
        None => (None, None),
    };

    let name = body
        .name
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let provider = body.provider.clone();
    let base_url = body
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let model = body.model.as_ref().map(|value| value.trim().to_string());
    let notes = body.notes.as_ref().map(|value| value.trim().to_string());
    let enabled = body.enabled;
    let is_default = body.is_default;

    let cipher_for_db = cipher_update.clone();
    let hint_for_db = hint_update.clone();
    let target = gateway_id.clone();

    state
        .db
        .call(move |conn| {
            if gateways::find(conn, &target)?.is_none() {
                return Err(anyhow::anyhow!(ApiError::not_found("网关不存在")));
            }
            gateways::update(
                conn,
                &target,
                GatewayUpdate {
                    name: name.as_deref(),
                    provider: provider.as_deref(),
                    base_url: base_url.as_deref(),
                    model: model.as_ref().map(|value| {
                        if value.is_empty() {
                            None
                        } else {
                            Some(value.as_str())
                        }
                    }),
                    api_key_cipher: cipher_for_db.as_ref().map(|value| value.as_deref()),
                    api_key_hint: hint_for_db.as_ref().map(|value| value.as_deref()),
                    enabled,
                    is_default,
                    notes: notes.as_ref().map(|value| {
                        if value.is_empty() {
                            None
                        } else {
                            Some(value.as_str())
                        }
                    }),
                },
            )
        })
        .await?;

    state.record_audit(
        Some((&auth.user_id, &auth.email)),
        "admin.gateway_updated",
        Some(("gateway", &gateway_id)),
        Some(serde_json::json!({
            "name": body.name,
            "enabled": enabled,
            "isDefault": is_default,
            "credentialChanged": cipher_update.is_some(),
        })),
        None,
    );

    let target = gateway_id.clone();
    let record = state
        .db
        .call(move |conn| gateways::find(conn, &target))
        .await?
        .ok_or_else(|| ApiError::not_found("网关不存在"))?;
    Ok(ok(record.view()))
}

pub async fn delete_gateway(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(gateway_id): Path<String>,
) -> Result<Json<Envelope<MessageBody>>, ApiError> {
    auth.require_admin()?;
    let target = gateway_id.clone();
    let existing = state
        .db
        .call(move |conn| {
            let record = gateways::find(conn, &target)?;
            if let Some(record) = record.as_ref() {
                gateways::remove(conn, &target)?;
                return Ok(Some(record.name.clone()));
            }
            Ok(None)
        })
        .await?
        .ok_or_else(|| ApiError::not_found("网关不存在"))?;

    state.record_audit(
        Some((&auth.user_id, &auth.email)),
        "admin.gateway_deleted",
        Some(("gateway", &gateway_id)),
        Some(serde_json::json!({ "name": existing })),
        None,
    );
    Ok(message("网关已删除"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayTestResult {
    pub ok: bool,
    pub status_code: Option<u16>,
    pub latency_ms: i64,
    pub message: String,
}

pub async fn test_gateway(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(gateway_id): Path<String>,
) -> Result<Json<Envelope<GatewayTestResult>>, ApiError> {
    auth.require_admin()?;
    let target = gateway_id.clone();
    let record = state
        .db
        .call(move |conn| gateways::find(conn, &target))
        .await?
        .ok_or_else(|| ApiError::not_found("网关不存在"))?;

    let key = match record.api_key_cipher.as_deref() {
        Some(cipher) => match state.vault.open(cipher) {
            Ok(plain) => Some(plain),
            Err(error) => {
                tracing::error!(%error, gateway = %record.id, "decrypting gateway credential");
                return Ok(ok(GatewayTestResult {
                    ok: false,
                    status_code: None,
                    latency_ms: 0,
                    message: "已保存的密钥无法解密，请重新保存网关密钥".to_string(),
                }));
            }
        },
        None => None,
    };

    let url = format!("{}/models", record.base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| {
            tracing::error!(%error, "building HTTP client");
            ApiError::internal("无法初始化连通性测试")
        })?;

    let started = Instant::now();
    let mut request = client.get(&url).header("accept", "application/json");
    if let Some(key) = key.as_deref() {
        request = request.bearer_auth(key);
    }

    match request.send().await {
        Ok(response) => {
            let status = response.status();
            Ok(ok(GatewayTestResult {
                ok: status.is_success() || status.as_u16() == 404,
                status_code: Some(status.as_u16()),
                latency_ms: started.elapsed().as_millis() as i64,
                message: if status.is_success() {
                    "网关可达且凭据有效".to_string()
                } else if status.as_u16() == 404 {
                    "网关可达，但未提供 /models 探测端点".to_string()
                } else {
                    format!("网关返回 {status}，请检查地址与密钥")
                },
            }))
        }
        Err(error) => Ok(ok(GatewayTestResult {
            ok: false,
            status_code: None,
            latency_ms: started.elapsed().as_millis() as i64,
            message: format!("连接失败：{}", public_error(&error)),
        })),
    }
}

fn validate(name: &str, provider: &str, base_url: &str) -> Result<(), ApiError> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() || trimmed_name.chars().count() > 80 {
        return Err(ApiError::bad_request("网关名称需要 1-80 个字符"));
    }
    if !PROVIDERS.contains(&provider) {
        return Err(ApiError::bad_request("不支持的网关类型"));
    }
    let trimmed_url = base_url.trim();
    if !(trimmed_url.starts_with("https://") || trimmed_url.starts_with("http://")) {
        return Err(ApiError::bad_request(
            "网关地址必须以 http:// 或 https:// 开头",
        ));
    }
    Ok(())
}

/// Strips credentials and URL details out of transport errors before they reach
/// the admin console.
fn public_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        return "请求超时".to_string();
    }
    if error.is_connect() {
        return "无法建立连接".to_string();
    }
    format!("请求失败（{}）", now().timestamp())
}
