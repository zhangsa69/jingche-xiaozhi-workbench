import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(here, relative), "utf8");
const repo = resolve(here, "../../..");

const shell = read("../src/features/app/AppShell.tsx");
const appState = read("../src/stores/app-state.ts");
const sidebar = read("../src/components/Sidebar.tsx");
const search = read("../src/components/SearchDialog.tsx");
const sharedIndex = read("../../../packages/shared/src/index.ts");
const LOCALES = ["en", "de", "es", "fr", "ko", "tr", "zh-CN", "zh-TW"];

test("the templates feature left no page, route or shared export behind", () => {
  // Removed at the user's request on 2026-10-29. A half-deleted feature is worse
  // than either state: a dangling lazy import breaks the bundle at runtime.
  assert.equal(existsSync(resolve(here, "../src/pages/TemplatesPage.tsx")), false);
  assert.equal(
    existsSync(resolve(here, "../../../packages/shared/src/template-presets.ts")),
    false,
  );
  assert.equal(
    existsSync(resolve(here, "../../../packages/shared/src/template-apply.ts")),
    false,
  );
  assert.doesNotMatch(sharedIndex, /template-presets|template-apply/);
  assert.doesNotMatch(shell, /pages\/TemplatesPage/);
  assert.doesNotMatch(shell, /page === "templates"/);
  assert.doesNotMatch(appState, /\| "templates"/);
  assert.doesNotMatch(sidebar, /data-nav="templates"/);
  assert.doesNotMatch(search, /page: "templates"/);
});

test("no locale still ships the templates namespace or its nav label", () => {
  // The keys are only useful with the page; leaving them invites a second
  // implementation to grow back around them.
  for (const locale of LOCALES) {
    const source = read(`../../../packages/i18n/src/locales/${locale}/index.ts`);
    assert.doesNotMatch(source, /^\s+"?templates"?: \{/m, `${locale} keeps templates.*`);
    assert.doesNotMatch(source, /^\s+"?templates"?: "/m, `${locale} keeps nav.templates`);
  }
});

test("the unrelated template concepts survive the deletion", () => {
  // Slash-command templates, plugin scaffolding and subagent starters share the
  // word but not the feature; deleting them would have broken three other flows.
  assert.match(read("../src/features/chat/composer/hooks/useComposerSubmit.ts"), /kind !== "template"/);
  assert.match(read("../../../packages/agent-runtime/src/prompt-templates.ts"), /export/);
  assert.match(read("../../../packages/plugin-devkit/src/templates.ts"), /TEMPLATE_NAMES/);
  assert.match(read("../src/components/settings/SubagentEditorSheet.tsx"), /subagentTemplate/);
  assert.ok(existsSync(resolve(repo, "packages/plugin-devkit/src/templates.test.ts")));
});
