import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveTaskHistory,
  groupTaskHistory,
  taskDayKey,
  taskReusePlan,
  taskSourcePrompt,
} from "../src/lib/task-history.ts";

function session(id, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    messageCount: 4,
    mode: "agent",
    thinkingLevel: "off",
    permissionMode: "inherit",
    createdAt: "2026-10-20T09:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

test("history keeps finished work, newest activity first", () => {
  const rows = deriveTaskHistory([
    session("old", { updatedAt: "2026-10-01T08:00:00.000Z" }),
    session("new", { updatedAt: "2026-10-27T08:00:00.000Z" }),
    session("draft", { messageCount: 0 }),
  ]);

  assert.deepEqual(
    rows.map((row) => row.id),
    ["new", "old"],
  );
  assert.equal(rows[0].messageCount, 4);
});

test("an unnamed session is reported as empty, not as a made-up title", () => {
  const [row] = deriveTaskHistory([session("a", { title: "   " })]);
  assert.equal(row.title, "");
});

test("the cap keeps the list a working set", () => {
  const many = Array.from({ length: 5 }, (_, index) =>
    session(`s${index}`, {
      updatedAt: `2026-10-0${index + 1}T00:00:00.000Z`,
    })
  );
  assert.equal(deriveTaskHistory(many, 2).length, 2);
});

test("native transcripts are flagged read-only so actions can disable", () => {
  const [row] = deriveTaskHistory([session("pi", { source: "pi-native" })]);
  assert.equal(row.readOnly, true);
  assert.equal(deriveTaskHistory([session("d")])[0].readOnly, false);
});

test("days are local: today, yesterday, then a dated bucket", () => {
  const now = new Date(2026, 9, 28, 15, 30);
  const at = (day, hour = 10) => new Date(2026, 9, day, hour).toISOString();

  assert.equal(taskDayKey(at(28), now), "today");
  assert.equal(taskDayKey(at(27, 23), now), "yesterday");
  assert.equal(taskDayKey(at(20), now), "2026-10-20");
  assert.equal(taskDayKey("not-a-date", now), "unknown");
});

test("grouping keeps order and merges only adjacent days", () => {
  const now = new Date(2026, 9, 28, 15, 30);
  const rows = deriveTaskHistory([
    session("a", { updatedAt: new Date(2026, 9, 28, 9).toISOString() }),
    session("b", { updatedAt: new Date(2026, 9, 28, 8).toISOString() }),
    session("c", { updatedAt: new Date(2026, 9, 27, 20).toISOString() }),
    session("d", { updatedAt: new Date(2026, 9, 20, 20).toISOString() }),
  ]);

  const groups = groupTaskHistory(rows, now);
  assert.deepEqual(
    groups.map((group) => group.key),
    ["today", "yesterday", "2026-10-20"],
  );
  assert.deepEqual(
    groups[0].rows.map((row) => row.id),
    ["a", "b"],
  );
});

test("a rerun replays the first user message, not the last correction", () => {
  const messages = [
    { role: "assistant", content: "Hi" },
    { role: "user", content: "  把第三季度报表整理成 PPT " },
    { role: "user", content: "不要用蓝色" },
  ];
  assert.equal(taskSourcePrompt(messages), "把第三季度报表整理成 PPT");
  assert.equal(taskSourcePrompt([{ role: "assistant", content: "Hi" }]), null);
  assert.equal(taskSourcePrompt([{ role: "user", content: "   " }]), null);
});

test("each action has one documented plan", () => {
  const row = { projectPath: "E:/work/reports" };

  assert.deepEqual(taskReusePlan("rerun", row), {
    projectPath: "E:/work/reports",
    sendPrompt: true,
    needsPrompt: true,
  });
  assert.deepEqual(taskReusePlan("input", row), {
    projectPath: null,
    sendPrompt: true,
    needsPrompt: true,
  });
  assert.deepEqual(taskReusePlan("workspace", row), {
    projectPath: "E:/work/reports",
    sendPrompt: false,
    needsPrompt: false,
  });
});

test("a task without a workspace still plans three usable actions", () => {
  const plan = taskReusePlan("workspace", { projectPath: null });
  assert.equal(plan.projectPath, null);
  assert.equal(plan.sendPrompt, false);
});
