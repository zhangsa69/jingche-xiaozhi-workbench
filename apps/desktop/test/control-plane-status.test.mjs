import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// `ControlPlaneClient` imports Electron, so the status projection cannot be
// exercised here. A regression shipped because `status()` dropped the resolved
// origin on the "no session yet" path: the gate reads a null `baseUrl` as a
// misconfiguration and every first launch landed on the wrong screen. These
// checks read the sources the way `main-wiring-contract.test.mjs` does.

const here = dirname(fileURLToPath(import.meta.url));
const mainDir = join(here, "..", "electron", "main");
const read = (relative) => readFileSync(join(mainDir, relative), "utf8");
const squash = (source) => source.replace(/\s+/g, " ");

const client = squash(read("control-plane-client.ts"));
const gate = squash(
  readFileSync(join(here, "..", "src", "features", "auth", "ControlPlaneGate.tsx"), "utf8"),
);
const provider = squash(read("runtime/control-plane-provider.ts"));

test("an unauthenticated status still reports the resolved origin", () => {
  assert.match(client, /if \(!this\.session\) \{ [^}]*return this\.emptyStatus\(true, baseUrl\); \}/);
});

test("a null origin is only reported together with a configuration error", () => {
  // `emptyStatus(required, baseUrl, error)` with a null origin and no error is
  // indistinguishable from a broken address once it reaches the gate.
  assert.doesNotMatch(client, /emptyStatus\(true, null\)/);
  assert.match(client, /emptyStatus\(true, null, `\$\{INVALID_BASE_URL_MESSAGE\}/);
});

test("an unconfigured deployment is not treated as required", () => {
  assert.match(client, /if \(!configured\) \{ return this\.emptyStatus\(false, null\); \}/);
});

test("a stored origin that cannot be used still blocks the workspace", () => {
  // Signing in once must not be undone by a restart. When the saved LAN origin
  // needs the insecure opt-in, the gate has to say so instead of quietly
  // handing the employee back the local provider and model pickers.
  assert.match(
    client,
    /const configured = process\.env\.PI_DESKTOP_CONTROL_PLANE_URL\?\.trim\(\) \|\| this\.session\?\.baseUrl\?\.trim\(\) \|\| "";/,
  );
});

test("concurrent refreshes share a single request", () => {
  // The refresh hash rotates on every call: two requests with the same token
  // look like reuse, and the server revokes the session.
  assert.match(client, /private refreshInFlight: Promise<boolean> \| null = null;/);
  assert.match(client, /if \(this\.refreshInFlight\) \{ return this\.refreshInFlight; \}/);
});

test("only an auth failure clears the stored session", () => {
  assert.match(client, /const status = error instanceof ControlPlaneError \? error\.status : 0;/);
  assert.match(client, /if \(status === 401 \|\| status === 403\) \{ await this\.clearSession\(\); \}/);
});

test("the live session keeps plaintext tokens and only the file is sealed", () => {
  // Sealing in `persistSession` as well made every request carry ciphertext as
  // its bearer token: a successful login was followed by a 401 on `me`, a 401
  // on `refresh`, and a cleared session — the sign-in button looked dead.
  assert.match(client, /accessToken: payload\.accessToken,/);
  assert.match(client, /refreshToken: payload\.refreshToken,/);
  assert.doesNotMatch(client, /this\.seal\(payload\.(access|refresh)Token\)/);
  assert.match(
    client,
    /accessToken: this\.session\.encrypted \? this\.seal\(this\.session\.accessToken\) : this\.session\.accessToken,/,
  );
});

test("an undecryptable stored session is treated as signed out", () => {
  assert.match(client, /if \(!accessToken \|\| !refreshToken\) \{/);
});

test("reading the status does not notify the renderer", () => {
  // The gate re-reads the status on `controlPlaneChanged`, so notifying from a
  // status read made every read trigger the next one: an endless reload loop
  // that left the app flickering on the connecting card.
  const statusBody = client.slice(client.indexOf("async status():"), client.indexOf("async login(email"));
  assert.ok(statusBody.length > 0, "status() not found");
  assert.doesNotMatch(statusBody, /this\.notify\(\)/);
});

test("a background status change does not repaint the connecting card", () => {
  assert.match(gate, /void load\(\{ silent: true \}\);/);
});

test("a managed deployment forces the gateway row as the only default", () => {
  // `ensureDefault` used to yield to any provider the employee had picked, so a
  // deployment that requires the control plane still sent turns to a locally
  // configured provider with its own key.
  assert.match(provider, /if \(!managed && current && current !== providerId\) \{/);
  assert.match(provider, /const managed = resolved\.required === true;/);
  assert.match(
    provider,
    /await ensureDefault\(host, providerId, modelId, managed\);/,
  );
});

test("sessions pinned to a local provider are repointed to the gateway row", () => {
  // A turn resolves `session.providerId` before the global default, so the
  // default alone never moved an existing conversation off a local provider.
  assert.match(provider, /await host\.call<[^>]*>\("session\.list"\)/);
  assert.match(provider, /await host\.call\("session\.configure", \{/);
  assert.match(provider, /await repointSessions\(host, providerId, modelId\);/);
});

test("other provider rows are switched off while signed in and restored on sign-out", () => {
  assert.match(
    provider,
    /await host\.call\("providers\.update", \{ id: provider\.id, enabled: false \}\)/,
  );
  assert.match(provider, /await host\.call\("providers\.update", \{ id, enabled: true \}\)/);
  assert.match(provider, /await restoreProviders\(host, existing\.providerId\);/);
});

test("the gate checks sign-in before blaming the address", () => {
  const signedIn = gate.indexOf("if (next.signedIn)");
  const noOrigin = gate.indexOf("if (!next.baseUrl)");
  assert.ok(signedIn >= 0, "sign-in branch missing");
  assert.ok(noOrigin >= 0, "baseUrl branch missing");
  assert.ok(signedIn < noOrigin, "the baseUrl branch must come after the signed-in check");
});
