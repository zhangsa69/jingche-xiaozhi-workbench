import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

/*
  Work-panel file rows keep the in-app preview on a single click, but a user who
  wants the real application or the file manager should not have to leave the
  panel to find it. These contracts pin the three gestures and the guarded IPC
  pair they use (`fs/open`, `fs/reveal`), plus the labels every locale needs.
*/

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const LOCALES = ["zh-CN", "zh-TW", "en", "de", "es", "fr", "ko", "tr"];

const [artifacts, files, menu, styles, ...localeSources] = await Promise.all([
  read("src/components/workpanel/ArtifactsTab.tsx"),
  read("src/components/workpanel/FilesTab.tsx"),
  read("src/components/workpanel/FileContextMenu.tsx"),
  loadStyles(),
  ...LOCALES.map((locale) =>
    readFile(
      new URL(`../../../packages/i18n/src/locales/${locale}/index.ts`, import.meta.url),
      "utf8",
    ),
  ),
]);

test("a click previews, a double click hands the file to the OS", () => {
  // Artifacts: produced rows and the workspace index rows both preview.
  assert.match(artifacts, /onClick=\{\(\) => openFile\(artifact\.path\)\}/);
  assert.match(artifacts, /onDoubleClick=\{\(\) => openExternal\(artifact\.path\)\}/);
  assert.match(artifacts, /onClick=\{\(\) => openFile\(path\)\}/);
  assert.match(artifacts, /onDoubleClick=\{\(\) => openExternal\(path\)\}/);
  // The tree rows keep their preview too.
  assert.match(files, /onClick=\{\(\) => void openFile\(childRel\)\}/);
  assert.match(files, /onDoubleClick=\{\(\) => openExternal\(childRel\)\}/);
  // Both tabs go through the guarded channels instead of a raw shell call.
  assert.match(artifacts, /api\.fsOpen\(path\)/);
  assert.match(files, /api\.fsOpen\(rel\)/);
  assert.doesNotMatch(artifacts, /shell\.openPath/);
  assert.doesNotMatch(files, /shell\.openPath/);
});

test("right click offers external open and revealing the file in place", () => {
  for (const source of [artifacts, files]) {
    assert.match(source, /onContextMenu=/);
    assert.match(source, /<FileContextMenu/);
    assert.match(source, /api\.fsReveal\(/);
  }
  assert.match(artifacts, /setMenu\(\{ path, x: event\.clientX, y: event\.clientY \}\)/);
  assert.match(files, /setMenu\(\{ path: rel, x: event\.clientX, y: event\.clientY \}\)/);
});

test("the menu is portalled, clamped, and keyboard dismissable", () => {
  assert.match(menu, /createPortal\(/);
  assert.match(menu, /role="menu"/);
  assert.equal([...menu.matchAll(/<button/g)].length, 2);
  assert.match(menu, /t\("panel\.files\.preview\.openExternal"\)/);
  assert.match(menu, /t\("panel\.files\.revealInFolder"\)/);
  assert.match(menu, /event\.key === "Escape"/);
  assert.match(menu, /\["ArrowDown", "ArrowUp", "Home", "End"\]/);
  // Anchored at the pointer but never clipped by the window edge.
  assert.match(menu, /Math\.min\(x, window\.innerWidth - rect\.width - EDGE_MARGIN\)/);
  assert.match(menu, /Math\.min\(y, window\.innerHeight - rect\.height - EDGE_MARGIN\)/);
  assert.match(menu, /addEventListener\("pointerdown", onPointerDown, true\)/);
  assert.match(menu, /addEventListener\("resize", onViewportChange\)/);
  assert.match(menu, /firstItemRef\.current\?\.focus\(\)/);
});

test("every locale labels both actions", () => {
  for (const [index, source] of localeSources.entries()) {
    for (const key of ["revealInFolder", "actionFailed"]) {
      assert.match(
        source,
        new RegExp(`["']?${key}["']?\\s*:\\s*"[^"]+"`),
        `${LOCALES[index]} is missing panel.files.${key}`,
      );
    }
    // The open action reuses the preview's existing wording.
    assert.match(source, /["']?openExternal["']?\s*:\s*"[^"]+"/);
  }
});

test("the menu surface follows the panel's token recipe", () => {
  const block = styles.match(/\.file-context-menu\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(block, /position:\s*fixed/);
  assert.match(block, /z-index:\s*60/);
  assert.match(block, /background:\s*var\(--ds-bg-elevated-opaque/);
  assert.match(block, /box-shadow:\s*var\(--ds-shadow-dialog\)/);
  assert.match(styles, /\.file-context-menu button\s*\{[^}]*gap:\s*8px/s);
});
