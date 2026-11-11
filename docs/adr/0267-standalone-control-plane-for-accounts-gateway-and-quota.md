# ADR 0267: Standalone Control Plane for Employee Accounts, Gateway Configuration, and Xiaozhi-Bean Quotas

- **Status**: Accepted
- **Date**: 2026-11-11
- **Related**: [ADR 0004](0004-no-gateway-in-mvp.md) ·
  [ADR 0010](0010-rust-backend-host-core.md) ·
  [ADR 0011](0011-host-rpc-and-storage-defaults.md) ·
  [ADR 0205](0205-remote-agent-control-boundary.md) ·
  [06-delivery/04-e2e-test-plan](../spec/06-delivery/04-e2e-test-plan.md)

## Context

The company distributes PI-Desktop to employees and needs a centrally managed
deployment: employee accounts with email registration and password reset,
unified LLM gateway configuration, and per-user quotas denominated in
"Xiaozhi beans" (小智豆), a server-defined unit convertible to tokens.

ADR 0004 excluded a remote Gateway from the MVP and ADR 0205 schedules the
remote Agent Host / Gateway control plane for a post-MVP milestone. This
request is a different, narrower surface: an internal **management and
entitlement plane** for account lifecycle, gateway configuration, and quota
accounting. It does not move agent execution, session persistence, or the host
protocol to the server, and it does not reopen the deferred Gateway/WebUI
scope.

## Decision

1. **A standalone Rust service `apps/control-plane` owns employee identity,
   gateway configuration, and the Xiaozhi-bean ledger.** It is a separate
   workspace crate with its own SQLite database, its own migration sequence,
   and its own process. It shares the repository's Rust conventions but not
   the host-core `user_version` chain, the local client database, or the host
   JSON-RPC protocol.
2. **The control plane is additive to the desktop.** The Electron desktop
   remains local-first. The renderer gains a startup login gate that calls the
   control plane through new main-process IPC; sessions, transcripts, and
   agent execution stay exactly where ADR 0011 places them. If the control
   plane is unreachable, the desktop reports the outage and does not fabricate
   entitlements.
3. **The server is the sole authority for quota.** Xiaozhi-bean balances are
   stored and mutated only by the control plane, inside transactions.
   Deduction happens server-side before or while usage is metered; clients
   render balances but cannot write them. The bean-to-token conversion rule
   is a server configuration value, never a client-supplied field.
4. **Gateway secrets never leave the server.** The desktop receives resolved
   gateway connection metadata only for features that require it, and
   renderer surfaces show at most masked identifiers. SMTP credentials,
   signing keys, and provider API keys are injected through Linux environment
   variables or secret files and are never written to the database in
   plaintext, to logs, or to the repository.
5. **Authentication uses short-lived access tokens plus revocable refresh
   sessions.** Passwords are stored with a memory-hard hash (argon2).
   Email verification and password reset use expiring, single-purpose codes
   with per-mailbox rate limits and attempt caps. All administrative actions
   are recorded in an audit table.
6. **The admin console is a server-rendered SPA served by the control plane**,
   styled as a dark blue-gray enterprise console. It covers overview, users,
   gateways, quota policy, the usage ledger, audit, and system status. Every
   page implements loading, empty, error, and permission-denied states, and
   destructive actions require explicit confirmation.
7. **Deployment targets Linux with systemd, a TLS-terminating reverse proxy,
   migration commands, health checks, and backup scripts.** The service binds
   to loopback by default; external access goes through the proxy.

## Amendment: streaming proxy, gateway scopes, client-reported usage

Added after the first rollout, on a single small deployment.

1. **The gateway proxy relays streams.** The agent runtime always requests
   `stream: true`, so a proxy that buffers or rejects streams cannot serve as a
   provider. `/api/v1/gateway/chat/completions` forwards the upstream body
   chunk by chunk and rewrites the request to add
   `stream_options.include_usage`, which is the only place token counts appear.
   The reverse proxy must keep buffering off for that location.
2. **The runtime gets its own scoped credential.** A session access token lives
   15 minutes, which is useless as a persisted provider credential. A gateway
   token carries `scope = "gateway"`, lives up to
   `CONTROL_PLANE_GATEWAY_TOKEN_DAYS`, and stays bound to the session row it was
   minted from, so existing revocation paths apply without a schema change.
   Session routes reject it with `403 FORBIDDEN_SCOPE`.
3. **Usage is reported by the client, priced by the server.** The proxy does not
   charge; the desktop reports `promptTokens` / `completionTokens` per settled
   turn to `POST /api/v1/usage/charge`. This was chosen to keep the hot path free
   of accounting on a low-spec host. Accepted risk: a modified client can
   under-report tokens. Price, period cap, and balance remain server-side,
   `request_id` makes retries idempotent, and every charge is audited.

## Consequences

- A new deployment surface (service, database, secrets) enters operations. The
  spec and delivery docs describe setup, migration, backup, and recovery.
- The desktop's first-run flow changes: an unauthenticated employee sees a
  login screen before the workspace. Existing local features remain usable
  after login; no local data is deleted by authentication state.
- E2E coverage gains control-plane scenarios (`E2E-CP-*`) for registration
  codes, login, quota deduction, gateway admin, and service-outage behavior.
- The deferred remote Gateway scope of ADR 0205 remains deferred; this ADR
  does not schedule it and does not expose the host protocol remotely.

## Alternatives

- **Fold account/quota management into host-core** — rejected: it couples
  server-only identity to a per-desktop SQLite file and breaks the frozen
  storage ownership model.
- **Node.js/TypeScript service** — rejected for now: the repository already
  owns a Rust service pattern, and the ledger needs strong transactional
  guarantees Rust provides naturally. Revisit only if operational constraints
  change.
- **Defer to the ADR 0205 Gateway** — rejected: that design targets agent
  session control, not employee account administration, and remains
  unscheduled.
