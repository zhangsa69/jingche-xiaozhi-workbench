use std::collections::HashMap;
use std::sync::Mutex;

use chrono::{DateTime, Duration, Utc};

use crate::util::now;

const WINDOW_MINUTES: i64 = 15;
const MAX_TRACKED_KEYS: usize = 20_000;

#[derive(Debug, Clone)]
struct Failures {
    count: i64,
    window_start: DateTime<Utc>,
}

/// Sliding-window failure counter for password logins. Kept in memory because a
/// restart should not preserve an attacker's progress, and the control plane
/// runs as a single process behind the reverse proxy.
#[derive(Debug, Default)]
pub struct LoginGuard {
    failures: Mutex<HashMap<String, Failures>>,
}

impl LoginGuard {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_blocked(&self, key: &str, max_failures: i64) -> bool {
        let mut guard = self
            .failures
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = now();
        match guard.get(key) {
            Some(entry) if now - entry.window_start < Duration::minutes(WINDOW_MINUTES) => {
                entry.count >= max_failures
            }
            Some(_) => {
                guard.remove(key);
                false
            }
            None => false,
        }
    }

    pub fn record_failure(&self, key: &str) {
        let mut guard = self
            .failures
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.len() > MAX_TRACKED_KEYS {
            let cutoff = now() - Duration::minutes(WINDOW_MINUTES);
            guard.retain(|_, entry| entry.window_start > cutoff);
        }
        let now = now();
        let entry = guard.entry(key.to_string()).or_insert(Failures {
            count: 0,
            window_start: now,
        });
        if now - entry.window_start >= Duration::minutes(WINDOW_MINUTES) {
            entry.count = 0;
            entry.window_start = now;
        }
        entry.count += 1;
    }

    pub fn clear(&self, key: &str) {
        let mut guard = self
            .failures
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.remove(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_after_reaching_the_threshold() {
        let guard = LoginGuard::new();
        assert!(!guard.is_blocked("a@b.com|127.0.0.1", 3));
        guard.record_failure("a@b.com|127.0.0.1");
        guard.record_failure("a@b.com|127.0.0.1");
        guard.record_failure("a@b.com|127.0.0.1");
        assert!(guard.is_blocked("a@b.com|127.0.0.1", 3));
        guard.clear("a@b.com|127.0.0.1");
        assert!(!guard.is_blocked("a@b.com|127.0.0.1", 3));
    }
}
