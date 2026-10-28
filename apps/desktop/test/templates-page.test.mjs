import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(join(here, "..", relative), "utf8");

const page = read("src/pages/TemplatesPage.tsx");
const sidebar = read("src/components/Sidebar.tsx");
const search = read("src/components/SearchDialog.tsx");
const shell = read("src/features/app/AppShell.tsx");

test("templates page fills and previews through the shared engine", () => {
  // The page must not re-implement substitution: one engine means one set of
  // warnings, and the preview then matches what the composer will send.
  assert.match(page, /applyTemplate\(/);
  assert.match(page, /applyTemplateBatch\(/);
  assert.match(page, /parseBatchTable\(/);
  assert.match(page, /templateTaskPrompt\(/);
  assert.doesNotMatch(page, /\{\{\s*key\s*\}\}\.replace/);
});

test("every adjustment is surfaced instead of being silently applied", () => {
  // assumedOrder has no key of its own; naming it keeps the warning readable
  // rather than collapsing to an empty list of "adjusted: ".
  assert.match(page, /item\.kind === "assumedOrder" \? "columnOrder" : item\.key/);
  assert.match(page, /templates\.missing/);
  assert.match(page, /templates\.warnings/);
});

test("blocked rows say which row and which values are missing", () => {
  assert.match(page, /templates\.batchSkipped/);
  assert.match(page, /blocked\?\.row|row: /);
  // The reason is a closed union from the shared parser, so the key is built
  // from it rather than branching in JSX; every reason must exist in locales.
  assert.match(page, /templates\.batchError\.\$\{batch\.parsed\.reason\}/);
  const en = read("../../packages/i18n/src/locales/en/index.ts");
  for (const reason of ["empty", "noSeparator"]) {
    assert.match(en, new RegExp(`${reason}: "`));
  }
});

test("inserting goes through the composer draft, not a second send path", () => {
  assert.match(page, /appendComposerDraftText/);
  assert.doesNotMatch(page, /sendMessage|startTask/);
});

test("templates are reachable from the footer and from search", () => {
  assert.match(sidebar, /data-nav="templates"/);
  assert.match(sidebar, /page === "templates"/);
  assert.match(search, /page: "templates", labelKey: "templates\.title"/);
  assert.match(shell, /page === "templates"/);
  assert.match(shell, /pages\/TemplatesPage/);
});
