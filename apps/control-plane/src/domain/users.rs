use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::util::{millibeans_to_beans, now_iso};

#[derive(Debug, Clone)]
pub struct UserRecord {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub password_hash: String,
    pub role: String,
    pub status: String,
    pub created_at: String,
    pub last_login_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserView {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub role: String,
    pub status: String,
    pub created_at: String,
    pub last_login_at: Option<String>,
    pub balance_beans: f64,
    pub lifetime_granted_beans: f64,
    pub lifetime_used_beans: f64,
    pub today_used_beans: f64,
}

pub const ROLES: &[&str] = &["member", "admin"];
pub const STATUSES: &[&str] = &["active", "disabled"];

const SELECT_COLUMNS: &str =
    "id, email, display_name, password_hash, role, status, created_at, last_login_at";

fn map_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<UserRecord> {
    Ok(UserRecord {
        id: row.get(0)?,
        email: row.get(1)?,
        display_name: row.get(2)?,
        password_hash: row.get(3)?,
        role: row.get(4)?,
        status: row.get(5)?,
        created_at: row.get(6)?,
        last_login_at: row.get(7)?,
    })
}

pub fn find_by_email(conn: &Connection, email: &str) -> Result<Option<UserRecord>> {
    let sql = format!("SELECT {SELECT_COLUMNS} FROM users WHERE email = ?1");
    Ok(conn
        .query_row(&sql, params![email], map_record)
        .optional()?)
}

pub fn find_by_id(conn: &Connection, id: &str) -> Result<Option<UserRecord>> {
    let sql = format!("SELECT {SELECT_COLUMNS} FROM users WHERE id = ?1");
    Ok(conn.query_row(&sql, params![id], map_record).optional()?)
}

pub fn create(
    conn: &Connection,
    id: &str,
    email: &str,
    display_name: &str,
    password_hash: &str,
    role: &str,
    default_grant_millibeans: i64,
) -> Result<()> {
    let now = now_iso();
    conn.execute(
        "INSERT INTO users (id, email, display_name, password_hash, role, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6)",
        params![id, email, display_name, password_hash, role, now],
    )?;
    conn.execute(
        "INSERT INTO quota_accounts (user_id, balance_millibeans, lifetime_granted, lifetime_used, updated_at)
         VALUES (?1, ?2, ?2, 0, ?3)",
        params![id, default_grant_millibeans, now],
    )?;
    if default_grant_millibeans > 0 {
        conn.execute(
            "INSERT INTO quota_ledger (id, user_id, delta_millibeans, kind, reason, request_id, balance_after, actor_user_id, created_at)
             VALUES (?1, ?2, ?3, 'grant', '注册赠送', NULL, ?3, NULL, ?4)",
            params![crate::util::new_id(), id, default_grant_millibeans, now],
        )?;
    }
    Ok(())
}

pub fn touch_login(conn: &Connection, id: &str) -> Result<()> {
    let now = now_iso();
    conn.execute(
        "UPDATE users SET last_login_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

pub fn update_password(conn: &Connection, id: &str, password_hash: &str) -> Result<()> {
    conn.execute(
        "UPDATE users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3",
        params![password_hash, now_iso(), id],
    )?;
    Ok(())
}

pub struct UserUpdate<'a> {
    pub display_name: Option<&'a str>,
    pub role: Option<&'a str>,
    pub status: Option<&'a str>,
}

pub fn update(conn: &Connection, id: &str, update: UserUpdate<'_>) -> Result<()> {
    if let Some(name) = update.display_name {
        conn.execute(
            "UPDATE users SET display_name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now_iso(), id],
        )?;
    }
    if let Some(role) = update.role {
        conn.execute(
            "UPDATE users SET role = ?1, updated_at = ?2 WHERE id = ?3",
            params![role, now_iso(), id],
        )?;
    }
    if let Some(status) = update.status {
        conn.execute(
            "UPDATE users SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, now_iso(), id],
        )?;
        if status == "disabled" {
            conn.execute(
                "UPDATE sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL",
                params![now_iso(), id],
            )?;
        }
    }
    Ok(())
}

pub fn revoke_all_sessions(conn: &Connection, user_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL",
        params![now_iso(), user_id],
    )?;
    Ok(())
}

pub fn list(
    conn: &Connection,
    query: Option<&str>,
    status: Option<&str>,
    page: i64,
    page_size: i64,
    today_prefix: &str,
) -> Result<(Vec<UserView>, i64)> {
    let like = query.map(|value| format!("%{}%", value.to_lowercase()));
    let offset = (page - 1).max(0) * page_size;

    let filter = "WHERE (?1 IS NULL OR lower(u.email) LIKE ?1 OR lower(u.display_name) LIKE ?1)
                  AND (?2 IS NULL OR u.status = ?2)";

    let total: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM users u {filter}"),
        params![like, status],
        |row| row.get(0),
    )?;

    let sql = format!(
        "SELECT u.id, u.email, u.display_name, u.role, u.status, u.created_at, u.last_login_at,
                COALESCE(q.balance_millibeans, 0), COALESCE(q.lifetime_granted, 0), COALESCE(q.lifetime_used, 0),
                COALESCE((SELECT SUM(millibeans) FROM usage_events e WHERE e.user_id = u.id AND e.created_at >= ?3), 0)
         FROM users u LEFT JOIN quota_accounts q ON q.user_id = u.id
         {filter}
         ORDER BY u.created_at DESC
         LIMIT ?4 OFFSET ?5"
    );

    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(
        params![like, status, today_prefix, page_size, offset],
        |row| {
            Ok(UserView {
                id: row.get(0)?,
                email: row.get(1)?,
                display_name: row.get(2)?,
                role: row.get(3)?,
                status: row.get(4)?,
                created_at: row.get(5)?,
                last_login_at: row.get(6)?,
                balance_beans: millibeans_to_beans(row.get::<_, i64>(7)?),
                lifetime_granted_beans: millibeans_to_beans(row.get::<_, i64>(8)?),
                lifetime_used_beans: millibeans_to_beans(row.get::<_, i64>(9)?),
                today_used_beans: millibeans_to_beans(row.get::<_, i64>(10)?),
            })
        },
    )?;

    let mut users = Vec::new();
    for row in rows {
        users.push(row?);
    }
    Ok((users, total))
}

pub fn view(conn: &Connection, id: &str, today_prefix: &str) -> Result<Option<UserView>> {
    let Some(record) = find_by_id(conn, id)? else {
        return Ok(None);
    };
    let (balance, granted, used): (i64, i64, i64) = conn
        .query_row(
            "SELECT balance_millibeans, lifetime_granted, lifetime_used FROM quota_accounts WHERE user_id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .unwrap_or((0, 0, 0));
    let today: i64 = conn.query_row(
        "SELECT COALESCE(SUM(millibeans), 0) FROM usage_events WHERE user_id = ?1 AND created_at >= ?2",
        params![id, today_prefix],
        |row| row.get(0),
    )?;
    Ok(Some(UserView {
        id: record.id,
        email: record.email,
        display_name: record.display_name,
        role: record.role,
        status: record.status,
        created_at: record.created_at,
        last_login_at: record.last_login_at,
        balance_beans: millibeans_to_beans(balance),
        lifetime_granted_beans: millibeans_to_beans(granted),
        lifetime_used_beans: millibeans_to_beans(used),
        today_used_beans: millibeans_to_beans(today),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn creates_user_with_default_quota_ledger() {
        let db = Db::in_memory().unwrap();
        let guard = db.lock_for_tests();
        let conn: &Connection = &guard;
        create(conn, "u1", "a@company.com", "张三", "hash", "member", 5_000).unwrap();
        let user = find_by_email(conn, "a@company.com").unwrap().unwrap();
        assert_eq!(user.id, "u1");
        let (balance, ledger): (i64, i64) = guard
            .query_row(
                "SELECT (SELECT balance_millibeans FROM quota_accounts WHERE user_id = 'u1'),
                        (SELECT COUNT(*) FROM quota_ledger WHERE user_id = 'u1')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(balance, 5_000);
        assert_eq!(ledger, 1);
    }

    #[test]
    fn disabling_a_user_revokes_sessions() {
        let db = Db::in_memory().unwrap();
        let guard = db.lock_for_tests();
        let conn: &Connection = &guard;
        create(conn, "u1", "a@company.com", "张三", "hash", "member", 0).unwrap();
        conn.execute(
            "INSERT INTO sessions (id, user_id, refresh_hash, created_at, expires_at) VALUES ('s1','u1','h','2026-01-01T00:00:00Z','2030-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        update(
            conn,
            "u1",
            UserUpdate {
                display_name: None,
                role: None,
                status: Some("disabled"),
            },
        )
        .unwrap();
        let revoked: Option<String> = guard
            .query_row(
                "SELECT revoked_at FROM sessions WHERE id = 's1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(revoked.is_some());
    }
}
