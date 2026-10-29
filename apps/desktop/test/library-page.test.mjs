import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(here, relative), "utf8");

const page = read("../src/pages/LibraryPage.tsx");
const css = read("../src/styles/library.css");
const store = read("../src/lib/library-store.ts");
const hook = read("../src/hooks/use-composer-autocomplete.ts");
const appState = read("../src/stores/app-state.ts");
const shell = read("../src/features/app/AppShell.tsx");
const sidebar = read("../src/components/Sidebar.tsx");
const search = read("../src/components/SearchDialog.tsx");

test("the page defers list rules to the shared module instead of re-deriving them", () => {
  // Dedup, normalization and the cap live in shared/library.ts and are covered
  // by vitest. A second copy in the page would drift the moment either changes.
  assert.match(page, /addLibrarySource/);
  assert.match(page, /removeLibrarySource/);
  assert.match(page, /from "@pi-desktop\/shared"/);
  assert.doesNotMatch(page, /toLowerCase\(\)\s*===\s*\w+\.toLowerCase\(\)/);
});

test("removing an entry is described as forgetting a pointer, not deleting data", () => {
  // The word "library" suggests custody; if the UI implied deletion, nobody
  // would dare remove anything.
  assert.match(page, /t\("library\.removeHint"\)/);
  const en = read("../../../packages/i18n/src/locales/en/index.ts");
  assert.match(en, /removeHint: "[^"]*pointer/i);
  assert.match(en, /removeHint: "[^"]*never deletes|removeHint: "[^"]*stays/i);
});

test("an @ reference is built as @path with a trailing slash for folders", () => {
  assert.match(page, /`@\$\{source\.path\}\$\{source\.kind === "folder" \? "\/" : ""\}`/);
});

test("the composer merges library folders ahead of workspace files", () => {
  assert.match(hook, /mergeLibraryCandidates/);
  assert.match(hook, /loadLibrarySources/);
  // Order matters: library rows are prepended, so the merge must be computed
  // before filterFiles runs over the remaining workspace entries.
  const merged = hook.indexOf("mergeLibraryCandidates(");
  const filtered = hook.indexOf("filterFiles(merged.workspace");
  assert.ok(merged > 0 && filtered > merged, "library merge must precede file filtering");
});

test("stored entries are re-validated so a bad blob cannot poison the list", () => {
  assert.match(store, /parseLibrarySources/);
  assert.match(store, /if \(!path\) continue;/);
  assert.match(store, /seen\.has\(id\)/);
});

test("the page reserves the floating titlebar band so its header stays reachable", () => {
  // This page owns its frame instead of using `.page-frame`. Without the
  // reservation the opaque titlebar band covers the header — where the only
  // "Add folder" button lives — and the page looks like it has no controls.
  assert.match(page, /className="library-page"/);
  assert.match(css, /\.library-page \{[\s\S]*?overflow-y: auto;/);
  assert.match(
    css,
    /:root\[data-platform="win32"\] \.library-page,[\s\S]*?padding-top: calc\(var\(--ds-toolbar-height\) \+ 8px\);/,
  );
});

test("a failed folder picker releases the button instead of leaving it spinning", () => {
  assert.match(page, /try \{[\s\S]*?api\.pickProjectFolders\(\)[\s\S]*?\} finally \{\s*setPicking\(false\);/);
  assert.match(page, /t\("library\.pickFailed"\)/);
});

test("the page is reachable from state, the shell, the footer and search", () => {
  assert.match(appState, /\| "library"/);
  assert.match(shell, /import\("\.\.\/\.\.\/pages\/LibraryPage"\)/);
  assert.match(shell, /page === "library" \?/);
  assert.match(sidebar, /data-nav="library"/);
  assert.match(sidebar, /aria-pressed=\{page === "library"\}/);
  assert.match(search, /page: "library", labelKey: "library\.title"/);
});
