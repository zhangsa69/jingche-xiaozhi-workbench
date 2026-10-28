import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { groupReviewChanges } from "../src/lib/review-groups.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const LOCALES = ["zh-CN", "zh-TW", "en", "de", "es", "fr", "ko", "tr"];

const entry = (path, snapshotId, overrides = {}) => ({
  message: { id: `m-${snapshotId}`, role: "tool", content: "" },
  change: {
    version: 1,
    snapshotId,
    messageId: `m-${snapshotId}`,
    path,
    operation: "edit",
    status: "modified",
    state: "active",
    additions: 2,
    deletions: 1,
    hunks: [],
    reversible: true,
    ...overrides,
  },
});

test("one block per file, sorted by path", () => {
  const groups = groupReviewChanges([
    entry("src/b.ts", "s1"),
    entry("src/a.ts", "s2"),
    entry("src/b.ts", "s3"),
  ]);

  assert.deepEqual(
    groups.map((group) => group.path),
    ["src/a.ts", "src/b.ts"],
  );
  // Totals are per file, not per snapshot.
  assert.equal(groups[1].entries.length, 2);
  assert.equal(groups[1].additions, 4);
  assert.equal(groups[1].deletions, 2);
  assert.equal(groups[0].entries.length, 1);
});

test("a file's undo replays its snapshots newest first", () => {
  const groups = groupReviewChanges([
    entry("src/twice.ts", "first"),
    entry("src/twice.ts", "second"),
    entry("src/twice.ts", "third"),
  ]);

  // Transcript order is oldest first; the undo order is the reverse, because
  // each snapshot restores over what the previous one produced.
  assert.deepEqual(
    groups[0].entries.map((item) => item.change.snapshotId),
    ["first", "second", "third"],
  );
  assert.deepEqual(
    groups[0].rollbackTargets.map((target) => target.snapshotId),
    ["third", "second", "first"],
  );
});

test("rolled-back and irreversible snapshots are counted but not undoable", () => {
  const groups = groupReviewChanges([
    entry("src/mixed.ts", "done", { state: "rolledBack" }),
    entry("src/mixed.ts", "stuck", { reversible: false }),
    entry("src/mixed.ts", "open"),
  ]);

  const [group] = groups;
  assert.equal(group.activeCount, 2);
  assert.equal(group.rolledBackCount, 1);
  assert.deepEqual(
    group.rollbackTargets.map((target) => target.snapshotId),
    ["open"],
  );
});

test("the panel groups, undoes, and locates through shared helpers", async () => {
  const [tab, card, slice, locate] = await Promise.all([
    read("src/components/workpanel/ReviewTab.tsx"),
    read("src/components/ReviewChangeCard.tsx"),
    read("src/stores/slices/transcript-slice.ts"),
    read("src/lib/locate-message.ts"),
  ]);

  assert.match(tab, /groupReviewChanges\(entries\)/);
  assert.match(tab, /await rollbackMany\(group\.rollbackTargets\)/);
  // One row per snapshot stays visible inside the group.
  assert.match(tab, /<ReviewChangeCard[\s\S]*?onLocate=\{\(\) => locateTranscriptMessage\(entry\.message\.id\)\}/);
  assert.match(card, /className="review-change-locate"/);
  // Bulk undo is serial: the snapshot chain is stateful.
  assert.match(slice, /for \(const target of targets\) \{/);
  assert.match(slice, /withReviewChangeState\(message, "rolledBack"\)/);
  assert.match(slice, /return \{ rolledBack: rolledBackIds\.length, failed \};/);
  assert.match(locate, /\[data-message-id=/);
  assert.match(locate, /scrollIntoView\(\{ block: "center", behavior: "smooth" \}\)/);
  assert.match(locate, /transcript-locate-target/);
});

test("every locale can describe a file-level undo", async () => {
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
    for (const key of [
      "rollbackFile",
      "rollbackFileDone",
      "rollbackFilePartial",
      "fileSnapshots",
      "locateInChat",
    ]) {
      assert.match(
        source,
        new RegExp(`(?<!\\w)["']?${key}["']?\\s*:\\s*"[^"]+"`),
        `${LOCALES[index]} is missing panel.review.${key}`,
      );
    }
  }
});
