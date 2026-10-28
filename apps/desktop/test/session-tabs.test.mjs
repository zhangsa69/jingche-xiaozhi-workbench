import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(here, relative), "utf8");

const bar = read("../src/components/SessionTabBar.tsx");
const surface = read("../src/components/ChatSurface.tsx");
const appState = read("../src/stores/app-state.ts");
const slice = read("../src/stores/slices/session-slice.ts");
const projectSlice = read("../src/stores/slices/project-slice.ts");
const initial = read("../src/stores/slices/initial-state.ts");
const css = read("../src/styles/session-tabs.css");
const globals = read("../src/styles/globals.css");
const shared = read("../../../packages/shared/src/session-tabs.ts");

const LOCALES = ["en", "de", "es", "fr", "ko", "tr", "zh-CN", "zh-TW"];
const KEYS = ["sessionTabs", "sessionTabClose", "sessionTabOverflow"];

test("tab arithmetic lives in shared, once", () => {
  for (const fn of [
    "openSessionTab",
    "closeSessionTab",
    "activeSessionTabAfterClose",
    "pruneSessionTabs",
    "hiddenSessionTabCount",
  ]) {
    assert.match(shared, new RegExp(`export function ${fn}\\(`), fn);
  }
  // The bar must not re-derive tab ordering locally.
  assert.doesNotMatch(bar, /sessionTabs\.(concat|filter)\([^)]*\)\s*,/);
  assert.match(bar, /from "@pi-desktop\/shared"/);
});

test("a tab is a view: closing one never deletes the session", () => {
  const closeBlock = slice.slice(
    slice.indexOf("closeSessionTab:"),
    slice.indexOf("selectSession:"),
  );
  assert.doesNotMatch(closeBlock, /deleteSession|removeSession|api\.delete/);
  assert.match(closeBlock, /closeSessionTab\(state\.sessionTabs, id\)/);
});

test("closing the visible tab hands over before it empties the pane", () => {
  assert.match(slice, /activeSessionTabAfterClose\(get\(\)\.sessionTabs, id, active\)/);
  assert.match(slice, /if \(active === id && nextActive\) await get\(\)\.selectSession\(nextActive\)/);
});

test("selecting a session keeps its tab, without reordering the bar", () => {
  assert.match(slice, /sessionTabs: openSessionTab\(state\.sessionTabs, id\)/);
  // Re-opening an existing tab must be a no-op for state identity.
  assert.match(slice, /sessionTabs\.length === state\.sessionTabs\.length/);
  assert.match(slice, /return unchanged \? \{\} : \{ sessionTabs \}/);
});

test("tabs are pruned when their session disappears", () => {
  assert.match(
    projectSlice,
    /sessionTabs: pruneSessionTabs\(\s*state\.sessionTabs,\s*sessions\.map\(\(session\) => session\.id\),\s*\)/,
  );
});

test("the tab list is real store state, not component memory", () => {
  assert.match(appState, /sessionTabs: string\[\];/);
  assert.match(appState, /openSessionTab: \(id: string\) => void;/);
  assert.match(appState, /closeSessionTab: \(id: string\) => Promise<void>;/);
  assert.match(initial, /sessionTabs: \[\]/);
});

test("the bar renders from the session list and says when it overflowed", () => {
  assert.match(bar, /runningSessions\[tab\.id\]/);
  assert.match(bar, /hiddenSessionTabCount\(sessionTabs\)/);
  // A tab whose session vanished must not be painted.
  assert.match(bar, /return session \? \[\{ id, title: session\.title \}\] : \[\]/);
});

test("one tab is not a bar", () => {
  assert.match(bar, /if \(tabs\.length < 2\) return null;/);
});

test("the bar is keyboard reachable and labelled", () => {
  assert.match(bar, /role="tablist"/);
  assert.match(bar, /aria-label=\{t\("chat\.sessionTabs"\)\}/);
  assert.match(bar, /role="tab"/);
  assert.match(bar, /aria-selected=\{selected\}/);
  // The close control sits outside the tab button, not inside it.
  assert.match(bar, /<\/button>\s*<button\s+type="button"\s+className="stb-close"/);
  assert.match(bar, /aria-label=\{t\("chat\.sessionTabClose", \{ title \}\)\}/);
});

test("the bar sits above the panes it switches", () => {
  assert.match(surface, /<SessionTabBar \/>/);
  assert.ok(
    surface.indexOf("<SessionTabBar />") < surface.indexOf("session-panes"),
    "tab bar must precede the session panes",
  );
});

test("styles stay on tokens and honour reduced motion", () => {
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(globals, /@import "\.\/session-tabs\.css";/);
});

test("all eight locales carry the tab strings", () => {
  for (const locale of LOCALES) {
    const source = read(`../../../packages/i18n/src/locales/${locale}/index.ts`);
    for (const key of KEYS) {
      assert.ok(
        new RegExp(`"?${key}"?:`).test(source),
        `${locale} is missing chat.${key}`,
      );
    }
  }
});
