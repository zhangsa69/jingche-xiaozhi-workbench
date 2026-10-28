import { readComposerSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const composerSource = await readComposerSource();

test("Agent and Plan permission menus present only effective selectable modes", () => {
  const permissionControlSource = composerSource.slice(
    composerSource.indexOf('className="composer-permission"'),
    composerSource.indexOf('<div className="composer-right">'),
  );

  assert.match(
    permissionControlSource,
    /\["ask", "accept-edits", "auto"\] as const/,
  );
  assert.match(
    permissionControlSource,
    /aria-checked=\{composerPermissionMode === candidate\}/,
  );
  assert.match(
    permissionControlSource,
    /\{t\(PERMISSION_MODE_I18N_KEYS\[candidate\]\)\}/,
  );
  assert.doesNotMatch(permissionControlSource, /permissionInherit/);
  assert.doesNotMatch(permissionControlSource, /\["inherit",/);
});

test("Goal and Read-only keep the chip visible but locked", () => {
  const permissionControlSource = composerSource.slice(
    composerSource.indexOf('className="composer-permission"'),
    composerSource.indexOf('<div className="composer-right">'),
  );

  // Goal pins Full auto; read-only pins its own allowlist. Neither can be
  // changed by the selector, so both lock it instead of faking a choice.
  assert.match(
    composerSource,
    /const permissionLocked = mode === "goal" \|\| mode === "read-only";/,
  );
  assert.match(
    composerSource,
    /const composerPermissionMode: Exclude<PermissionMode, "inherit"> =\s*\n\s*mode === "goal" \? "auto" : effectivePermissionMode;/,
  );
  assert.match(permissionControlSource, /aria-haspopup=\{permissionLocked \? undefined : "menu"\}/);
  assert.match(permissionControlSource, /disabled=\{controlsBlocked \|\| permissionLocked\}/);
  assert.match(permissionControlSource, /permissionOpen && !permissionLocked/);
});
