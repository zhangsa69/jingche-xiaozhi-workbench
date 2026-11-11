use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

use crate::auth::GatewayUser;
use crate::domain::gateways;
use crate::domain::quota;
use crate::error::ApiError;
use crate::state::AppState;
use crate::util::sha256_hex;

/// Proxies an OpenAI-compatible chat completion through the configured gateway.
///
/// The provider credential stays on the server. This handler deliberately does
/// **no** accounting: it relays bytes (including SSE) and the desktop client
/// reports the token usage of each finished turn to `POST /usage/charge`. That
/// keeps the hot path free of per-chunk work on small deployments, and the
/// price is still decided by the server-side quota policy.
pub async fn chat_completions(
    State(state): State<Arc<AppState>>,
    GatewayUser(auth): GatewayUser,
    Json(body): Json<Value>,
) -> Result<Response, ApiError> {
    let user_id = auth.user_id.clone();
    let prepared = state
        .db
        .call(move |conn| {
            let policy = quota::load_policy(conn)?;
            let snapshot = quota::snapshot(conn, &user_id, &policy)?;
            let gateway = gateways::find_default(conn)?;
            Ok((snapshot.available_beans, gateway))
        })
        .await?;

    let (available_beans, gateway) = prepared;
    let Some(gateway) = gateway else {
        return Err(ApiError::service_unavailable(
            "尚未配置可用的大模型网关，请联系管理员",
        ));
    };
    if !gateway.enabled {
        return Err(ApiError::service_unavailable(
            "默认大模型网关已被停用，请联系管理员",
        ));
    }
    if available_beans <= 0.0 {
        return Err(ApiError::insufficient_quota(
            "小智豆余额不足，请联系管理员补充额度",
        ));
    }

    let api_key = match gateway.api_key_cipher.as_deref() {
        Some(cipher) => Some(state.vault.open(cipher).map_err(|error| {
            tracing::error!(%error, gateway = %gateway.id, "decrypting gateway credential");
            ApiError::service_unavailable("网关凭据不可用，请联系管理员重新保存密钥")
        })?),
        None => None,
    };

    let streaming = body.get("stream").and_then(Value::as_bool).unwrap_or(false);
    let body = with_stream_usage(body);
    let url = completion_url(&gateway.base_url);

    // Streamed generations can run for minutes, so bound the connection and the
    // idle gap between chunks instead of the whole response.
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| {
            tracing::error!(%error, "building HTTP client");
            ApiError::internal("无法初始化网关请求")
        })?;

    let mut request = client.post(&url).json(&body);
    if let Some(key) = api_key {
        request = request.bearer_auth(key);
    }
    if let Some(model) = gateway.model.as_deref() {
        // Kept for gateways that route on the configured model; harmless for
        // providers that ignore unknown headers.
        request = request.header("x-control-plane-model", model);
    }
    // Some OpenAI-compatible upstreams reject a request that carries no session
    // id — the opencode zen endpoint answers `400 Request is missing
    // x-opencode-session and cannot be routed efficiently`. It is a routing
    // hint, so the value only has to be stable for one desktop login; deriving
    // it from the session row keeps the row id itself off the wire, and
    // providers that do not care ignore the header.
    request = request.header(
        "x-opencode-session",
        upstream_session_id(&auth.user_id, &auth.sid),
    );
    // The same upstream requires an identifiable client and rejects a bare
    // HTTP-library User-Agent, so the proxy announces itself.
    request = request.header(
        header::USER_AGENT,
        concat!("pi-control-plane/", env!("CARGO_PKG_VERSION")),
    );

    let upstream = request.send().await.map_err(|error| {
        tracing::error!(%error, url = %url, "gateway request failed");
        ApiError::service_unavailable("无法连接大模型网关，请稍后重试")
    })?;

    let status = upstream.status();
    let upstream_headers = upstream.headers().clone();
    let is_event_stream = upstream_headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_ascii_lowercase().contains("text/event-stream"))
        .unwrap_or(false);

    if !status.is_success() {
        let payload: Value = upstream.json().await.unwrap_or_else(|_| json!({}));
        let message = payload
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("大模型网关返回错误");
        // The upstream message is the only actionable part of a rejection:
        // without it the desktop shows a bare 502 and ops has nothing to grep.
        tracing::warn!(
            user_id = %auth.user_id,
            %status,
            model = gateway.model.as_deref().unwrap_or("-"),
            %message,
            "gateway rejected the request"
        );
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "GATEWAY_ERROR",
            format!("网关返回 {status}：{message}"),
        ));
    }

    if streaming && is_event_stream {
        // Byte-for-byte relay: no per-chunk parsing, no accumulation.
        let stream = relay_chunks(upstream);
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/event-stream; charset=utf-8")
            .header(header::CACHE_CONTROL, "no-cache, no-transform")
            .header(header::CONNECTION, "keep-alive")
            // Disables proxy buffering (nginx honours this header).
            .header("x-accel-buffering", "no")
            .body(Body::from_stream(stream))
            .map_err(|error| {
                tracing::error!(%error, "building streaming gateway response");
                ApiError::internal("无法回传网关响应")
            });
    }

    let payload: Value = upstream.json().await.map_err(|error| {
        tracing::error!(%error, url = %url, "gateway response was not JSON");
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            "GATEWAY_BAD_RESPONSE",
            "大模型网关返回了无法解析的响应",
        )
    })?;
    Ok((StatusCode::OK, Json(payload)).into_response())
}

/// Relays the upstream body chunk by chunk without buffering it on the server.
///
/// `reqwest`'s `bytes_stream()` would need the `stream` feature, which pulls a
/// wasm-only transitive; `Response::chunk()` is available in every build.
fn relay_chunks(
    upstream: reqwest::Response,
) -> impl futures_util::Stream<Item = Result<axum::body::Bytes, std::io::Error>> + Send + 'static {
    futures_util::stream::unfold(Some(upstream), |state| async move {
        let mut response = state?;
        match response.chunk().await {
            Ok(Some(chunk)) => Some((Ok(chunk), Some(response))),
            Ok(None) => None,
            Err(error) => {
                // A broken upstream must surface as a stream error so the
                // runtime can settle the turn instead of hanging.
                tracing::warn!(%error, "gateway stream interrupted");
                Some((Err(std::io::Error::other(error.to_string())), None))
            }
        }
    })
}

/// Streaming callers must ask for the trailing usage frame: it is the only place
/// the token counts appear, and the desktop client reports them to the ledger.
fn with_stream_usage(mut body: Value) -> Value {
    let streaming = body.get("stream").and_then(Value::as_bool).unwrap_or(false);
    if !streaming {
        return body;
    }
    let replaced = match body.get_mut("stream_options") {
        Some(Value::Object(options)) => {
            options.insert("include_usage".to_string(), Value::Bool(true));
            true
        }
        Some(_) => false,
        None => false,
    };
    if !replaced {
        body["stream_options"] = json!({ "include_usage": true });
    }
    body
}

/// Routing id handed to upstreams that demand one. Stable for a whole desktop
/// login (so streamed turns keep their affinity) and derived, so the session row
/// id never reaches a third party.
fn upstream_session_id(user_id: &str, sid: &str) -> String {
    let digest = sha256_hex(&format!("{user_id}|{sid}"));
    format!("pc-{}", &digest[..32])
}

fn completion_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completion_url_is_derived_once() {
        assert_eq!(
            completion_url("https://gw.example.com/v1"),
            "https://gw.example.com/v1/chat/completions"
        );
        assert_eq!(
            completion_url("https://gw.example.com/v1/chat/completions/"),
            "https://gw.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn upstream_session_id_is_stable_and_opaque() {
        let id = upstream_session_id("user-1", "session-1");
        assert_eq!(id, upstream_session_id("user-1", "session-1"));
        assert_ne!(id, upstream_session_id("user-1", "session-2"));
        assert_ne!(id, upstream_session_id("user-2", "session-1"));
        assert!(id.starts_with("pc-"));
        assert_eq!(id.len(), "pc-".len() + 32);
        // The row ids must not travel to the upstream verbatim.
        assert!(!id.contains("user-1"));
        assert!(!id.contains("session-1"));
    }

    #[test]
    fn streaming_requests_ask_for_the_usage_frame() {
        let body = with_stream_usage(json!({ "stream": true, "model": "m" }));
        assert_eq!(body["stream_options"]["include_usage"], json!(true));
        assert_eq!(body["model"], json!("m"));
    }

    #[test]
    fn existing_stream_options_keep_their_keys() {
        let body = with_stream_usage(json!({
            "stream": true,
            "stream_options": { "chunk_size": 4 }
        }));
        assert_eq!(body["stream_options"]["include_usage"], json!(true));
        assert_eq!(body["stream_options"]["chunk_size"], json!(4));
    }

    #[test]
    fn malformed_stream_options_are_replaced() {
        let body = with_stream_usage(json!({ "stream": true, "stream_options": 7 }));
        assert_eq!(body["stream_options"]["include_usage"], json!(true));
    }

    #[test]
    fn non_streaming_requests_are_untouched() {
        let body = with_stream_usage(json!({ "model": "m" }));
        assert!(body.get("stream_options").is_none());
    }
}
