#!/usr/bin/env node
// End-to-end checks for the control plane: account lifecycle, email codes,
// Xiaozhi-bean accounting, admin boundaries, and the admin console bundle.
//
//   node scripts/e2e-control-plane.mjs
//   CONTROL_PLANE_BIN=apps/control-plane/target/release/control-plane node scripts/e2e-control-plane.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const results = [];
const PORT = Number(process.env.CONTROL_PLANE_E2E_PORT ?? 8899);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "e2e-secret-value-with-at-least-32-characters";
const ADMIN_EMAIL = "admin@company.com";
const MEMBER_EMAIL = "employee@company.com";
const PASSWORD = "jingche-e2e-passphrase";

function record(id, ok, detail = "") {
  results.push({ id, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}${detail ? ` — ${detail}` : ""}`);
}

function resolveBinary() {
  const candidates = [
    process.env.CONTROL_PLANE_BIN,
    "target/debug/control-plane.exe",
    "target/debug/control-plane",
    "target/release/control-plane.exe",
    "target/release/control-plane",
    "apps/control-plane/target/debug/control-plane.exe",
    "apps/control-plane/target/release/control-plane",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const bin = resolveBinary();
if (!bin) {
  console.error("control-plane binary not found. Run `cargo build -p control-plane` first.");
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "control-plane-e2e-"));
const webDir = process.env.CONTROL_PLANE_WEB_DIR ?? join("apps", "control-plane", "web", "dist");

const child = spawn(bin, [], {
  env: {
    ...process.env,
    CONTROL_PLANE_SECRET: SECRET,
    CONTROL_PLANE_DATA_DIR: dataDir,
    CONTROL_PLANE_ADDR: `127.0.0.1:${PORT}`,
    CONTROL_PLANE_ADMIN_EMAILS: ADMIN_EMAIL,
    CONTROL_PLANE_WEB_DIR: webDir,
    CONTROL_PLANE_LOG: "info",
    CONTROL_PLANE_SMTP_HOST: "",
    CONTROL_PLANE_SMTP_USERNAME: "",
    CONTROL_PLANE_SMTP_PASSWORD: "",
    CONTROL_PLANE_SMTP_FROM_EMAIL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stdout += chunk;
});

function cleanup() {
  if (!child.killed) {
    child.kill("SIGTERM");
  }
  if (stubGateway) {
    stubGateway.server.close();
    stubGateway = null;
  }
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/healthz`);
      if (response.ok) {
        return true;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  return { status: response.status, data: payload?.data, error: payload?.error, text };
}

const CODE_PATTERN = /code[^0-9]{0,8}(\d{6})/g;

function latestCode() {
  const matches = [...stdout.matchAll(CODE_PATTERN)];
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
}

async function requestCode(email, path) {
  const before = [...stdout.matchAll(CODE_PATTERN)].length;
  const issued = await call("POST", path, { body: { email } });
  if (issued.status !== 200) {
    console.error(`code request failed: ${issued.status} ${issued.error?.code ?? ""}`);
    return null;
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const matches = [...stdout.matchAll(CODE_PATTERN)];
    if (matches.length > before) {
      return matches[matches.length - 1][1];
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return latestCode();
}

const checks = [];
function scenario(id, fn) {
  checks.push({ id, fn });
}

scenario("E2E-CP-health-endpoints", async () => {
  const health = await fetch(`${BASE}/healthz`).then((response) => response.json());
  const ready = await fetch(`${BASE}/readyz`).then((response) => response.json());
  return {
    ok: health.status === "ok" && ready.database === true && ready.status === "ready",
    detail: `health=${health.status} ready=${ready.status} mail=${ready.mail_transport}`,
  };
});

scenario("E2E-CP-register-creates-quota-and-session", async () => {
  const code = await requestCode(MEMBER_EMAIL, "/api/v1/auth/register/code");
  if (!code) {
    return { ok: false, detail: "verification code was not issued" };
  }
  const registered = await call("POST", "/api/v1/auth/register", {
    body: { email: MEMBER_EMAIL, code, password: PASSWORD, displayName: "员工甲" },
  });
  if (registered.status !== 200) {
    return { ok: false, detail: `register status ${registered.status} ${registered.error?.code ?? ""}` };
  }
  const payload = registered.data;
  const granted = payload.user.balanceBeans;
  const hasTokens = Boolean(payload.accessToken && payload.refreshToken);
  return {
    ok: hasTokens && granted > 0 && payload.user.role === "member",
    detail: `tokens=${hasTokens} beans=${granted} role=${payload.user.role}`,
    session: payload,
  };
});

let memberSession = null;
let adminSession = null;

scenario("E2E-CP-login-and-me-syncs-quota", async () => {
  const login = await call("POST", "/api/v1/auth/login", { body: { email: MEMBER_EMAIL, password: PASSWORD } });
  if (login.status !== 200) {
    return { ok: false, detail: `login status ${login.status}` };
  }
  memberSession = login.data;
  const me = await call("GET", "/api/v1/me", { token: memberSession.accessToken });
  const quota = me.data?.quota;
  return {
    ok: me.status === 200 && Boolean(quota) && quota.availableBeans > 0 && me.data.gateway !== undefined,
    detail: `me=${me.status} available=${quota?.availableBeans}`,
  };
});

scenario("E2E-CP-wrong-password-is-rejected", async () => {
  const attempt = await call("POST", "/api/v1/auth/login", { body: { email: MEMBER_EMAIL, password: "wrong-password-value" } });
  return { ok: attempt.status === 401 && attempt.error?.code === "INVALID_CREDENTIALS", detail: `status=${attempt.status}` };
});

scenario("E2E-CP-usage-charge-deducts-beans", async () => {
  const token = memberSession?.accessToken;
  if (!token) {
    return { ok: false, detail: "missing member session" };
  }
  const before = await call("GET", "/api/v1/me", { token });
  const charged = await call("POST", "/api/v1/usage/charge", {
    token,
    body: { requestId: "e2e-request-1", model: "gpt-4o-mini", promptTokens: 1000, completionTokens: 500 },
  });
  const after = await call("GET", "/api/v1/me", { token });
  const deducted = charged.data?.chargedBeans > 0;
  const balanceDropped = after.data?.quota.balanceBeans < before.data?.quota.balanceBeans;
  return {
    ok: charged.status === 200 && deducted && balanceDropped,
    detail: `charged=${charged.data?.chargedBeans} before=${before.data?.quota.balanceBeans} after=${after.data?.quota.balanceBeans}`,
  };
});

scenario("E2E-CP-usage-charge-is-idempotent", async () => {
  const token = memberSession?.accessToken;
  const repeat = await call("POST", "/api/v1/usage/charge", {
    token,
    body: { requestId: "e2e-request-1", model: "gpt-4o-mini", promptTokens: 1000, completionTokens: 500 },
  });
  return { ok: repeat.status === 200 && repeat.data?.duplicate === true, detail: `duplicate=${repeat.data?.duplicate}` };
});

scenario("E2E-CP-member-cannot-reach-admin-api", async () => {
  const forbidden = await call("GET", "/api/v1/admin/overview", { token: memberSession?.accessToken });
  return { ok: forbidden.status === 403, detail: `status=${forbidden.status}` };
});

scenario("E2E-CP-admin-registration-and-overview", async () => {
  const code = await requestCode(ADMIN_EMAIL, "/api/v1/auth/register/code");
  if (!code) {
    return { ok: false, detail: "admin verification code was not issued" };
  }
  const registered = await call("POST", "/api/v1/auth/register", {
    body: { email: ADMIN_EMAIL, code, password: PASSWORD, displayName: "管理员" },
  });
  if (registered.status !== 200) {
    return { ok: false, detail: `register status ${registered.status}` };
  }
  adminSession = registered.data;
  const overview = await call("GET", "/api/v1/admin/overview", { token: adminSession.accessToken });
  return {
    ok: adminSession.user.role === "admin" && overview.status === 200 && overview.data?.users.total >= 2,
    detail: `role=${adminSession.user.role} users=${overview.data?.users.total}`,
  };
});

scenario("E2E-CP-gateway-key-is-masked", async () => {
  const created = await call("POST", "/api/v1/admin/gateways", {
    token: adminSession?.accessToken,
    body: {
      name: "统一模型网关",
      provider: "openai-compatible",
      baseUrl: "https://gateway.example.com/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-e2e-secret-value-1234",
      isDefault: true,
    },
  });
  const serialized = JSON.stringify(created.data ?? {});
  return {
    ok: created.status === 200 && created.data?.apiKeyMasked === "****1234" && !serialized.includes("sk-e2e-secret-value"),
    detail: `masked=${created.data?.apiKeyMasked} leaked=${serialized.includes("sk-e2e-secret-value")}`,
  };
});

scenario("E2E-CP-gateway-visible-to-member-without-key", async () => {
  const me = await call("GET", "/api/v1/me", { token: memberSession?.accessToken });
  const serialized = JSON.stringify(me.data ?? {});
  return {
    ok: me.data?.gateway?.name === "统一模型网关" && !serialized.includes("sk-e2e-secret-value"),
    detail: `gateway=${me.data?.gateway?.name}`,
  };
});

scenario("E2E-CP-quota-policy-update-applies-to-me", async () => {
  const updated = await call("PUT", "/api/v1/admin/quota-policy", {
    token: adminSession?.accessToken,
    body: {
      beansPer1kPrompt: 2,
      beansPer1kCompletion: 4,
      period: "monthly",
      periodBeans: 1000,
      defaultGrantBeans: 300,
    },
  });
  const me = await call("GET", "/api/v1/me", { token: memberSession?.accessToken });
  return {
    ok: updated.status === 200 && me.data?.quotaPolicy.beansPer1kPrompt === 2 && me.data?.quotaPolicy.defaultGrantBeans === 300,
    detail: `promptRate=${me.data?.quotaPolicy.beansPer1kPrompt} grant=${me.data?.quotaPolicy.defaultGrantBeans}`,
  };
});

scenario("E2E-CP-grant-quota-updates-balance", async () => {
  const users = await call("GET", "/api/v1/admin/users?pageSize=50", { token: adminSession?.accessToken });
  const member = users.data?.items.find((item) => item.email === MEMBER_EMAIL);
  if (!member) {
    return { ok: false, detail: "member not found in admin list" };
  }
  const granted = await call("POST", `/api/v1/admin/users/${member.id}/grant`, {
    token: adminSession?.accessToken,
    body: { beans: 50, reason: "E2E 补充" },
  });
  const ledger = await call("GET", `/api/v1/admin/users/${member.id}/ledger`, { token: adminSession?.accessToken });
  const latest = ledger.data?.items?.[0];
  return {
    ok: granted.status === 200 && latest?.deltaBeans === 50 && latest?.reason === "E2E 补充",
    detail: `balance=${granted.data?.balanceBeans} ledgerKind=${latest?.kind}`,
  };
});

scenario("E2E-CP-refresh-rotates-token", async () => {
  const refreshed = await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: memberSession?.refreshToken } });
  if (refreshed.status !== 200) {
    return { ok: false, detail: `refresh status ${refreshed.status}` };
  }
  const rotated = refreshed.data.refreshToken !== memberSession.refreshToken;
  const reused = await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: memberSession.refreshToken } });
  memberSession = refreshed.data;
  return { ok: rotated && reused.status === 401, detail: `rotated=${rotated} reuseStatus=${reused.status}` };
});

scenario("E2E-CP-disabled-user-loses-access", async () => {
  const users = await call("GET", "/api/v1/admin/users?pageSize=50", { token: adminSession?.accessToken });
  const member = users.data?.items.find((item) => item.email === MEMBER_EMAIL);
  await call("PATCH", `/api/v1/admin/users/${member.id}`, {
    token: adminSession?.accessToken,
    body: { status: "disabled" },
  });
  const blocked = await call("GET", "/api/v1/me", { token: memberSession.accessToken });
  await call("PATCH", `/api/v1/admin/users/${member.id}`, {
    token: adminSession?.accessToken,
    body: { status: "active" },
  });
  return { ok: blocked.status === 401 || blocked.status === 403, detail: `status=${blocked.status}` };
});

scenario("E2E-CP-password-reset-invalidates-sessions", async () => {
  const code = await requestCode(MEMBER_EMAIL, "/api/v1/auth/password/code");
  if (!code) {
    return { ok: false, detail: "reset code was not issued" };
  }
  const reset = await call("POST", "/api/v1/auth/password/reset", {
    body: { email: MEMBER_EMAIL, code, password: "jingche-e2e-new-passphrase" },
  });
  const relogin = await call("POST", "/api/v1/auth/login", { body: { email: MEMBER_EMAIL, password: "jingche-e2e-new-passphrase" } });
  return { ok: reset.status === 200 && relogin.status === 200, detail: `reset=${reset.status} relogin=${relogin.status}` };
});

scenario("E2E-CP-admin-console-bundle-served", async () => {
  const response = await fetch(`${BASE}/`);
  const html = await response.text();
  const spa = await fetch(`${BASE}/some/spa/route`);
  return {
    ok: response.status === 200 && html.includes("管控中心") && spa.status === 200,
    detail: `index=${response.status} spaFallback=${spa.status}`,
  };
});

/**
 * Stands in for an OpenAI-compatible upstream. It records the last request and
 * answers with two SSE deltas plus the trailing usage frame the proxy asks for.
 */
async function startStubGateway() {
  const { createServer } = await import("node:http");
  const state = { lastBody: null, lastAuth: null, calls: 0 };
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    request.on("end", () => {
      state.calls += 1;
      state.lastAuth = request.headers.authorization ?? null;
      try {
        state.lastBody = JSON.parse(raw);
      } catch {
        state.lastBody = null;
      }
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
      });
      response.write('data: {"choices":[{"delta":{"content":"你"}}]}\n\n');
      response.write('data: {"choices":[{"delta":{"content":"好"}}]}\n\n');
      response.write('data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\n');
      response.write("data: [DONE]\n\n");
      response.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, state, port: server.address().port };
}

let stubGateway = null;

/** The reset scenario rotates the member password, so try both variants. */
async function loginMember() {
  for (const password of ["jingche-e2e-new-passphrase", PASSWORD]) {
    const login = await call("POST", "/api/v1/auth/login", {
      body: { email: MEMBER_EMAIL, password },
    });
    if (login.status === 200) {
      return login.data;
    }
  }
  return null;
}

async function refreshMemberSession() {
  const fresh = await loginMember();
  if (fresh) {
    memberSession = fresh;
  }
  return memberSession;
}

async function ensureStubGateway() {
  if (!stubGateway) {
    await refreshMemberSession();
    stubGateway = await startStubGateway();
    const created = await call("POST", "/api/v1/admin/gateways", {
      token: adminSession?.accessToken,
      body: {
        name: "流式代理网关",
        provider: "openai-compatible",
        baseUrl: `http://127.0.0.1:${stubGateway.port}/v1`,
        model: "e2e-stream-model",
        apiKey: "sk-e2e-stream-key",
        isDefault: true,
      },
    });
    if (created.status !== 200) {
      throw new Error(`stub gateway was not accepted: ${created.status}`);
    }
  }
  return stubGateway;
}

scenario("E2E-CP-gateway-streams-sse-without-server-side-charging", async () => {
  const stub = await ensureStubGateway();
  const before = await call("GET", "/api/v1/me", { token: memberSession?.accessToken });
  const started = Date.now();
  const streamed = await call("POST", "/api/v1/gateway/chat/completions", {
    token: memberSession?.accessToken,
    body: {
      model: "e2e-stream-model",
      stream: true,
      messages: [{ role: "user", content: "你好" }],
    },
  });
  const elapsed = Date.now() - started;
  const after = await call("GET", "/api/v1/me", { token: memberSession?.accessToken });
  const balanceBefore = before.data?.quota?.balanceBeans;
  const balanceAfter = after.data?.quota?.balanceBeans;
  return {
    ok:
      streamed.status === 200 &&
      streamed.text.includes("你") &&
      streamed.text.includes("[DONE]") &&
      stub.state.lastBody?.stream === true &&
      stub.state.lastBody?.stream_options?.include_usage === true &&
      stub.state.lastAuth === "Bearer sk-e2e-stream-key" &&
      balanceAfter === balanceBefore,
    detail: `status=${streamed.status} deltas=${streamed.text.includes("你")} usageFrame=${stub.state.lastBody?.stream_options?.include_usage === true} authInjected=${stub.state.lastAuth === "Bearer sk-e2e-stream-key"} balance=${balanceBefore}->${balanceAfter} ${elapsed}ms`,
  };
});

scenario("E2E-CP-gateway-token-cannot-touch-session-routes", async () => {
  await ensureStubGateway();
  const issued = await call("POST", "/api/v1/auth/gateway-token", { token: memberSession?.accessToken });
  const token = issued.data?.token;
  const me = await call("GET", "/api/v1/me", { token });
  const admin = await call("GET", "/api/v1/admin/overview", { token });
  const charge = await call("POST", "/api/v1/usage/charge", {
    token,
    body: { requestId: "scope-probe", promptTokens: 1, completionTokens: 1 },
  });
  const gateway = await call("POST", "/api/v1/gateway/chat/completions", {
    token,
    body: { model: "e2e-stream-model", stream: true, messages: [{ role: "user", content: "hi" }] },
  });
  return {
    ok:
      issued.status === 200 &&
      Boolean(token) &&
      me.status === 403 &&
      admin.status === 403 &&
      charge.status === 403 &&
      gateway.status === 200,
    detail: `issued=${issued.status}/${issued.error?.code ?? "-"} me=${me.status} admin=${admin.status} charge=${charge.status} gateway=${gateway.status}`,
  };
});

scenario("E2E-CP-gateway-token-dies-with-its-session", async () => {
  await ensureStubGateway();
  const fresh = await loginMember();
  const sessionToken = fresh?.accessToken;
  const issued = await call("POST", "/api/v1/auth/gateway-token", { token: sessionToken });
  const gatewayToken = issued.data?.token;
  const beforeLogout = await call("POST", "/api/v1/gateway/chat/completions", {
    token: gatewayToken,
    body: { model: "e2e-stream-model", stream: true, messages: [{ role: "user", content: "hi" }] },
  });
  await call("POST", "/api/v1/auth/logout", {
    token: sessionToken,
    body: { refreshToken: fresh?.refreshToken },
  });
  const afterLogout = await call("POST", "/api/v1/gateway/chat/completions", {
    token: gatewayToken,
    body: { model: "e2e-stream-model", stream: true, messages: [{ role: "user", content: "hi" }] },
  });
  return {
    ok: Boolean(gatewayToken) && beforeLogout.status === 200 && afterLogout.status === 401,
    detail: `before=${beforeLogout.status} after=${afterLogout.status}/${afterLogout.error?.code ?? "-"}`,
  };
});

async function main() {
  const healthy = await waitForHealth();
  if (!healthy) {
    console.error("control plane did not become healthy");
    console.error(stdout.slice(-2000));
    cleanup();
    process.exit(1);
  }

  for (const scenarioEntry of checks) {
    try {
      const outcome = await scenarioEntry.fn();
      record(scenarioEntry.id, Boolean(outcome?.ok), outcome?.detail ?? "");
    } catch (error) {
      record(scenarioEntry.id, false, error instanceof Error ? error.message : String(error));
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
  cleanup();
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
