import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  collectTaskArtifacts,
  groupTaskChanges,
  shortArtifactPath,
} from "../src/lib/task-artifacts.ts";
import {
  isKnownWorkPanelTab,
  toolWorkPanelTab,
} from "../src/lib/work-panel-tabs.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const LOCALES = ["zh-CN", "zh-TW", "en", "de", "es", "fr", "ko", "tr"];
const PANEL_KEYS = [
  "produced",
  "changed",
  "files",
  "noProduced",
  "noChanged",
  "noFiles",
  "noWorkspace",
  "loading",
  "loadError",
  "more",
  "rolledBack",
];

/** A successful write message carrying the durable review record. */
let sequence = 0;
function write(path, { state = "active", additions = 1, deletions = 0 } = {}) {
  sequence += 1;
  return {
    id: `message-${sequence}`,
    role: "tool",
    toolName: "Edit",
    toolStatus: "success",
    toolResult: {
      details: {
        root: "workspace",
        review: {
          version: 1,
          snapshotId: `snapshot-${sequence}`,
          messageId: `message-${sequence}`,
          path,
          operation: "edit",
          status: "modified",
          state,
          additions,
          deletions,
          hunks: [],
        },
      },
    },
  };
}

test("produced files are the active writes, one row per path, latest counts", () => {
  const messages = [
    write("src/a.ts", { additions: 3, deletions: 1 }),
    write("src/a.ts", { additions: 5, deletions: 2 }),
    write("src/b.ts", { state: "rolledBack" }),
    write("src/c.ts", { additions: 2 }),
    write("src/c.ts", { state: "rolledBack" }),
  ];

  const artifacts = collectTaskArtifacts(messages);

  assert.deepEqual(
    artifacts.map((artifact) => artifact.path),
    ["src/a.ts", "src/c.ts"],
  );
  // The latest write wins, so a second edit does not double-count.
  assert.deepEqual(artifacts[0], { path: "src/a.ts", additions: 5, deletions: 2 });
});

test("changes keep every touched file, count snapshots, and demote rollbacks", () => {
  const messages = [
    write("b.ts"),
    write("a.ts", { additions: 4 }),
    write("a.ts", { additions: 7, deletions: 3 }),
    write("b.ts", { state: "rolledBack" }),
  ];

  const changes = groupTaskChanges(messages);

  assert.deepEqual(
    changes.map((change) => change.path),
    ["a.ts", "b.ts"],
    "an active file sorts before a rolled-back one",
  );
  assert.deepEqual(changes[0], {
    path: "a.ts",
    additions: 7,
    deletions: 3,
    status: "modified",
    rolledBack: false,
    snapshots: 2,
  });
  assert.equal(changes[1].rolledBack, true);
});

test("paths are shortened from the left so the file name stays visible", () => {
  assert.equal(
    shortArtifactPath("apps/desktop/src/components/workpanel/ArtifactsTab.tsx"),
    "…/workpanel/ArtifactsTab.tsx",
  );
  assert.equal(shortArtifactPath("README.md"), "README.md");
  assert.equal(shortArtifactPath("src\\lib\\api.ts"), "…/lib/api.ts");
});

test("the tab is a known, per-session singleton", () => {
  const tab = toolWorkPanelTab("artifact");

  assert.equal(tab.kind, "artifact");
  assert.equal(tab.id, "artifact");
  assert.equal(isKnownWorkPanelTab(tab), true);
  assert.equal(isKnownWorkPanelTab({ id: "x", kind: "nonsense" }), false);
});

test("the tab renders three groups over the shared derivation", async () => {
  const [tab, panel] = await Promise.all([
    read("src/components/workpanel/ArtifactsTab.tsx"),
    read("src/components/workpanel/WorkPanel.tsx"),
  ]);

  assert.match(tab, /collectTaskArtifacts\(messages\)/);
  assert.match(tab, /groupTaskChanges\(messages\)/);
  assert.match(tab, /t\("panel\.artifacts\.produced"\)/);
  assert.match(tab, /t\("panel\.artifacts\.changed"\)/);
  assert.match(tab, /t\("panel\.artifacts\.files"\)/);
  // A change row points at the diff view rather than re-implementing diffs.
  assert.match(tab, /openWorkPanelTab\(toolWorkPanelTab\("review"\)\)/);
  assert.match(tab, /openWorkPanelTab\(fileWorkPanelTab\(/);
  assert.match(tab, /t\("panel\.artifacts\.rolledBack"\)/);
  // The workspace index is capped instead of silently dropping the tail.
  assert.match(tab, /const FILE_ROWS = 200;/);
  assert.match(tab, /t\("panel\.artifacts\.more", \{\s*count: Math\.max\(0, files\.length - FILE_ROWS\),?\s*\}\)/);
  // The panel has to know the kind, or the tab opens onto nothing.
  assert.match(panel, /artifact: IconArchive,/);
  assert.match(panel, /activeTab\?\.kind === "artifact" && \(/);
  assert.match(panel, /label: t\("panel\.tabs\.artifact"\)/);
});

test("every locale can label the three groups", async () => {
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

  for (const [index, source] of catalogs.entries()) {
    assert.match(
      source,
      /["']?artifact["']?\s*:\s*"[^"]+"/,
      `${LOCALES[index]} is missing panel.tabs.artifact`,
    );
    for (const key of PANEL_KEYS) {
      assert.match(
        source,
        new RegExp(`["']?${key}["']?\\s*:\\s*"[^"]+"`),
        `${LOCALES[index]} is missing panel.artifacts.${key}`,
      );
    }
    assert.match(source, /more["']?\s*:\s*"[^"]*\{\{count\}\}/);
  }
});
