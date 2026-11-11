import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// The company-gateway path spans four modules that import Electron or the host
// process, so they cannot be loaded here. These checks read the sources the way
// `main-wiring-contract.test.mjs` does and lock the invariants that would
// silently double-charge an employee or bill a direct provider.

const here = dirname(fileURLToPath(import.meta.url));
const mainDir = join(here, "..", "electron", "main");
const read = (relative) => readFileSync(join(mainDir, relative), "utf8");

const billing = read("runtime/control-plane-billing.ts");
const providers = read("runtime/control-plane-provider.ts");
const controlPlaneIpc = read("ipc/control-plane-ipc.ts");
const plans = read("runtime/plans.ts");
const index = read("index.ts");

const squash = (source) => source.replace(/\s+/g, " ");

test("the ledger key is the turn, so a retry cannot double-charge", () => {
  assert.match(billing, /const requestId = `\$\{sessionId\}:\$\{turnId\}`/);
  assert.match(billing, /inflight\.has\(requestId\)/);
});

test("cached and reasoning tokens are billed in their buckets", () => {
  const body = squash(billing);
  assert.match(
    body,
    /const promptTokens = \(usage\?\.inputTokens \?\? 0\) \+ \(usage\?\.cacheReadTokens \?\? 0\) \+ \(usage\?\.cacheWriteTokens \?\? 0\)/,
  );
  assert.match(
    body,
    /const completionTokens = \(usage\?\.outputTokens \?\? 0\) \+ \(usage\?\.reasoningTokens \?\? 0\)/,
  );
});

test("only turns that ran on the company gateway are billed", () => {
  const body = squash(billing);
  assert.match(body, /if \(current\?\.session\?\.providerId !== gatewayProviderId\) \{ return; \}/);
  assert.match(body, /"session\.get"/);
});

test("a client error is not retried, a transport failure is retried once", () => {
  const body = squash(billing);
  assert.match(body, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  assert.match(body, /error instanceof ControlPlaneError && error\.status >= 400 && error\.status < 500/);
});

test("the provider row points at the proxy with an OpenAI-compatible style", () => {
  const body = squash(providers);
  assert.match(body, /const baseUrl = gatewayProviderBaseUrl\(gateway\.proxyEndpoint\)/);
  assert.match(body, /type: "openai_compatible" as const/);
  assert.match(body, /authKind: "api_key_and_base_url"/);
  assert.match(body, /apiStyle: "chat_completions"/);
  assert.match(body, /secretValue: token/);
});

test("an optional deployment keeps the employee's own default provider", () => {
  // The yield only survives for deployments that do not require the control
  // plane: with `required: true` the company row must win (see
  // control-plane-status.test.mjs).
  const body = squash(providers);
  assert.match(body, /if \(!managed && current && current !== providerId\) \{ return; \}/);
});

test("a disabled gateway never produces a provider row", () => {
  const body = squash(providers);
  assert.match(body, /if \(!resolved\.signedIn \|\| !gateway \|\| !gateway\.enabled\) \{ return null; \}/);
});

test("signing out disables the gateway provider", () => {
  const body = squash(controlPlaneIpc);
  assert.match(body, /await client\.logout\(\)/);
  assert.match(body, /await providers\.deactivate\(\)/);
  assert.match(providers, /enabled: false/);
});

test("every signed-in entry point refreshes the provider row", () => {
  const body = squash(controlPlaneIpc);
  assert.match(body, /const sync = async \(status/);
  assert.equal((body.match(/sync\(await client\./g) ?? []).length, 3);
});

test("turn settlement hands the usage to the ledger with the turn id", () => {
  const body = squash(plans);
  assert.match(
    body,
    /reportTurnUsage\(\{ sessionId: id, turnId, usage: turnUsage \}\)/,
  );
});

test("the composition root wires the bridge and the billing reporter", () => {
  const body = squash(index);
  assert.match(body, /createControlPlaneProviderBridge\(\{/);
  assert.match(body, /createControlPlaneBilling\(\{/);
  assert.match(body, /providerId: \(\) => controlPlaneProviders\.providerId\(\)/);
  assert.match(body, /controlPlane: \{ client: controlPlaneClient, providers: controlPlaneProviders \}/);
  assert.match(body, /reportTurnUsage: \(input\) => \{ void controlPlaneBilling\.reportTurn\(input\); \}/);
});
