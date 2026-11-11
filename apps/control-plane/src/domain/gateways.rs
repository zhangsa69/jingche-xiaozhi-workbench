use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::util::{new_id, now_iso};

pub const PROVIDERS: &[&str] = &["openai-compatible", "anthropic", "azure-openai", "custom"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayView {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub base_url: String,
    pub model: Option<String>,
    pub api_key_masked: Option<String>,
    pub has_api_key: bool,
    pub enabled: bool,
    pub is_default: bool,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct GatewayRecord {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub base_url: String,
    pub model: Option<String>,
    pub api_key_cipher: Option<String>,
    pub api_key_hint: Option<String>,
    pub enabled: bool,
    pub is_default: bool,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl GatewayRecord {
    pub fn view(&self) -> GatewayView {
        GatewayView {
            id: self.id.clone(),
            name: self.name.clone(),
            provider: self.provider.clone(),
            base_url: self.base_url.clone(),
            model: self.model.clone(),
            api_key_masked: self.api_key_hint.clone(),
            has_api_key: self.api_key_cipher.is_some(),
            enabled: self.enabled,
            is_default: self.is_default,
            notes: self.notes.clone(),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GatewayRecord> {
    Ok(GatewayRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        provider: row.get(2)?,
        base_url: row.get(3)?,
        model: row.get(4)?,
        api_key_cipher: row.get(5)?,
        api_key_hint: row.get(6)?,
        enabled: row.get::<_, i64>(7)? != 0,
        is_default: row.get::<_, i64>(8)? != 0,
        notes: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

const COLUMNS: &str = "id, name, provider, base_url, model, api_key_cipher, api_key_hint, enabled, is_default, notes, created_at, updated_at";

pub fn list(conn: &Connection) -> Result<Vec<GatewayView>> {
    let mut statement = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM gateways ORDER BY is_default DESC, created_at ASC"
    ))?;
    let rows = statement.query_map([], map_row)?;
    let mut gateways = Vec::new();
    for row in rows {
        gateways.push(row?.view());
    }
    Ok(gateways)
}

pub fn find(conn: &Connection, id: &str) -> Result<Option<GatewayRecord>> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM gateways WHERE id = ?1"),
            params![id],
            map_row,
        )
        .optional()?)
}

pub fn find_default(conn: &Connection) -> Result<Option<GatewayRecord>> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM gateways WHERE enabled = 1 ORDER BY is_default DESC, created_at ASC LIMIT 1"),
            [],
            map_row,
        )
        .optional()?)
}

pub struct NewGateway<'a> {
    pub name: &'a str,
    pub provider: &'a str,
    pub base_url: &'a str,
    pub model: Option<&'a str>,
    pub api_key_cipher: Option<&'a str>,
    pub api_key_hint: Option<&'a str>,
    pub enabled: bool,
    pub is_default: bool,
    pub notes: Option<&'a str>,
}

pub fn create(conn: &Connection, new: NewGateway<'_>) -> Result<String> {
    let id = new_id();
    let now = now_iso();
    if new.is_default {
        conn.execute("UPDATE gateways SET is_default = 0", [])?;
    }
    conn.execute(
        "INSERT INTO gateways (id, name, provider, base_url, model, api_key_cipher, api_key_hint, enabled, is_default, notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        params![
            id,
            new.name,
            new.provider,
            new.base_url,
            new.model,
            new.api_key_cipher,
            new.api_key_hint,
            i64::from(new.enabled),
            i64::from(new.is_default),
            new.notes,
            now
        ],
    )?;
    Ok(id)
}

pub struct GatewayUpdate<'a> {
    pub name: Option<&'a str>,
    pub provider: Option<&'a str>,
    pub base_url: Option<&'a str>,
    pub model: Option<Option<&'a str>>,
    pub api_key_cipher: Option<Option<&'a str>>,
    pub api_key_hint: Option<Option<&'a str>>,
    pub enabled: Option<bool>,
    pub is_default: Option<bool>,
    pub notes: Option<Option<&'a str>>,
}

pub fn update(conn: &Connection, id: &str, update: GatewayUpdate<'_>) -> Result<()> {
    let now = now_iso();
    if update.is_default == Some(true) {
        conn.execute(
            "UPDATE gateways SET is_default = 0 WHERE id <> ?1",
            params![id],
        )?;
    }
    conn.execute(
        "UPDATE gateways SET
            name = COALESCE(?1, name),
            provider = COALESCE(?2, provider),
            base_url = COALESCE(?3, base_url),
            model = CASE WHEN ?4 = 1 THEN ?5 ELSE model END,
            api_key_cipher = CASE WHEN ?6 = 1 THEN ?7 ELSE api_key_cipher END,
            api_key_hint = CASE WHEN ?8 = 1 THEN ?9 ELSE api_key_hint END,
            enabled = COALESCE(?10, enabled),
            is_default = COALESCE(?11, is_default),
            notes = CASE WHEN ?12 = 1 THEN ?13 ELSE notes END,
            updated_at = ?14
         WHERE id = ?15",
        params![
            update.name,
            update.provider,
            update.base_url,
            i64::from(update.model.is_some()),
            update.model.flatten(),
            i64::from(update.api_key_cipher.is_some()),
            update.api_key_cipher.flatten(),
            i64::from(update.api_key_hint.is_some()),
            update.api_key_hint.flatten(),
            update.enabled.map(i64::from),
            update.is_default.map(i64::from),
            i64::from(update.notes.is_some()),
            update.notes.flatten(),
            now,
            id
        ],
    )?;
    Ok(())
}

pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM gateways WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn only_one_gateway_can_be_default() {
        let db = Db::in_memory().unwrap();
        let guard = db.lock_for_tests();
        let guard: &Connection = &guard;
        let first = create(
            guard,
            NewGateway {
                name: "主网关",
                provider: "openai-compatible",
                base_url: "https://gw.example.com/v1",
                model: Some("gpt-4o"),
                api_key_cipher: Some("cipher"),
                api_key_hint: Some("****1234"),
                enabled: true,
                is_default: true,
                notes: None,
            },
        )
        .unwrap();
        let second = create(
            guard,
            NewGateway {
                name: "备用网关",
                provider: "openai-compatible",
                base_url: "https://gw2.example.com/v1",
                model: None,
                api_key_cipher: None,
                api_key_hint: None,
                enabled: true,
                is_default: true,
                notes: None,
            },
        )
        .unwrap();

        let gateways = list(guard).unwrap();
        assert_eq!(gateways.len(), 2);
        let active_default = gateways.iter().filter(|gateway| gateway.is_default).count();
        assert_eq!(active_default, 1);
        assert_eq!(find_default(guard).unwrap().unwrap().id, second);
        assert_ne!(first, second);
        assert!(gateways.iter().find(|g| g.id == first).unwrap().has_api_key);
    }

    #[test]
    fn update_can_clear_optional_fields() {
        let db = Db::in_memory().unwrap();
        let guard = db.lock_for_tests();
        let guard: &Connection = &guard;
        let id = create(
            guard,
            NewGateway {
                name: "网关",
                provider: "custom",
                base_url: "https://gw.example.com",
                model: Some("m1"),
                api_key_cipher: Some("cipher"),
                api_key_hint: Some("****abcd"),
                enabled: true,
                is_default: false,
                notes: Some("备注"),
            },
        )
        .unwrap();
        update(
            guard,
            &id,
            GatewayUpdate {
                name: None,
                provider: None,
                base_url: None,
                model: Some(None),
                api_key_cipher: Some(None),
                api_key_hint: Some(None),
                enabled: Some(false),
                is_default: None,
                notes: Some(None),
            },
        )
        .unwrap();
        let record = find(guard, &id).unwrap().unwrap();
        assert!(record.model.is_none());
        assert!(record.api_key_cipher.is_none());
        assert!(!record.enabled);
    }
}
