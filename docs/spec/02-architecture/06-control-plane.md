# 06. Company Control Plane

> Scope: employee identity, gateway configuration, and Xiaozhi-bean quota for
> company deployments of PI-Desktop.
> Status: Accepted (ADR 0267)
> Cross-references: [01-architecture](01-architecture.md) ·
> [ADR 0267](../../adr/0267-standalone-control-plane-for-accounts-gateway-and-quota.md) ·
> [deploy README](../../../apps/control-plane/deploy/README.md) ·
> [E2E plan](../06-delivery/04-e2e-test-plan.md)

---

## 1. Position in the process model

The control plane is **additive**. It does not move agent execution, session
storage, or the host protocol off the desktop.

```text
Renderer  ── preload IPC ──►  Electron Main  ── HTTPS ──►  control-plane (Linux)
    │                              │                            │
    └─ UI, gate, quota chip        └─ session + tokens          └─ SQLite (own DB),
                                      (never rendered)             SMTP, gateway proxy
```

Hard rules:

- Tokens, SMTP credentials, gateway keys, and the server database never reach
  the renderer.
- The renderer sees only an identity and quota projection (`ControlPlaneStatus`).
- A deployment with no control plane (`required: false`) behaves exactly like a
  local install.

## 2. Repository layout

| Path | Responsibility |
|---|---|
| `apps/control-plane/src/main.rs` | Process entry, tracing, graceful shutdown |
| `apps/control-plane/src/config.rs` | Environment configuration and validation |
| `apps/control-plane/src/api/` | HTTP routes: auth, me, usage, gateway proxy, admin |
| `apps/control-plane/src/auth/` | Password hashing, token signing, verification codes |
| `apps/control-plane/src/domain/` | Users, gateways, quota ledger, audit |
| `apps/control-plane/migrations/` | Versioned SQLite schema |
| `apps/control-plane/web/` | Admin console (React + Vite) |
| `apps/control-plane/deploy/` | systemd unit, nginx example, env example, backup script |
| `apps/desktop/electron/main/control-plane-client.ts` | Desktop client, session persistence |
| `apps/desktop/electron/main/ipc/control-plane-ipc.ts` | IPC channels and input validation |
| `apps/desktop/src/features/auth/` | Startup gate, sign-in, account chip |

The control plane is a separate workspace crate with its own database and its
own migration sequence. It does not reuse the host-core `user_version` chain and
must not touch the client database.

## 3. Data model

| Table | Purpose |
|---|---|
| `users` | Account, display name, role, status, password hash |
| `email_codes` | Verification codes with purpose, expiry, attempts |
| `sessions` | Refresh-token hashes, expiry, revocation, user agent |
| `gateways` | Provider base URL, model, encrypted credential, default flag |
| `quota_accounts` | Authoritative balance in millibeans |
| `quota_ledger` | Every grant/adjust with actor and running balance |
| `usage_events` | Per-request token and bean accounting (`request_id` unique) |
| `quota_policy` | Token→bean conversion, default grant, period cap |
| `audit_log` | Actor, action, target, payload, IP, timestamp |

Indexes cover the access paths that matter operationally: `users(status)`,
`users(created_at)`, `quota_ledger(user_id, created_at)`,
`usage_events(user_id, created_at)`, `usage_events(created_at DESC)`,
`audit_log(created_at DESC)`, and `audit_log(action, created_at DESC)`.

## 4. Identity lifecycle

1. **Request code** (`POST /api/v1/auth/register/code`) — rejects an existing
   address, enforces a per-address cooldown, an hourly cap, and an IP window.
2. **Register** (`POST /api/v1/auth/register`) — consumes the code, validates
   password strength (≥ 10 chars, no surrounding whitespace, blocklist), grants
   `default_grant_millibeans`, and issues a session immediately.
3. **Login** (`POST /api/v1/auth/login`) — failures increment a per
   `email|ip` guard; reaching the limit returns `429` for 15 minutes. Successful
   login clears the guard and records an audit event.
4. **Refresh** (`POST /api/v1/auth/refresh`) — rotates the refresh hash in place;
   a revoked, expired, or disabled account returns `SESSION_REVOKED`.
5. **Logout** (`POST /api/v1/auth/logout`) — revokes the refresh session. The
   desktop clears local state even when the call fails.
6. **Reset** (`POST /api/v1/auth/password/reset`) — consumes a reset code,
   replaces the hash, and revokes **all** sessions for the account.

Access tokens are short-lived (`CONTROL_PLANE_ACCESS_TTL_SECONDS`, default 900)
and signed with `CONTROL_PLANE_SECRET`. Refresh tokens are stored hashed and
are rotated on every refresh.

Password reset for an unknown address returns the same message as a known one
so the endpoint cannot enumerate employees.

## 5. Xiaozhi-bean ledger

The server is the sole authority.

- Balances are stored as integer **millibeans** to avoid floating-point drift.
- `quota_policy` holds `millibeans_per_1k_prompt`,
  `millibeans_per_1k_completion`, `default_grant_millibeans`, `period`
  (`daily` | `weekly` | `monthly` | `none`) and `period_millibeans`.
- Conversion happens **only** on the server. A client cannot submit its own
  rate, price, or balance.
- `charge` runs read-check-write inside one SQLite transaction, so concurrent
  reports cannot overspend a balance or a period cap.
- `usage_events.request_id` is unique: a retried report returns
  `Duplicate` with the original charge instead of double-billing.
- An exhausted balance or period cap returns `402 INSUFFICIENT_QUOTA`.

Grants and manual adjustments append to `quota_ledger` with an actor, a reason,
and the resulting balance, so every balance change is explainable.

**Who charges.** The proxy does not charge. The desktop reports one
`POST /api/v1/usage/charge` per finished turn with `promptTokens` and
`completionTokens`; the server applies the policy. This keeps a small
deployment's hot path free of accounting, at the cost of trusting the client's
token counts: a modified client can under-report. The price, period cap, and
balance stay server-side, every charge is audited with its actor, and
`request_id` makes a retried report idempotent. The proxy still pre-checks the
balance so an exhausted account cannot start a turn.

## 6. Gateway configuration

- Gateway records hold provider, base URL, default model, enabled flag, and the
  credential sealed with the deployment secret.
- The admin console shows a masked credential; the plaintext is never returned
  by any read endpoint and never written to logs.
- `POST /api/v1/admin/gateways/{id}/test` performs a bounded probe and reports
  the outcome without echoing the key.
- Employees call `POST /api/v1/gateway/chat/completions`; the server injects the
  credential and relays the response. Streamed answers are forwarded
  byte-for-byte from the first chunk (the reverse proxy must keep
  `proxy_buffering off`), and the request is rewritten to add
  `stream_options.include_usage` so the trailing frame carries token counts for
  the client to report.
- Upstreams that route on a session id are served a derived
  `x-opencode-session` header, stable for one desktop login. The opencode zen
  endpoint rejects the request outright without it (`400 Request is missing
  x-opencode-session`), which surfaced as `502 GATEWAY_ERROR` in the client.
  Providers that ignore the header are unaffected, and it never carries the
  session row id.
- A gateway-scoped token (see §7) authenticates this route; a full session token
  also works, so the admin console and scripts need no special path.
- Rotating `CONTROL_PLANE_SECRET` makes stored gateway credentials unreadable;
  the keys must be re-entered afterwards. This is documented in the deploy
  guide.

## 7. HTTP surface

Response envelope: `{ "data": ... }` on success,
`{ "error": { "code", "message" } }` on failure.

| Group | Routes |
|---|---|
| Auth | `auth/register/code`, `auth/register`, `auth/login`, `auth/refresh`, `auth/logout`, `auth/password/code`, `auth/password/reset`, `auth/gateway-token` |
| Self | `me`, `me/usage` |
| Usage | `usage/charge` |
| Gateway | `gateway/chat/completions` |
| Admin | `admin/overview`, `admin/users`, `admin/users/{id}`, `admin/users/{id}/grant`, `admin/users/{id}/ledger`, `admin/gateways`, `admin/gateways/{id}`, `admin/gateways/{id}/test`, `admin/quota-policy`, `admin/ledger`, `admin/audit`, `admin/system` |
| Ops | `GET /healthz`, `GET /readyz` |

Error codes used by the desktop: `INVALID_CREDENTIALS`, `SESSION_REVOKED`,
`EMAIL_ALREADY_REGISTERED`, `INSUFFICIENT_QUOTA`, `RATE_LIMITED`, `FORBIDDEN`,
`SERVICE_UNAVAILABLE`.

Admin routes require `role = "admin"`; the role is assigned at registration for
addresses listed in `CONTROL_PLANE_ADMIN_EMAILS`.

### Token scopes

`POST /api/v1/auth/gateway-token` exchanges a session for a token with
`scope = "gateway"`, valid no longer than `CONTROL_PLANE_GATEWAY_TOKEN_DAYS`
(capped by the session expiry). It is bound to the same `sessions` row, so a
logout, a disabled account, or a password reset invalidates it at once, and no
schema change is needed. `AuthUser` rejects gateway-scoped tokens with
`403 FORBIDDEN_SCOPE`, so the credential the runtime holds cannot read `/me`, call
the admin API, or charge the ledger. Tokens minted before scopes existed decode
as `scope = "full"`.

## 8. Desktop integration

- `PI_DESKTOP_CONTROL_PLANE_URL` selects the origin. It is normalized (trailing
  slashes trimmed, scheme required) and takes precedence over the origin stored
  with the session.
- Cleartext HTTP is refused unless the host is loopback, or
  `PI_DESKTOP_ALLOW_INSECURE_CONTROL_PLANE=1` is set **and** the host is RFC1918 /
  IPv6 ULA. The switch exists for internal pilots without a certificate
  authority; it never permits a public host. Without it a configured-but-refused
  origin blocks the workspace with an explanation instead of falling back to
  "no control plane".
- The session file (`control-plane-session.json`, mode `0600`) stores the
  origin, both tokens, and the access-token expiry. Tokens are sealed with
  Electron `safeStorage` when the platform supports it.
- IPC channels: `controlPlaneStatus`, `controlPlaneLogin`,
  `controlPlaneRegister`, `controlPlaneRequestCode`,
  `controlPlaneResetPassword`, `controlPlaneLogout`,
  `controlPlaneRefreshProfile`, plus the `controlPlaneChanged` event.
- **Gateway provider.** After sign-in the main process creates (or refreshes) one
  host-core provider row named 京车小智模型网关: `openai_compatible`, `baseUrl` =
  the proxy endpoint without `/chat/completions`, credential = the gateway token.
  A fingerprint file (`control-plane-provider.json`) avoids a write on every
  refresh; sign-out disables the row.
- **The deployment owns the model row.** When the control plane is required
  (`required: true`), no other model service is allowed. The main process forces
  the gateway row into `defaultProviderId` / `defaultModelId`, switches every
  other provider row off for the length of the session, and repoints sessions
  that still pin a local provider, because a turn resolves `session.providerId`
  before the global default. Sign-out — or a deployment that stops requiring the
  control plane — restores the rows a sync switched off. The renderer hides the
  model settings section, the model picker becomes a read-only label, and
  configuration-error hints no longer deep-link into settings.
- **Usage reporting.** When a turn settles, the main process reports the token
  counts of that turn for turns whose session used that provider row, with
  `sessionId:turnId` as the idempotency key. A transport failure is retried once;
  a client error is not. Balance refresh is throttled to one notification per
  minute so a long conversation cannot spam the renderer.
- `ControlPlaneGate` wraps the app shell. While the status is unknown it shows a
  connecting state; on failure it shows a retry screen and **does not** open the
  workspace, because stale entitlements are not acceptable.
- A `401` on `me` clears the local session and returns the user to sign-in.
- The sidebar account chip shows the employee, the remaining balance, a manual
  refresh, and sign-out (with a second confirmation).

## 9. Deployment requirements

- Reverse proxy terminates TLS; the service listens on loopback.
- `CONTROL_PLANE_SECRET` (≥ 32 chars), `CONTROL_PLANE_PUBLIC_URL`, and
  `CONTROL_PLANE_DATA_DIR` are mandatory; SMTP is required in production.
- Migrations run at startup inside a transaction; a failed migration aborts the
  boot instead of serving a half-migrated schema.
- `systemd` restarts the process on failure; logs go to journald or a rotated
  file.
- `readyz` proves the database answers a query so a proxy can remove a locked or
  corrupt instance from rotation.
- `deploy/backup.sh` takes a consistent SQLite snapshot; the deploy README
  documents restore and rollback.
- `control-plane --check-mail <address>` sends one real message and exits
  non-zero on failure. It bypasses the development log fallback on purpose, so a
  green run proves the relay and credentials work. Nothing secret is printed.

## 10. Failure behavior

| Condition | Desktop behavior |
|---|---|
| No control plane configured | Workspace opens as before (`required: false`) |
| Control plane unreachable | Retry screen; workspace stays closed |
| Access token expired | Silent refresh, then retry once |
| Refresh rejected | Local session cleared, sign-in shown |
| Quota exhausted | `402 INSUFFICIENT_QUOTA` surfaced to the caller |
| Account disabled | `403` on login/refresh, sign-in shown with the server message |
