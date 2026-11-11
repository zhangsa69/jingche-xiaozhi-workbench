#!/usr/bin/env node
// Mail-path checks for the control plane. A local SMTP sink stands in for the
// company relay, so the verification-code journey runs without real
// credentials: delivery, subject/recipient, accepted code, resend cooldown, and
// the guarantee that codes never reach the service log once SMTP is configured.
//
//   node scripts/e2e-control-plane-mail.mjs
//   CONTROL_PLANE_BIN=target/release/control-plane node scripts/e2e-control-plane-mail.mjs

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.CONTROL_PLANE_E2E_PORT ?? 8898);
const SMTP_PORT = Number(process.env.CONTROL_PLANE_E2E_SMTP_PORT ?? 8897);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "e2e-mail-secret-value-with-at-least-32-chars";
const EMAIL = "mailbox@company.com";
const FROM = "no-reply@company.com";
const PASSWORD = "jingche-mail-passphrase";

const messages = [];
const results = [];

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

/** Minimal SMTP sink: accepts AUTH LOGIN/PLAIN and stores DATA verbatim. */
function startSink() {
  const server = createServer((socket) => {
    let buffer = "";
    let collecting = false;
    let body = "";
    let envelope = { from: null, to: [] };
    let authStep = 0;

    const reply = (line) => socket.write(`${line}\r\n`);
    reply("220 sink.local ESMTP ready");

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      for (;;) {
        if (collecting) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          body += buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          collecting = false;
          messages.push({ ...envelope, raw: body });
          body = "";
          reply("250 2.0.0 Message accepted");
          continue;
        }

        const lineEnd = buffer.indexOf("\r\n");
        if (lineEnd === -1) return;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);

        if (authStep > 0) {
          authStep += 1;
          if (authStep >= 3) {
            authStep = 0;
            reply("235 2.7.0 Authentication successful");
          } else {
            reply("334 UGFzc3dvcmQ6");
          }
          continue;
        }

        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO" || verb === "HELO") {
          reply("250-sink.local");
          reply("250-AUTH LOGIN PLAIN");
          reply("250-8BITMIME");
          reply("250 SIZE 10485760");
        } else if (verb === "AUTH") {
          const parts = line.split(" ");
          if (parts.length >= 3) {
            reply("235 2.7.0 Authentication successful");
          } else {
            authStep = 1;
            reply("334 VXNlcm5hbWU6");
          }
        } else if (verb === "MAIL") {
          envelope = { from: line.replace(/^MAIL FROM:\s*/i, "").trim(), to: [] };
          reply("250 2.1.0 OK");
        } else if (verb === "RCPT") {
          envelope.to.push(line.replace(/^RCPT TO:\s*/i, "").trim());
          reply("250 2.1.5 OK");
        } else if (verb === "DATA") {
          collecting = true;
          reply("354 End data with <CR><LF>.<CR><LF>");
        } else if (verb === "RSET") {
          envelope = { from: null, to: [] };
          reply("250 2.0.0 OK");
        } else if (verb === "NOOP") {
          reply("250 2.0.0 OK");
        } else if (verb === "QUIT") {
          reply("221 2.0.0 Bye");
          socket.end();
        } else {
          reply("250 2.0.0 OK");
        }
      }
    });

    socket.on("error", () => undefined);
  });

  return new Promise((resolve) => {
    server.listen(SMTP_PORT, "127.0.0.1", () => resolve(server));
  });
}

function decodeQuotedPrintable(value) {
  return value
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9a-fA-F]{2})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\r\n/g, "\n");
}

/** Decodes every MIME part into one searchable string. */
function readableMessage(raw) {
  const split = raw.split(/\r?\n\r?\n/);
  if (split.length < 2) return raw;
  const headers = split[0];
  const body = split.slice(1).join("\n\n");

  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(headers)?.[1];
  const parts = boundary
    ? body.split(`--${boundary}`).filter((part) => part.trim() && part.trim() !== "--")
    : [body];

  const decoded = parts.map((part) => {
    const localSplit = part.split(/\r?\n\r?\n/);
    const partHeaders = localSplit.length > 1 ? localSplit[0] : "";
    const partBody = localSplit.length > 1 ? localSplit.slice(1).join("\n\n") : part;
    const encoding = /Content-Transfer-Encoding:\s*(\S+)/i.exec(partHeaders)?.[1]?.toLowerCase();
    if (encoding === "base64") {
      return Buffer.from(partBody.replace(/[^A-Za-z0-9+/=]/g, ""), "base64").toString("utf8");
    }
    if (encoding === "quoted-printable") {
      return decodeQuotedPrintable(partBody);
    }
    return partBody;
  });

  return `${headers}\n${decoded.join("\n")}`;
}

function extractCode(raw) {
  const text = readableMessage(raw);
  const labelled = /验证码为\s*(\d{6})/.exec(text);
  if (labelled) return labelled[1];
  const marked = /letter-spacing:10px[^>]*>\s*(\d{6})/.exec(text);
  if (marked) return marked[1];
  const loose = /(?:^|\D)(\d{6})(?!\d)/.exec(text);
  return loose ? loose[1] : null;
}

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
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
  return { status: response.status, data: payload?.data, error: payload?.error };
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/healthz`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function waitForMessage(count) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (messages.length > count) return messages[messages.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

const binary = resolveBinary();
if (!binary) {
  console.error("control-plane binary not found. Run `cargo build -p control-plane` first.");
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "control-plane-mail-"));
const sink = await startSink();

let log = "";
const child = spawn(binary, [], {
  env: {
    ...process.env,
    CONTROL_PLANE_SECRET: SECRET,
    CONTROL_PLANE_DATA_DIR: dataDir,
    CONTROL_PLANE_ADDR: `127.0.0.1:${PORT}`,
    CONTROL_PLANE_WEB_DIR: process.env.CONTROL_PLANE_WEB_DIR ?? join("apps", "control-plane", "web", "dist"),
    CONTROL_PLANE_SMTP_HOST: "127.0.0.1",
    CONTROL_PLANE_SMTP_PORT: String(SMTP_PORT),
    CONTROL_PLANE_SMTP_USERNAME: EMAIL,
    CONTROL_PLANE_SMTP_PASSWORD: "sink-password",
    CONTROL_PLANE_SMTP_FROM_EMAIL: FROM,
    CONTROL_PLANE_SMTP_FROM_NAME: "京车小智工作台",
    CONTROL_PLANE_SMTP_TLS: "insecure",
    CONTROL_PLANE_LOG: "info",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  log += chunk;
});
child.stderr.on("data", (chunk) => {
  log += chunk;
});

function cleanup() {
  if (!child.killed) child.kill("SIGTERM");
  sink.close();
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

if (!(await waitForHealth())) {
  console.error("control plane did not become healthy");
  console.error(log.slice(-2000));
  process.exit(1);
}

const ready = await fetch(`${BASE}/readyz`).then((response) => response.json());
record(
  "E2E-CONTROL-PLANE-mail-transport-is-smtp",
  typeof ready.mail_transport === "string" && /smtp/i.test(ready.mail_transport),
  `transport=${ready.mail_transport}`,
);

let deliveredCode = null;

{
  const before = messages.length;
  const issued = await call("POST", "/api/v1/auth/register/code", { body: { email: EMAIL } });
  const message = await waitForMessage(before);
  deliveredCode = message ? extractCode(message.raw) : null;
  const recipients = message?.to?.join(",") ?? "";
  record(
    "E2E-CONTROL-PLANE-mail-delivers-verification-code",
    issued.status === 200 && Boolean(deliveredCode) && recipients.includes(EMAIL),
    `status=${issued.status} code=${deliveredCode ? "received" : "missing"} to=${recipients}`,
  );
  record(
    "E2E-CONTROL-PLANE-mail-uses-configured-sender",
    Boolean(message?.from?.includes(FROM)) && /京车小智工作台/.test(readableMessage(message?.raw ?? "")),
    `from=${message?.from ?? "none"}`,
  );
  record(
    "E2E-CONTROL-PLANE-code-never-reaches-service-log",
    Boolean(deliveredCode) && !log.includes(deliveredCode),
    deliveredCode ? "code absent from log" : "no code to compare",
  );
}

{
  const registered = deliveredCode
    ? await call("POST", "/api/v1/auth/register", {
        body: { email: EMAIL, code: deliveredCode, password: PASSWORD, displayName: "邮件验证" },
      })
    : { status: 0 };
  record(
    "E2E-CONTROL-PLANE-delivered-code-registers-account",
    registered.status === 200 && Boolean(registered.data?.accessToken),
    `status=${registered.status}`,
  );
}

{
  const before = messages.length;
  const again = await call("POST", "/api/v1/auth/register/code", { body: { email: "second@company.com" } });
  const message = await waitForMessage(before);
  const immediate = await call("POST", "/api/v1/auth/register/code", {
    body: { email: "second@company.com" },
  });
  record(
    "E2E-CONTROL-PLANE-resend-cooldown-is-enforced",
    again.status === 200 && Boolean(message) && immediate.status === 429 && immediate.error?.code === "RATE_LIMITED",
    `first=${again.status} second=${immediate.status}/${immediate.error?.code ?? "-"}`,
  );
}

{
  const unknown = await call("POST", "/api/v1/auth/password/code", {
    body: { email: "stranger@company.com" },
  });
  // Give the mailer a beat to prove it did NOT dispatch to an unknown mailbox.
  await new Promise((resolve) => setTimeout(resolve, 600));
  const dispatched = messages.some((entry) => entry.to?.join(",").includes("stranger@company.com"));
  record(
    "E2E-CONTROL-PLANE-reset-code-does-not-enumerate-mailboxes",
    unknown.status === 200 && !dispatched,
    `status=${unknown.status} dispatched=${dispatched}`,
  );
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
process.exit(failed.length === 0 ? 0 : 1);
