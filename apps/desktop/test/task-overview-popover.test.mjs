import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const LOCALES = ["zh-CN", "zh-TW", "en", "de", "es", "fr", "ko", "tr"];

// W-03: the top bar's checklist button opens a summary of what the task
// produced and where it is in its run.
test("the top bar exposes the task overview for an open session", async () => {
  const [topbar, popover] = await Promise.all([
    read("src/components/ConversationTopbar.tsx"),
    read("src/components/TaskOverviewPopover.tsx"),
  ]);

  assert.match(
    topbar,
    /\{activeSession \? <TaskOverviewPopover \/> : null\}/,
  );
  assert.match(popover, /role="dialog"/);
  assert.match(popover, /aria-haspopup="dialog"/);
  assert.match(popover, /className="ct-overview-badge"/);
  assert.match(popover, /createPortal\(panel, document\.body\)/);
});

test("artifacts come from review records, deduped by path and rolled back ones dropped", async () => {
  // Shared with the artifacts tab (W-11), so the badge and the tab agree.
  const artifacts = await read("src/lib/task-artifacts.ts");

  assert.match(artifacts, /reviewChangesFromMessages\(messages\)/);
  assert.match(artifacts, /if \(change\.state !== "active"\) continue;/);
  // Later writes to the same file supersede the earlier row instead of adding
  // a second one, so the badge counts files rather than edits.
  assert.match(artifacts, /byPath\.set\(change\.path,/);
  assert.match(artifacts, /return \[\.\.\.byPath\.values\(\)\]/);
});

test("progress rows keep their task-wide position and drop empty states", async () => {
  const popover = await read("src/components/TaskOverviewPopover.tsx");

  assert.match(popover, /const PROGRESS_ROWS = 6;/);
  assert.match(popover, /index: start \+ offset \+ 1,/);
  assert.match(popover, /chat\.overviewNoArtifacts/);
  assert.match(popover, /chat\.overviewNoSteps/);
  assert.match(popover, /chat\.overviewToolCalls/);
});

test("an artifact row opens the file tab and closes the panel", async () => {
  const popover = await read("src/components/TaskOverviewPopover.tsx");

  assert.match(popover, /openWorkPanelTab\(fileWorkPanelTab\(path\)\)/);
  assert.match(popover, /onClick=\{\(\) => openArtifact\(artifact\.path\)\}/);
});

test("a finished task keeps a frozen duration instead of drifting", async () => {
  const popover = await read("src/components/TaskOverviewPopover.tsx");

  // Only a running task with the panel open supplies `now`.
  assert.match(popover, /taskWorkSeconds\(messages, running && open \? now : null\)/);
  assert.match(popover, /if \(!open \|\| !running\) return;/);
  assert.match(popover, /if \(typeof now === "number"\)/);
});

test("the overview is styled with design tokens", async () => {
  const styles = await read("src/styles/chrome.css");

  assert.match(styles, /\.task-overview-popover \{/);
  assert.match(styles, /\.task-overview-popover\.is-open \{/);
  assert.match(styles, /\.task-overview-dot\.is-running \{\n  background: var\(--ds-success\);/);
  assert.match(styles, /\.task-overview-empty \{/);
  assert.match(styles, /\.task-overview-step-state\.is-running \{/);
});

test("every locale carries the task overview copy", async () => {
  const catalogs = await Promise.all(
    LOCALES.map((locale) =>
      readFile(
        new URL(
          `../../../packages/i18n/src/locales/${locale}/index.ts`,
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );

  const keys = [
    "overviewTitle",
    "overviewElapsed",
    "overviewArtifacts",
    "overviewNoArtifacts",
    "overviewSteps",
    "overviewNoSteps",
    "overviewToolCalls",
  ];

  for (const [index, source] of catalogs.entries()) {
    for (const key of keys) {
      assert.match(
        source,
        new RegExp(`["']?${key}["']?\\s*:\\s*"[^"]+"`),
        `${LOCALES[index]} is missing chat.${key}`,
      );
    }
    // The placeholders must survive translation or the panel renders braces.
    assert.match(source, /overviewElapsed["']?\s*:\s*"[^"]*\{\{time\}\}/);
    assert.match(source, /overviewToolCalls["']?\s*:\s*"[^"]*\{\{count\}\}/);
  }
});
