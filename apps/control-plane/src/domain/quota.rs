use anyhow::Result;
use chrono::{Datelike, Duration, TimeZone, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::util::{millibeans_to_beans, new_id, now, now_iso, tokens_to_millibeans};

#[derive(Debug, Clone)]
pub struct Policy {
    pub millibeans_per_1k_prompt: i64,
    pub millibeans_per_1k_completion: i64,
    pub period: String,
    pub period_millibeans: i64,
    pub default_grant_millibeans: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyView {
    pub beans_per_1k_prompt: f64,
    pub beans_per_1k_completion: f64,
    pub period: String,
    pub period_beans: f64,
    pub default_grant_beans: f64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaSnapshot {
    pub balance_beans: f64,
    pub lifetime_granted_beans: f64,
    pub lifetime_used_beans: f64,
    pub period: String,
    pub period_limit_beans: f64,
    pub period_used_beans: f64,
    pub period_remaining_beans: f64,
    pub period_resets_at: Option<String>,
    pub available_beans: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub id: String,
    pub user_id: String,
    pub user_email: String,
    pub delta_beans: f64,
    pub kind: String,
    pub reason: Option<String>,
    pub balance_after_beans: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
    pub day: String,
    pub beans: f64,
    pub requests: i64,
}

pub struct ChargeInput<'a> {
    pub user_id: &'a str,
    pub request_id: &'a str,
    pub gateway_id: Option<&'a str>,
    pub model: Option<&'a str>,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
}

#[derive(Debug)]
pub enum ChargeOutcome {
    Applied {
        charged_millibeans: i64,
        balance_millibeans: i64,
        period_used_millibeans: i64,
    },
    Duplicate {
        charged_millibeans: i64,
        balance_millibeans: i64,
    },
    Insufficient {
        required_millibeans: i64,
        available_millibeans: i64,
    },
}

pub fn load_policy(conn: &Connection) -> Result<Policy> {
    let policy = conn.query_row(
        "SELECT millibeans_per_1k_prompt, millibeans_per_1k_completion, period, period_millibeans,
                default_grant_millibeans, updated_at
         FROM quota_policy WHERE id = 1",
        [],
        |row| {
            Ok(Policy {
                millibeans_per_1k_prompt: row.get(0)?,
                millibeans_per_1k_completion: row.get(1)?,
                period: row.get(2)?,
                period_millibeans: row.get(3)?,
                default_grant_millibeans: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )?;
    Ok(policy)
}

impl Policy {
    pub fn view(&self) -> PolicyView {
        PolicyView {
            beans_per_1k_prompt: millibeans_to_beans(self.millibeans_per_1k_prompt),
            beans_per_1k_completion: millibeans_to_beans(self.millibeans_per_1k_completion),
            period: self.period.clone(),
            period_beans: millibeans_to_beans(self.period_millibeans),
            default_grant_beans: millibeans_to_beans(self.default_grant_millibeans),
            updated_at: self.updated_at.clone(),
        }
    }
}

pub fn save_policy(
    conn: &Connection,
    per_1k_prompt: i64,
    per_1k_completion: i64,
    period: &str,
    period_millibeans: i64,
    default_grant_millibeans: i64,
    updated_by: Option<&str>,
) -> Result<()> {
    conn.execute(
        "UPDATE quota_policy SET millibeans_per_1k_prompt = ?1, millibeans_per_1k_completion = ?2,
            period = ?3, period_millibeans = ?4, default_grant_millibeans = ?5, updated_at = ?6, updated_by = ?7
         WHERE id = 1",
        params![
            per_1k_prompt,
            per_1k_completion,
            period,
            period_millibeans,
            default_grant_millibeans,
            now_iso(),
            updated_by
        ],
    )?;
    Ok(())
}

/// Start of the current quota period as an RFC 3339 timestamp.
pub fn period_start(period: &str) -> String {
    let current = now();
    let start = match period {
        "daily" => current.date_naive().and_hms_opt(0, 0, 0).unwrap(),
        "monthly" => current
            .date_naive()
            .with_day(1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap(),
        _ => return "1970-01-01T00:00:00Z".to_string(),
    };
    crate::util::iso(Utc.from_utc_datetime(&start))
}

pub fn period_reset_at(period: &str) -> Option<String> {
    let current = now();
    let reset = match period {
        "daily" => current.date_naive().and_hms_opt(0, 0, 0).unwrap() + Duration::days(1),
        "monthly" => {
            let first = current.date_naive().with_day(1).unwrap();
            let (year, month) = if first.month() == 12 {
                (first.year() + 1, 1)
            } else {
                (first.year(), first.month() + 1)
            };
            chrono::NaiveDate::from_ymd_opt(year, month, 1)?.and_hms_opt(0, 0, 0)?
        }
        _ => return None,
    };
    Some(crate::util::iso(Utc.from_utc_datetime(&reset)))
}

pub fn account_balance(conn: &Connection, user_id: &str) -> Result<(i64, i64, i64)> {
    Ok(conn
        .query_row(
            "SELECT balance_millibeans, lifetime_granted, lifetime_used FROM quota_accounts WHERE user_id = ?1",
            params![user_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .unwrap_or((0, 0, 0)))
}

pub fn period_used(conn: &Connection, user_id: &str, period: &str) -> Result<i64> {
    let since = period_start(period);
    Ok(conn.query_row(
        "SELECT COALESCE(SUM(millibeans), 0) FROM usage_events WHERE user_id = ?1 AND created_at >= ?2",
        params![user_id, since],
        |row| row.get(0),
    )?)
}

pub fn snapshot(conn: &Connection, user_id: &str, policy: &Policy) -> Result<QuotaSnapshot> {
    let (balance, granted, used) = account_balance(conn, user_id)?;
    let period_used = period_used(conn, user_id, &policy.period)?;
    let limited = policy.period != "none" && policy.period_millibeans > 0;
    let period_remaining = if limited {
        (policy.period_millibeans - period_used).max(0)
    } else {
        i64::MAX
    };
    let available = balance.min(period_remaining);

    Ok(QuotaSnapshot {
        balance_beans: millibeans_to_beans(balance),
        lifetime_granted_beans: millibeans_to_beans(granted),
        lifetime_used_beans: millibeans_to_beans(used),
        period: policy.period.clone(),
        period_limit_beans: if limited {
            millibeans_to_beans(policy.period_millibeans)
        } else {
            0.0
        },
        period_used_beans: millibeans_to_beans(period_used),
        period_remaining_beans: if limited {
            millibeans_to_beans(period_remaining.max(0))
        } else {
            0.0
        },
        period_resets_at: period_reset_at(&policy.period),
        available_beans: if available == i64::MAX {
            millibeans_to_beans(balance)
        } else {
            millibeans_to_beans(available)
        },
    })
}

pub fn ledger_page(
    conn: &Connection,
    user_id: Option<&str>,
    page: i64,
    page_size: i64,
) -> Result<(Vec<LedgerEntry>, i64)> {
    let offset = (page - 1).max(0) * page_size;
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM quota_ledger WHERE (?1 IS NULL OR user_id = ?1)",
        params![user_id],
        |row| row.get(0),
    )?;
    let mut statement = conn.prepare(
        "SELECT l.id, l.user_id, COALESCE(u.email, '(已删除)'), l.delta_millibeans, l.kind, l.reason,
                l.balance_after, l.created_at
         FROM quota_ledger l LEFT JOIN users u ON u.id = l.user_id
         WHERE (?1 IS NULL OR l.user_id = ?1)
         ORDER BY l.created_at DESC, l.rowid DESC
         LIMIT ?2 OFFSET ?3",
    )?;
    let rows = statement.query_map(params![user_id, page_size, offset], |row| {
        Ok(LedgerEntry {
            id: row.get(0)?,
            user_id: row.get(1)?,
            user_email: row.get(2)?,
            delta_beans: millibeans_to_beans(row.get::<_, i64>(3)?),
            kind: row.get(4)?,
            reason: row.get(5)?,
            balance_after_beans: millibeans_to_beans(row.get::<_, i64>(6)?),
            created_at: row.get(7)?,
        })
    })?;
    let mut entries = Vec::new();
    for row in rows {
        entries.push(row?);
    }
    Ok((entries, total))
}

pub fn usage_trend(conn: &Connection, days: i64) -> Result<Vec<DailyUsage>> {
    let since = crate::util::iso(now() - Duration::days(days.max(1)));
    let mut statement = conn.prepare(
        "SELECT substr(created_at, 1, 10) AS day, COALESCE(SUM(millibeans), 0), COUNT(*)
         FROM usage_events WHERE created_at >= ?1
         GROUP BY day ORDER BY day ASC",
    )?;
    let rows = statement.query_map(params![since], |row| {
        Ok(DailyUsage {
            day: row.get(0)?,
            beans: millibeans_to_beans(row.get::<_, i64>(1)?),
            requests: row.get(2)?,
        })
    })?;
    let mut trend = Vec::new();
    for row in rows {
        trend.push(row?);
    }
    Ok(trend)
}

/// Grants beans to an account and records the ledger entry in one transaction.
pub fn grant(
    conn: &mut Connection,
    user_id: &str,
    millibeans: i64,
    reason: &str,
    actor_user_id: Option<&str>,
) -> Result<i64> {
    let tx = conn.transaction()?;
    let (balance, _granted, used) = {
        let row = tx
            .query_row(
                "SELECT balance_millibeans, lifetime_granted, lifetime_used FROM quota_accounts WHERE user_id = ?1",
                params![user_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)),
            )
            .optional()?;
        row.unwrap_or((0, 0, 0))
    };
    let next_balance = balance.saturating_add(millibeans);
    let next_granted = if millibeans > 0 {
        _granted.saturating_add(millibeans)
    } else {
        _granted
    };
    let now = now_iso();

    tx.execute(
        "INSERT INTO quota_accounts (user_id, balance_millibeans, lifetime_granted, lifetime_used, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (user_id) DO UPDATE SET balance_millibeans = ?2, lifetime_granted = ?3, updated_at = ?5",
        params![user_id, next_balance, next_granted, used, now],
    )?;
    tx.execute(
        "INSERT INTO quota_ledger (id, user_id, delta_millibeans, kind, reason, request_id, balance_after, actor_user_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8)",
        params![
            new_id(),
            user_id,
            millibeans,
            if millibeans >= 0 { "grant" } else { "adjust" },
            reason,
            next_balance,
            actor_user_id,
            now
        ],
    )?;
    tx.commit()?;
    Ok(next_balance)
}

/// Charges one usage report. The read-check-write sequence runs inside a single
/// transaction, so concurrent reports cannot overspend a balance or a period cap.
pub fn charge(
    conn: &mut Connection,
    input: ChargeInput<'_>,
    policy: &Policy,
) -> Result<ChargeOutcome> {
    let tx = conn.transaction()?;

    let existing: Option<(i64, i64)> = tx
        .query_row(
            "SELECT e.millibeans, COALESCE(q.balance_millibeans, 0)
             FROM usage_events e LEFT JOIN quota_accounts q ON q.user_id = e.user_id
             WHERE e.request_id = ?1",
            params![input.request_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((charged, balance)) = existing {
        return Ok(ChargeOutcome::Duplicate {
            charged_millibeans: charged,
            balance_millibeans: balance,
        });
    }

    let cost = tokens_to_millibeans(
        input.prompt_tokens,
        input.completion_tokens,
        policy.millibeans_per_1k_prompt,
        policy.millibeans_per_1k_completion,
    );

    let (balance, _granted, used) = tx
        .query_row(
            "SELECT balance_millibeans, lifetime_granted, lifetime_used FROM quota_accounts WHERE user_id = ?1",
            params![input.user_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)),
        )
        .optional()?
        .unwrap_or((0, 0, 0));

    let since = period_start(&policy.period);
    let period_used: i64 = tx.query_row(
        "SELECT COALESCE(SUM(millibeans), 0) FROM usage_events WHERE user_id = ?1 AND created_at >= ?2",
        params![input.user_id, since],
        |row| row.get(0),
    )?;

    let limited = policy.period != "none" && policy.period_millibeans > 0;
    let period_remaining = if limited {
        (policy.period_millibeans - period_used).max(0)
    } else {
        i64::MAX
    };
    let available = balance.min(period_remaining);

    if cost > available {
        return Ok(ChargeOutcome::Insufficient {
            required_millibeans: cost,
            available_millibeans: if available == i64::MAX {
                balance
            } else {
                available
            },
        });
    }

    let next_balance = balance - cost;
    let now = now_iso();
    let total_tokens = input.prompt_tokens.max(0) + input.completion_tokens.max(0);

    tx.execute(
        "UPDATE quota_accounts SET balance_millibeans = ?1, lifetime_used = ?2, updated_at = ?3 WHERE user_id = ?4",
        params![next_balance, used.saturating_add(cost), now, input.user_id],
    )?;
    tx.execute(
        "INSERT INTO usage_events (id, user_id, gateway_id, model, prompt_tokens, completion_tokens, total_tokens, millibeans, request_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            new_id(),
            input.user_id,
            input.gateway_id,
            input.model,
            input.prompt_tokens,
            input.completion_tokens,
            total_tokens,
            cost,
            input.request_id,
            now
        ],
    )?;
    tx.execute(
        "INSERT INTO quota_ledger (id, user_id, delta_millibeans, kind, reason, request_id, balance_after, actor_user_id, created_at)
         VALUES (?1, ?2, ?3, 'charge', ?4, ?5, ?6, NULL, ?7)",
        params![
            new_id(),
            input.user_id,
            -cost,
            input.model,
            input.request_id,
            next_balance,
            now
        ],
    )?;
    tx.commit()?;

    Ok(ChargeOutcome::Applied {
        charged_millibeans: cost,
        balance_millibeans: next_balance,
        period_used_millibeans: period_used + cost,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn seed(db: &Db) {
        let guard = db.lock_for_tests();
        crate::domain::users::create(
            &guard,
            "u1",
            "a@company.com",
            "张三",
            "hash",
            "member",
            10_000,
        )
        .unwrap();
    }

    #[test]
    fn charge_deducts_once_per_request_id() {
        let db = Db::in_memory().unwrap();
        seed(&db);
        let mut guard = db.lock_for_tests();
        let guard: &mut Connection = &mut guard;
        let policy = load_policy(guard).unwrap();
        let input = || ChargeInput {
            user_id: "u1",
            request_id: "req-1",
            gateway_id: None,
            model: Some("gpt-4o"),
            prompt_tokens: 1_000,
            completion_tokens: 0,
        };
        let first = charge(guard, input(), &policy).unwrap();
        let ChargeOutcome::Applied {
            charged_millibeans,
            balance_millibeans,
            ..
        } = first
        else {
            panic!("expected applied");
        };
        assert_eq!(charged_millibeans, policy.millibeans_per_1k_prompt);
        assert_eq!(balance_millibeans, 10_000 - charged_millibeans);

        let second = charge(guard, input(), &policy).unwrap();
        assert!(matches!(second, ChargeOutcome::Duplicate { .. }));
    }

    #[test]
    fn charge_refuses_when_balance_is_exhausted() {
        let db = Db::in_memory().unwrap();
        seed(&db);
        let mut guard = db.lock_for_tests();
        let guard: &mut Connection = &mut guard;
        let mut policy = load_policy(guard).unwrap();
        policy.millibeans_per_1k_prompt = 20_000;
        let outcome = charge(
            guard,
            ChargeInput {
                user_id: "u1",
                request_id: "req-2",
                gateway_id: None,
                model: None,
                prompt_tokens: 1_000,
                completion_tokens: 0,
            },
            &policy,
        )
        .unwrap();
        assert!(matches!(outcome, ChargeOutcome::Insufficient { .. }));
    }

    #[test]
    fn daily_cap_limits_available_quota() {
        let db = Db::in_memory().unwrap();
        seed(&db);
        let mut guard = db.lock_for_tests();
        let guard: &mut Connection = &mut guard;
        let mut policy = load_policy(guard).unwrap();
        policy.period = "daily".to_string();
        policy.period_millibeans = 500;
        policy.millibeans_per_1k_prompt = 400;
        let applied = charge(
            guard,
            ChargeInput {
                user_id: "u1",
                request_id: "req-3",
                gateway_id: None,
                model: None,
                prompt_tokens: 1_000,
                completion_tokens: 0,
            },
            &policy,
        )
        .unwrap();
        assert!(matches!(applied, ChargeOutcome::Applied { .. }));
        let blocked = charge(
            guard,
            ChargeInput {
                user_id: "u1",
                request_id: "req-4",
                gateway_id: None,
                model: None,
                prompt_tokens: 1_000,
                completion_tokens: 0,
            },
            &policy,
        )
        .unwrap();
        assert!(matches!(blocked, ChargeOutcome::Insufficient { .. }));
    }

    #[test]
    fn grants_are_recorded_in_the_ledger() {
        let db = Db::in_memory().unwrap();
        seed(&db);
        let mut guard = db.lock_for_tests();
        let guard: &mut Connection = &mut guard;
        let balance = grant(guard, "u1", 2_500, "季度补充", Some("admin-1")).unwrap();
        assert_eq!(balance, 12_500);
        let (entries, total) = ledger_page(guard, Some("u1"), 1, 10).unwrap();
        assert_eq!(total, 2);
        assert_eq!(entries[0].balance_after_beans, 12.5);
    }
}
