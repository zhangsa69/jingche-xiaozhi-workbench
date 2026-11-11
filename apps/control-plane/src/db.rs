use std::path::Path;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use rusqlite::Connection;

/// Embedded migrations. The index in this array is the schema version stored in
/// `PRAGMA user_version`; entries are append-only.
const MIGRATIONS: &[&str] = &[include_str!("../migrations/0001_init.sql")];

/// Thin SQLite handle. Writes are serialized through one connection, which is
/// deliberate: the ledger's correctness depends on transactional ordering, and
/// the control plane serves an internal employee population rather than
/// high-throughput traffic.
#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating data directory {}", parent.display()))?;
        }
        let conn = Connection::open(path)
            .with_context(|| format!("opening database {}", path.display()))?;
        conn.busy_timeout(std::time::Duration::from_secs(10))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.migrate()?;
        Ok(db)
    }

    #[cfg(test)]
    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        let mut guard = self.lock();
        let current: i64 = guard.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        let target = MIGRATIONS.len() as i64;
        if current > target {
            anyhow::bail!(
                "database schema version {current} is newer than this binary supports ({target})"
            );
        }
        for version in (current + 1)..=target {
            let sql = MIGRATIONS[(version - 1) as usize];
            let tx = guard.transaction()?;
            tx.execute_batch(sql)
                .with_context(|| format!("applying migration {version}"))?;
            tx.pragma_update(None, "user_version", version)?;
            tx.commit()?;
            tracing::info!(version, "applied control plane migration");
        }
        Ok(())
    }

    /// Runs a blocking database closure on the blocking pool so request handlers
    /// never hold the connection lock across an await.
    pub async fn call<T, F>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut Connection) -> Result<T> + Send + 'static,
        T: Send + 'static,
    {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let mut guard = conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            f(&mut guard)
        })
        .await
        .context("database task panicked")?
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Test-only synchronous access so domain tests stay synchronous.
    #[cfg(test)]
    pub fn lock_for_tests(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.lock()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_idempotent() {
        let db = Db::in_memory().expect("open in-memory database");
        db.migrate().expect("re-running migrations is a no-op");
        let guard = db.lock();
        let version: i64 = guard
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
        let policy: i64 = guard
            .query_row("SELECT COUNT(*) FROM quota_policy", [], |row| row.get(0))
            .unwrap();
        assert_eq!(policy, 1);
    }
}
