import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  clampLogLimit,
  parseLogLines,
  readLogTail,
} from "../electron/main/log-tail.ts";
import { filterLogRecords, formatLogTime, logLevelCounts } from "../src/lib/log-filter.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const LOCALES = ["zh-CN", "zh-TW", "en", "de", "es", "fr", "ko", "tr"];

const row = (index, overrides = {}) =>
  JSON.stringify({
    ts: `2026-10-28T10:00:0${index}.000Z`,
    level: "info",
    channel: "app",
    category: "session",
    event: `event-${index}`,
    message: `message ${index}`,
    ...overrides,
  });

async function logFixture(rows, extraFiles = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-log-"));
  await mkdir(join(root, "app"), { recursive: true });
  await writeFile(join(root, "app", "session.log"), rows.join("\n") + "\n");
  for (const [name, content] of Object.entries(extraFiles)) {
    await writeFile(join(root, "app", name), content);
  }
  return root;
}

test("a torn last line does not hide the rows before it", () => {
  const parsed = parseLogLines(
    [row(1), '{"ts":"2026-10-28T10:00:02.000Z","leve'].join("\n"),
  );

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].event, "event-1");
  assert.equal(parsed[0].channel, "app");
});

test("rows missing the fields the panel reads are dropped", () => {
  assert.equal(parseLogLines('{"foo":1}\n{"ts":"x","level":"info"}').length, 0);
});

test("the tail is oldest first, capped, and ignores rotated files", async () => {
  const root = await logFixture(
    Array.from({ length: 5 }, (_, index) => row(index)),
    {
      "session.1.log": row(9, { event: "rotated", message: "old" }) + "\n",
    },
  );

  const result = await readLogTail(root, { channel: "app", limit: 2 });

  assert.deepEqual(
    result.records.map((record) => record.event),
    ["event-3", "event-4"],
  );
  assert.equal(result.truncated, true);
  assert.ok(!result.records.some((record) => record.event === "rotated"));
});

test("level and session filters run before the cap", async () => {
  const root = await logFixture([
    row(1, { level: "debug" }),
    row(2, { level: "warn", sessionId: "s-1" }),
    row(3, { level: "error", sessionId: "s-2" }),
    row(4, { level: "info", sessionId: "s-1" }),
  ]);

  const warnings = await readLogTail(root, {
    channel: "app",
    level: "warn",
    sessionId: "s-1",
  });
  assert.deepEqual(
    warnings.records.map((record) => record.level),
    ["warn"],
  );

  const missing = await readLogTail(root, { channel: "agent" });
  assert.deepEqual(missing, { records: [], truncated: false });
});

test("a limit stays inside the window the host is willing to read", () => {
  assert.equal(clampLogLimit(undefined), 200);
  assert.equal(clampLogLimit(0), 1);
  assert.equal(clampLogLimit(10_000), 1_000);
  assert.equal(clampLogLimit("x"), 200);
});

test("the client filters and counts without another round trip", () => {
  const records = [
    { ts: "2026-10-28T10:00:00.000Z", level: "info", channel: "app", category: "tool", event: "tool.run", message: "ran Bash" },
    { ts: "2026-10-28T10:00:01.000Z", level: "error", channel: "app", category: "provider", event: "provider.fail", message: "upstream 502", data: { code: "ECONNRESET" } },
  ];

  assert.equal(filterLogRecords(records, { level: "error", query: "" }).length, 1);
  assert.equal(filterLogRecords(records, { level: "all", query: "econn" }).length, 1);
  assert.equal(filterLogRecords(records, { level: "all", query: "nothing" }).length, 0);
  assert.deepEqual(logLevelCounts(records), { debug: 0, info: 1, warn: 0, error: 1 });
  assert.match(formatLogTime("not-a-date"), /not-a-date/);
});

test("the panel reads the tail through one channel and one tab kind", async () => {
  const [protocol, ipc, api, tab, tabs, workPanel] = await Promise.all([
    read("../../packages/shared/src/protocol.ts"),
    read("electron/main/ipc/log-ipc.ts"),
    read("src/lib/api.ts"),
    read("src/components/workpanel/LogTab.tsx"),
    read("src/lib/work-panel-tabs.ts"),
    read("src/components/workpanel/WorkPanel.tsx"),
  ]);

  assert.match(protocol, /logTail: "pi-desktop\/log\/tail"/);
  assert.match(ipc, /readLogTail\(join\(dataDir, "logs"\)/);
  // Unknown filter values are a bug, not an empty result.
  assert.match(ipc, /throw invalid\("unknown log channel"\)/);
  assert.match(api, /logTail: \(request: LogTailRequest\) =>/);
  // Following the tail is a poll, and the interval is stated once.
  assert.match(tab, /const POLL_MS = 2000;/);
  assert.match(tab, /window\.setInterval\(\(\) => void load\(\), POLL_MS\)/);
  assert.match(tabs, /tab\.kind === "log"/);
  assert.match(workPanel, /toolWorkPanelTab\("log"\)/);
  assert.match(workPanel, /activeTab\?\.kind === "log"/);
});

test("every locale can label the log panel", async () => {
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
      "channel",
      "level",
      "all",
      "search",
      "follow",
      "empty",
      "emptyHint",
      "error",
      "truncated",
      "count",
      "counts",
      "details",
    ]) {
      assert.match(
        source,
        new RegExp(`(?<!\\w)["']?${key}["']?\\s*:\\s*["\`][^"\`]+["\`]`),
        `${LOCALES[index]} is missing panel.log.${key}`,
      );
    }
    assert.match(
      source,
      /(?<!\w)["']?log["']?\s*:\s*"/,
      `${LOCALES[index]} is missing panel.tabs.log`,
    );
  }
});
