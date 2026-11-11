# Control Plane Deployment (Linux)

The control plane is a standalone Rust service that owns employee accounts,
gateway configuration, and the Xiaozhi-bean quota ledger. It serves the admin
console and the JSON API used by the desktop client.

```
Internet → nginx (TLS) → control-plane (127.0.0.1:8787) → SQLite + SMTP
```

## 1. Build

On a build host with the repository and toolchain:

```bash
pnpm --filter @pi-desktop/control-plane-web build
cargo build --release -p control-plane
```

Artifacts:

- `target/release/control-plane` (or `control-plane.exe`)
- `apps/control-plane/web/dist/` (static admin console)

## 2. Install

```bash
sudo useradd --system --home /var/lib/control-plane --shell /usr/sbin/nologin controlplane
sudo install -d -o controlplane -g controlplane /var/lib/control-plane
sudo install -d /opt/control-plane/bin /opt/control-plane/web
sudo install -m 0755 target/release/control-plane /opt/control-plane/bin/control-plane
sudo cp -r apps/control-plane/web/dist/. /opt/control-plane/web/
sudo install -d -m 0750 /etc/control-plane
sudo install -m 0640 -g controlplane deploy/env.example /etc/control-plane/control-plane.env
sudo install -m 0644 deploy/control-plane.service /etc/systemd/system/control-plane.service
```

Edit `/etc/control-plane/control-plane.env`:

- `CONTROL_PLANE_SECRET`: at least 32 random characters (`openssl rand -hex 32`).
- `CONTROL_PLANE_PUBLIC_URL`: the HTTPS origin employees use.
- `CONTROL_PLANE_ADMIN_EMAILS`: addresses that become administrators on
  registration.
- `CONTROL_PLANE_SMTP_*`: mailbox and authorization code for verification mail.

`CONTROL_PLANE_SECRET` must stay stable: it signs access tokens and derives the
key that encrypts stored gateway credentials. Rotating it invalidates all
sessions and makes saved gateway keys unreadable.

## 3. Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now control-plane
sudo systemctl status control-plane
curl -fsS http://127.0.0.1:8787/healthz
curl -fsS http://127.0.0.1:8787/readyz
```

`readyz` also returns the mail transport so you can confirm SMTP was picked up.
If SMTP is not configured the service still starts and prints verification codes
to the journal — usable for a pilot, not for production.

### Mail self-check

```bash
sudo -u controlplane env $(grep -v '^#' /etc/control-plane/control-plane.env | xargs) \
  /opt/control-plane/control-plane --check-mail you@company.com
```

It sends one real message and exits non-zero when the relay rejects the
credentials, the TLS handshake fails, or the sender address is not allowed.
Unlike the service start-up path it never falls back to the log transport, so a
green command is proof that mail actually left the box. Nothing secret is
printed: only the relay host, port and TLS mode.

### 163 / 126 (NetEase) mailboxes

```
CONTROL_PLANE_SMTP_HOST=smtp.163.com
CONTROL_PLANE_SMTP_PORT=465
CONTROL_PLANE_SMTP_TLS=implicit
CONTROL_PLANE_SMTP_USERNAME=<mailbox>@163.com
CONTROL_PLANE_SMTP_FROM_EMAIL=<mailbox>@163.com
CONTROL_PLANE_SMTP_PASSWORD=<authorization code>
```

1. Enable **SMTP服务** in the mailbox settings and create an **授权码**; the
   account password cannot be used here.
2. `FROM_EMAIL` must equal `USERNAME`; NetEase refuses a foreign sender.
3. The code is usually shown in four groups (`abcd efgh ijkl mnop`). Spaces are
   stripped before use, so paste it either way.
4. NetEase throttles aggressively (a few hundred messages per day) and repeated
   failed logins can lock the SMTP service temporarily. Run `--check-mail` when a
   registration code does not arrive.

## 4. Reverse proxy

```bash
sudo install -m 0644 deploy/nginx.conf.example /etc/nginx/conf.d/control-plane.conf
sudo nginx -t && sudo systemctl reload nginx
```

Keep `CONTROL_PLANE_TRUST_PROXY=true` only when a trusted proxy forwards
`X-Forwarded-For`; otherwise audit entries record the proxy address.

## 5. First administrator

1. Register with an address listed in `CONTROL_PLANE_ADMIN_EMAILS`.
2. Sign in, open **网关配置**, add the company gateway with its API key.
3. Open **配额策略** and confirm the bean-to-token conversion and period cap.
4. Distribute the desktop client pointing at this origin.

### LAN pilot without a certificate

An internal trial can run the service over plain HTTP on a private address, but
two things must line up:

1. `CONTROL_PLANE_PUBLIC_URL=http://10.120.65.148:18787` so the proxy endpoint
   handed to the desktop matches the reachable origin.
2. On each desktop, `PI_DESKTOP_ALLOW_INSECURE_CONTROL_PLANE=1`. Without it the
   client refuses every non-loopback `http://` origin and blocks the workspace,
   because session and gateway tokens would otherwise cross the network in the
   clear. The switch only unlocks RFC1918 / IPv6 ULA hosts — a public host is
   refused even with it set.

Treat this as temporary. Anyone on the same segment can read a captured token,
and a gateway token stays valid for up to `CONTROL_PLANE_GATEWAY_TOKEN_DAYS`.
Move to TLS before rolling out beyond the pilot.

### Model traffic

`/api/v1/gateway/` relays OpenAI-compatible requests to the configured gateway
and injects the vendor credential, so employees never see the upstream key. Two
properties matter operationally:

- Streaming is byte-for-byte passthrough. The proxy adds
  `stream_options.include_usage` so the trailing frame carries token counts, and
  it does **no** per-chunk work. Keep `proxy_buffering off` in nginx, otherwise
  the first token waits for the whole answer.
- Billing is client-reported: the desktop sends one `POST /api/v1/usage/charge`
  per finished turn, and the server applies the quota policy. The proxy only
  pre-checks the balance, so a small server does no accounting in the hot path.
  A modified client can under-report tokens; the ledger still records every
  charge with its actor for review.

The desktop obtains a gateway-scoped token from `/api/v1/auth/gateway-token` and
stores it in the provider row. That token cannot call `/me` or the admin API, and
it dies with the session on logout, disabling, or a password reset.

## 6. Backup and restore

```bash
sudo install -m 0750 deploy/backup.sh /usr/local/bin/control-plane-backup
echo '0 3 * * * root /usr/local/bin/control-plane-backup >> /var/log/control-plane-backup.log 2>&1' | sudo tee /etc/cron.d/control-plane-backup
```

Restore:

```bash
sudo systemctl stop control-plane
sudo cp /var/backups/control-plane/control-plane-<stamp>.db /var/lib/control-plane/control-plane.db
sudo chown controlplane:controlplane /var/lib/control-plane/control-plane.db
sudo systemctl start control-plane
curl -fsS http://127.0.0.1:8787/readyz
```

## 7. Operations

| Task | Command |
| --- | --- |
| Logs | `journalctl -u control-plane -f` |
| Restart | `sudo systemctl restart control-plane` |
| Uptime check | `curl -fsS https://<origin>/readyz` |
| Schema version | `sqlite3 /var/lib/control-plane/control-plane.db 'PRAGMA user_version;'` |

Migrations run automatically at startup and are append-only. A binary refuses
to start against a database created by a newer schema version, so upgrade the
service before rolling back data.

## 8. Security notes

- The service binds to loopback by default; do not expose `8787` publicly.
- SMTP credentials and gateway API keys live only in the environment or in the
  encrypted database column. They are never returned by the API.
- Passwords use Argon2; refresh tokens are stored as SHA-256 hashes and are
  rotated on every refresh.
- Verification codes expire, are single-use, and are rate limited per mailbox.
- Disabling an employee revokes their sessions immediately.
- The admin console keeps the browser session in Web Storage, so the console
  origin must always be served over TLS and must not share its origin with
  untrusted content. The CSP in `nginx.conf.example` restricts scripts to the
  bundle itself; keep it in place when you copy the configuration.
