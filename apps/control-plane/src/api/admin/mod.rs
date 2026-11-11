mod gateways;
mod insights;
mod users;

pub use gateways::{create_gateway, delete_gateway, list_gateways, test_gateway, update_gateway};
pub use insights::{audit, get_policy, ledger, overview, put_policy, system};
pub use users::{grant_quota, list_users, update_user, user_ledger};

use axum::Json;
use serde::Serialize;

use crate::error::Envelope;

#[derive(Debug, Serialize)]
pub struct MessageBody {
    pub message: String,
}

pub fn message(text: impl Into<String>) -> Json<Envelope<MessageBody>> {
    crate::error::ok(MessageBody {
        message: text.into(),
    })
}

/// Shared page envelope so every admin list renders the same table contract.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T: Serialize> {
    pub items: Vec<T>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}
