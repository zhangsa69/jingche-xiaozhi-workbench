import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const readRepo = (path) =>
  readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

const LOCALES = ["zh-CN", "zh-TW", "en", "de", "es", "fr", "ko", "tr"];

// W-01: a mode that answers without writing. The wire value is `read-only`
// rather than `ask`, because `PermissionMode` already owns `ask`.

test("the shared type carries read-only and its retired alias", async () => {
  const common = await readRepo("packages/shared/src/types/common.ts");

  assert.match(common, /export type Mode = "read-only" \| "plan" \| "goal" \| "agent";/);
  assert.match(common, /if \(value === "read-only" \|\| value === "ask"\) return "read-only";/);
  assert.match(common, /export function isReadOnlyMode/);
});

test("the host denies every write, including under auto and with a grant", async () => {
  const [permissions, sessions, rpc] = await Promise.all([
    readRepo("crates/host-core/src/permissions.rs"),
    readRepo("crates/host-core/src/sessions.rs"),
    readRepo("crates/host-core/src/rpc/mod.rs"),
  ]);

  // The allowlist is the whole contract: Bash is absent on purpose.
  const allowlist = permissions.slice(
    permissions.indexOf("pub fn read_only_mode_allows"),
    permissions.indexOf("pub fn read_only_mode_allows") + 260,
  );
  assert.match(allowlist, /"Read" \| "Glob" \| "Grep" \| "BrowserPreview" \| "new_context"/);
  assert.doesNotMatch(allowlist, /"Bash"/);
  assert.doesNotMatch(allowlist, /"Write"/);

  // The gate precedes every escape hatch: grants, auto and scratch paths.
  assert.match(
    permissions,
    /if crate::sessions::is_read_only_mode\(mode\) && !Self::read_only_mode_allows\(tool_name\) \{\n            return Some\(PermissionDecision::Deny\);/,
  );

  // Only the canonical value matches, so a swapped argument (permission mode
  // `ask` landing in the mode slot) cannot silently deny writes.
  assert.match(sessions, /matches!\(mode, "read-only"\)/);
  assert.match(sessions, /Some\("read-only"\) \| Some\("ask"\) => "read-only"\.into\(\)/);

  assert.match(rpc, /"WRITE_DISABLED_IN_READ_ONLY"/);
  assert.match(rpc, /"TOOL_DISABLED_IN_READ_ONLY"/);
});

test("a read-only session survives storage validation", async () => {
  const migrations = await readRepo("crates/host-core/src/db/migrations.rs");

  assert.match(migrations, /"read-only" \| "agent" \| "plan" \| "goal" => \{\}/);
  assert.match(
    migrations,
    /WHERE mode NOT IN \('read-only', 'agent', 'plan', 'goal'\)/,
  );
});

test("the renderer offers the mode and locks the permission chip", async () => {
  const [model, icon, toolbar, settings, hover, slice] = await Promise.all([
    read("src/features/chat/composer/model.ts"),
    read("src/features/chat/composer/ComposerModeIcon.tsx"),
    read("src/features/chat/composer/ComposerToolbar.tsx"),
    read("src/features/settings/SettingsPage.tsx"),
    read("src/features/sessions/SessionHoverCard.tsx"),
    read("src/stores/slices/events-slice.ts"),
  ]);

  assert.match(
    model,
    /MODE_CYCLE: readonly Mode\[\] = \["read-only", "plan", "agent", "goal"\]/,
  );
  assert.match(model, /"read-only": "settings\.modeReadOnly"/);
  assert.match(icon, /if \(mode === "read-only"\) return <IconChat size=\{14\} \/>/);
  assert.match(settings, /\["read-only", "settings\.modeReadOnly"\]/);
  assert.match(hover, /session\.mode === "read-only" \? "chat\.modeReadOnly"/);

  // Permission is pinned by the mode, so the selector must not pretend
  // otherwise: read-only joins goal as locked.
  assert.match(toolbar, /const permissionLocked = mode === "goal" \|\| mode === "read-only";/);
  assert.match(toolbar, /open=\{permissionOpen && !permissionLocked\}/);
  assert.match(toolbar, /disabled=\{controlsBlocked \|\| permissionLocked\}/);
  assert.match(toolbar, /t\("chat\.modeReadOnlyHint"\)/);

  // A stray planning event must not promote the session to Agent.
  assert.match(slice, /session\.id === event\.sessionId && session\.mode !== "read-only"/);
});

test("the model is told the mode is read-only", async () => {
  const [prompts, runtime] = await Promise.all([
    readRepo("packages/agent-runtime/src/mode-prompts.ts"),
    readRepo("packages/agent-runtime/src/runtime.ts"),
  ]);

  assert.match(prompts, /export const READ_ONLY_MODE_SYSTEM_PROMPT = \[/);
  assert.match(prompts, /case "read-only":\n      return READ_ONLY_MODE_SYSTEM_PROMPT;/);
  assert.match(runtime, /mode === "read-only"\n    \? "Read-only"/);
});

test("every locale names the mode and explains the lock", async () => {
  const catalogs = await Promise.all(
    LOCALES.map((locale) =>
      readRepo(`packages/i18n/src/locales/${locale}/index.ts`),
    ),
  );

  for (const [index, source] of catalogs.entries()) {
    // `settings.modeReadOnly` and `chat.modeReadOnly` live in different
    // sections; both must exist, so count rather than merely match.
    const labels = source.match(/["']?modeReadOnly(?!Hint)["']?\s*:\s*"[^"]+"/g) ?? [];
    assert.equal(
      labels.length,
      2,
      `${LOCALES[index]} needs modeReadOnly in both settings and chat`,
    );
    assert.match(
      source,
      /["']?modeReadOnlyHint["']?\s*:\s*"[^"]+"/,
      `${LOCALES[index]} is missing chat.modeReadOnlyHint`,
    );
  }
});
