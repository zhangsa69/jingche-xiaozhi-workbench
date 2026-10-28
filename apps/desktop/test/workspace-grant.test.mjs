import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  normalizeWorkspacePath,
  rememberWorkspaceBrief,
  shouldShowWorkspaceBrief,
  workspaceBrief,
  workspaceGrantKey,
} from "../src/lib/workspace-grant.ts";

test("a bound folder is described as the place output lands", () => {
  const brief = workspaceBrief({ projectPath: "E:\\work\\reports" });
  assert.equal(brief.kind, "project");
  assert.equal(brief.location, "E:/work/reports");
  assert.equal(brief.needsFolder, false);
});

test("the rows answer writes, then reads, then what stays local", () => {
  assert.deepEqual(workspaceBrief({ projectPath: "E:/work" }).rows, [
    "writes",
    "reads",
    "keeps",
  ]);
});

test("the shell workspace stands in when the session carries no path", () => {
  const brief = workspaceBrief({ fallbackPath: "E:/work/platform/" });
  assert.equal(brief.kind, "project");
  assert.equal(brief.location, "E:/work/platform");
});

test("nothing bound yet is the one case that must offer a picker", () => {
  const brief = workspaceBrief({});
  assert.equal(brief.kind, "temporary");
  assert.equal(brief.location, null);
  assert.equal(brief.needsFolder, true);
});

test("trailing separators and backslashes describe the same folder", () => {
  assert.equal(normalizeWorkspacePath("  E:\\work\\reports\\  "), "E:/work/reports");
  assert.equal(normalizeWorkspacePath("/home/me/project///"), "/home/me/project");
  assert.equal(normalizeWorkspacePath(""), "");
  assert.equal(normalizeWorkspacePath(null), "");
});

test("a drive root keeps its separator instead of collapsing to a drive letter", () => {
  assert.equal(normalizeWorkspacePath("C:\\"), "C:/");
});

test("dismissal is remembered per folder, not per run", () => {
  const first = workspaceBrief({ projectPath: "E:/work/a" });
  const second = workspaceBrief({ projectPath: "E:/work/b" });

  assert.equal(shouldShowWorkspaceBrief(first, []), true);
  assert.equal(shouldShowWorkspaceBrief(first, ["project:e:/work/a"]), false);
  // A second folder is a different question, so it still asks.
  assert.equal(shouldShowWorkspaceBrief(second, ["project:e:/work/a"]), true);
});

test("the folderless case is dismissable too", () => {
  const brief = workspaceBrief({});
  assert.equal(shouldShowWorkspaceBrief(brief, ["temporary:"]), false);
});

test("recording a dismissal twice leaves one entry", () => {
  const brief = workspaceBrief({ projectPath: "E:/work" });
  const once = rememberWorkspaceBrief([], brief);
  const twice = rememberWorkspaceBrief(once, brief);
  assert.deepEqual(once, [workspaceGrantKey("E:/work", "project")]);
  assert.deepEqual(twice, once);
});

test("key ignores case so an echoed path does not re-ask", () => {
  assert.equal(
    workspaceGrantKey("E:\\Work\\Reports\\", "project"),
    workspaceGrantKey("e:/work/reports", "project"),
  );
});

test("the card sits on the empty home before the composer", async () => {
  const surface = await readFile(
    new URL("../src/components/ChatSurface.tsx", import.meta.url),
    "utf8",
  );
  const brief = surface.indexOf("<WorkspaceBriefCard />");
  const composer = surface.indexOf('className="home-composer-wrap"');
  assert.ok(brief > 0, "the empty home must mount the brief");
  assert.ok(composer > brief, "the brief belongs above the composer");
});

test("the card only offers the picker when nothing is bound", async () => {
  const card = await readFile(
    new URL("../src/components/WorkspaceBriefCard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(card, /\{brief\.needsFolder \?/);
  assert.match(card, /data-brief-row=\{id\}/);
});
