use std::net::SocketAddr;

use axum::http::HeaderMap;
use serde::Deserialize;

use crate::error::ApiError;

pub fn client_ip(
    headers: &HeaderMap,
    peer: Option<SocketAddr>,
    trust_proxy: bool,
) -> Option<String> {
    if trust_proxy {
        if let Some(forwarded) = headers
            .get("x-forwarded-for")
            .and_then(|value| value.to_str().ok())
        {
            if let Some(first) = forwarded
                .split(',')
                .map(str::trim)
                .find(|value| !value.is_empty())
            {
                return Some(first.to_string());
            }
        }
        if let Some(real) = headers
            .get("x-real-ip")
            .and_then(|value| value.to_str().ok())
        {
            if !real.trim().is_empty() {
                return Some(real.trim().to_string());
            }
        }
    }
    peer.map(|addr| addr.ip().to_string())
}

/// Query strings carry every value as text, and `#[serde(flatten)]` buffers the
/// flattened keys before the inner struct sees them, so a plain `i64` cannot
/// parse `?page=1` there: the request was rejected with a plain-text
/// `400 invalid type: string "1", expected i64`, which the admin console then
/// failed to read as JSON. Accept both shapes.
fn flexible_i64<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Raw {
        Number(i64),
        Text(String),
    }

    match Option::<Raw>::deserialize(deserializer)? {
        None => Ok(None),
        Some(Raw::Number(value)) => Ok(Some(value)),
        Some(Raw::Text(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            trimmed
                .parse::<i64>()
                .map(Some)
                .map_err(serde::de::Error::custom)
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pagination {
    #[serde(default, deserialize_with = "flexible_i64")]
    pub page: Option<i64>,
    #[serde(default, alias = "page_size", deserialize_with = "flexible_i64")]
    pub page_size: Option<i64>,
}

impl Pagination {
    /// Clamps paging so a hostile or buggy client cannot request the whole
    /// employee table in one response.
    pub fn resolve(&self) -> (i64, i64) {
        let page = self.page.unwrap_or(1).clamp(1, 10_000);
        let page_size = self.page_size.unwrap_or(20).clamp(1, 100);
        (page, page_size)
    }
}

pub fn trim_optional(value: Option<String>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn require_display_name(value: Option<&str>, fallback_email: &str) -> Result<String, ApiError> {
    let candidate = value.map(str::trim).filter(|value| !value.is_empty());
    let name = match candidate {
        Some(name) => name.to_string(),
        None => {
            let local = fallback_email.split('@').next().unwrap_or("员工");
            local.to_string()
        }
    };
    if name.chars().count() > 60 {
        return Err(ApiError::bad_request("显示名称不能超过 60 个字符"));
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PaginatedProbe {
        #[serde(flatten)]
        pagination: Pagination,
    }

    #[test]
    fn flattened_pagination_accepts_text_values() {
        // `serde_urlencoded` hands every query value over as text and `flatten`
        // buffers it, which is what turned `?page=1&pageSize=20` into a 400.
        let probe: PaginatedProbe =
            serde_json::from_str(r#"{"page":"2","pageSize":"50"}"#).expect("text values");
        assert_eq!(probe.pagination.resolve(), (2, 50));
    }

    #[test]
    fn flattened_pagination_accepts_numbers_and_snake_case() {
        let probe: PaginatedProbe =
            serde_json::from_str(r#"{"page":3,"page_size":7}"#).expect("numbers");
        assert_eq!(probe.pagination.resolve(), (3, 7));
    }

    #[test]
    fn pagination_is_clamped() {
        let pagination = Pagination {
            page: Some(0),
            page_size: Some(10_000),
        };
        assert_eq!(pagination.resolve(), (1, 100));
    }

    #[test]
    fn display_name_falls_back_to_mailbox() {
        assert_eq!(
            require_display_name(None, "li.si@company.com").unwrap(),
            "li.si"
        );
        assert_eq!(
            require_display_name(Some("  李四  "), "x@y.com").unwrap(),
            "李四"
        );
    }
}
