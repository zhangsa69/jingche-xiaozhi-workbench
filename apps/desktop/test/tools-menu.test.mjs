import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { readMainModule } from "./helpers/source-contracts.mjs";
import { loadStyles } from "./helpers/styles.mjs";

/*
  The footer chip opens three intranet tools. They are separate web apps, so the
  click hands a URL to the OS instead of loading a pane, and the address must
  never travel from the renderer: a tool id goes over IPC and Main resolves it
  (D428). These tests pin both halves and the menu's keyboard contract.
*/

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const toolsCatalog = await read("../../../packages/shared/src/workspace-tools.ts");
const mainTools = await readMainModule("workspace-tools.ts");
const protocolSource = await read("../../../packages/shared/src/protocol.ts");
const appIpcSource = await readMainModule("ipc/app-ipc.ts");
const registerSource = await readMainModule("ipc/register.ts");
const apiSource = await read("../src/lib/api.ts");
const menuSource = await read("../src/components/ToolsMenu.tsx");
const sidebarSource = await read("../src/components/Sidebar.tsx");
const styles = await loadStyles();

test("the shared catalog names the four tools and carries no address", () => {
  assert.doesNotMatch(toolsCatalog, /10\.120\.65\.148/);
  assert.doesNotMatch(toolsCatalog, /\burl\s*:/);
  const idList = toolsCatalog.match(/WORKSPACE_TOOL_IDS[^=]*=\s*\[([^\]]*)\]/)?.[1] ?? "";
  const ids = [...idList.matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ["pdf", "cad", "mindmap", "minutes"]);
  assert.match(toolsCatalog, /export function isWorkspaceToolId/);
});

test("main owns the intranet addresses", () => {
  const urls = [...mainTools.matchAll(/:\s*"(https?:\/\/[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(urls, [
    "http://10.120.65.148:3001/zh/",
    "http://10.120.65.148:3003/",
    "http://10.120.65.148:3002/",
    "https://10.120.65.148:3005/",
  ]);
  for (const url of urls) {
    // Intranet only: nothing routable on the public internet, no scheme trick.
    assert.match(url, /^https?:\/\/10\.120\.65\.148:\d{4}\//);
    // Every address is one the guarded opener accepts (D330).
    assert.ok(["http:", "https:"].includes(new URL(url).protocol));
    assert.equal(new URL(url).hostname, "10.120.65.148");
  }
  assert.match(mainTools, /workspaceToolUrl\(rawId: unknown\): string \| null/);
});

test("the shipped package exposes ids only, so no bundle inherits a host", async () => {
  // Guards the built dist too: the renderer imports this package.
  const shared = await import("@pi-desktop/shared");
  assert.deepEqual([...shared.WORKSPACE_TOOL_IDS], ["pdf", "cad", "mindmap", "minutes"]);
  assert.equal(shared.isWorkspaceToolId("pdf"), true);
  assert.equal(shared.isWorkspaceToolId("shell"), false);
  assert.equal(shared.isWorkspaceToolId(undefined), false);
  assert.equal(shared.workspaceToolUrl, undefined);
  assert.equal(shared.WORKSPACE_TOOLS, undefined);
});

test("the renderer names a tool, never a URL", () => {
  assert.match(protocolSource, /appOpenWorkspaceTool: "pi-desktop\/app\/openWorkspaceTool"/);
  assert.match(apiSource, /openWorkspaceTool: \(toolId: WorkspaceToolId\)/);
  assert.match(apiSource, /invoke\(IPC\.invoke\.appOpenWorkspaceTool, \{ toolId \}\)/);
  // No address may live in the renderer bundle at all.
  assert.doesNotMatch(menuSource, /10\.120\.65\.148/);
  assert.doesNotMatch(apiSource, /10\.120\.65\.148/);
  assert.doesNotMatch(sidebarSource, /10\.120\.65\.148/);
});

test("main resolves the id through the guarded opener", () => {
  const handler = appIpcSource.match(
    /handle\(IPC\.invoke\.appOpenWorkspaceTool[\s\S]*?\n  \}\);/,
  )?.[0] ?? "";
  assert.ok(handler, "the channel is registered");
  // The table lives beside Main, not in the package the renderer shares.
  assert.match(appIpcSource, /import \{ workspaceToolUrl \} from "\.\.\/workspace-tools"/);
  assert.match(handler, /workspaceToolUrl\(toolId\)/);
  assert.match(handler, /if \(!url\)/);
  assert.match(handler, /await openExternal\(url\)/);
  // An unknown id has no address to open, so the handler never falls back to a
  // renderer-supplied string.
  assert.doesNotMatch(handler, /shell\.openExternal/);
  // The opener is the guarded one from desktop services, not a raw shell call.
  assert.match(
    registerSource,
    /registerAppIpc\(\{[\s\S]*?openExternal: safeOpenExternal/,
  );
});

test("the menu opens upward and stays keyboard reachable", () => {
  assert.match(menuSource, /createPortal\(/);
  assert.match(menuSource, /role="menu"/);
  assert.match(menuSource, /aria-haspopup="menu"/);
  assert.match(menuSource, /aria-expanded=\{open\}/);
  // Anchor math: the footer is on the window edge, so the panel hangs above it.
  assert.match(menuSource, /window\.innerHeight - rect\.top \+ ANCHOR_GAP/);
  // The chip is pinned to the sidebar's right edge, so the panel aligns to that
  // edge and stays inside the sidebar instead of hanging over the transcript.
  assert.match(menuSource, /Math\.max\(EDGE_MARGIN, rect\.right - MENU_WIDTH\)/);
  assert.match(menuSource, /Math\.max\(EDGE_MARGIN, window\.innerWidth - MENU_WIDTH - EDGE_MARGIN\)/);
  assert.match(menuSource, /event\.key === "Escape"/);
  assert.match(menuSource, /\["ArrowDown", "ArrowUp", "Home", "End"\]/);
  // Clicking away, resizing, or leaving the window drops a fixed-position panel.
  assert.match(menuSource, /addEventListener\("pointerdown", onPointerDown, true\)/);
  assert.match(menuSource, /addEventListener\("resize", onViewportChange\)/);
  assert.match(menuSource, /addEventListener\("blur", onViewportChange\)/);
  assert.match(menuSource, /role="menuitem"/);
  assert.match(menuSource, /firstItemRef\.current\?\.focus\(\)/);
});

test("the toolset trigger is the same icon button as the footer actions", () => {
  const button = styles.match(/\.footer-toolset\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(button, /width:\s*32px/);
  assert.match(button, /height:\s*32px/);
  assert.match(button, /justify-content:\s*center/);
  assert.match(button, /border-radius:\s*var\(--radius-md\)/);
  assert.match(button, /color:\s*var\(--ds-text-muted\)/);
  assert.match(button, /margin-left:\s*auto/);
  // One 14px glyph, like its siblings: no label or chevron left to clip in a
  // narrow sidebar (that squeeze is what made the old chip read as stray dots).
  assert.match(menuSource, /<IconToolbox size=\{14\} aria-hidden \/>/);
  assert.doesNotMatch(menuSource, /IconWrench|IconChevronDown|footer-toolset-label/);
  assert.doesNotMatch(styles, /\.footer-toolset-(label|chevron)/);
  assert.match(styles, /\.footer-toolset\[aria-expanded="true"\]\s*\{[^}]*background:\s*var\(--ds-bg-active\)/s);
  assert.doesNotMatch(styles, /\.footer-build/);
});

test("every locale names the chip and its four tools", async () => {
  const locales = await readdir(new URL("../../../packages/i18n/src/locales", import.meta.url), {
    withFileTypes: true,
  });
  for (const locale of locales.filter((entry) => entry.isDirectory())) {
    const source = await read(`../../../packages/i18n/src/locales/${locale.name}/index.ts`);
    for (const key of ["title", "pdf", "cad", "mindmap", "minutes", "openFailed"]) {
      assert.match(source, new RegExp(`["']?${key}["']?\\s*:`), `${locale.name}:${key}`);
    }
    // The version chip is gone, so its copy goes with it — but the native
    // application menu still offers its own Check for Updates item.
    assert.doesNotMatch(source, /buildUnknown/);
    assert.match(source, /["']?menu["']?\s*:\s*\{/);
    const menuBlock = source.slice(
      source.match(/^ {2}["']?menu["']?\s*:\s*\{/m).index,
    );
    assert.match(menuBlock.slice(0, 2000), /checkForUpdates/);
  }
});
