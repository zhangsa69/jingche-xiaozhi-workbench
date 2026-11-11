-- Control plane schema v1: accounts, sessions, email codes, gateways, quota ledger, audit.
-- Timestamps are RFC 3339 UTC strings so ordering is lexicographic.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE INDEX idx_users_status ON users (status);
CREATE INDEX idx_users_created_at ON users (created_at);

CREATE TABLE email_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_ip TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_email_codes_lookup ON email_codes (email, purpose, created_at);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  refresh_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT,
  user_agent TEXT
);

CREATE INDEX idx_sessions_user ON sessions (user_id);

CREATE TABLE gateways (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT,
  api_key_cipher TEXT,
  api_key_hint TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE quota_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  balance_millibeans INTEGER NOT NULL DEFAULT 0,
  lifetime_granted INTEGER NOT NULL DEFAULT 0,
  lifetime_used INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE quota_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  delta_millibeans INTEGER NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT,
  request_id TEXT,
  balance_after INTEGER NOT NULL,
  actor_user_id TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_quota_ledger_request ON quota_ledger (request_id)
WHERE request_id IS NOT NULL;
CREATE INDEX idx_quota_ledger_user ON quota_ledger (user_id, created_at);

CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  gateway_id TEXT,
  model TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  millibeans INTEGER NOT NULL DEFAULT 0,
  request_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_usage_user_time ON usage_events (user_id, created_at);
CREATE INDEX idx_usage_time ON usage_events (created_at DESC);

CREATE TABLE quota_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  millibeans_per_1k_prompt INTEGER NOT NULL,
  millibeans_per_1k_completion INTEGER NOT NULL,
  period TEXT NOT NULL,
  period_millibeans INTEGER NOT NULL,
  default_grant_millibeans INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

INSERT INTO quota_policy (
  id,
  millibeans_per_1k_prompt,
  millibeans_per_1k_completion,
  period,
  period_millibeans,
  default_grant_millibeans,
  updated_at,
  updated_by
) VALUES (1, 1000, 3000, 'monthly', 500000, 200000, '1970-01-01T00:00:00Z', NULL);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_created_at ON audit_log (created_at DESC);
CREATE INDEX idx_audit_action ON audit_log (action, created_at DESC);
