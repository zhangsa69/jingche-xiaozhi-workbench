import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TERMINAL_ENTRY_CHARS,
  terminalEntries,
  terminalEntry,
  terminalState,
  terminalText,
} from "../src/lib/terminal-log.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const LOCALES = ["zh-CN", "zh-TW", "en", "de", "es", "fr", "ko", "tr"];

const run = (id, command, result, overrides = {}) => ({
  id,
  toolName: "Bash",
  toolArgs: { command },
  toolResult: result,
  toolStatus: "success",
  ...overrides,
});

test("only commands take part, and they keep the order they ran in", () => {
  const entries = terminalEntries([
    run("1", "pnpm test", { stdout: "ok", stderr: "", exitCode: 0 }),
    {
      id: "2",
      toolName: "Read",
      toolArgs: { path: "a.ts" },
      toolResult: "contents",
      toolStatus: "success",
    },
    {
      id: "3",
      toolName: "Edit",
      toolArgs: { path: "a.ts" },
      toolResult: "edited",
      toolStatus: "success",
    },
    run("4", "git status", { stdout: "clean", stderr: "", exitCode: 0 }),
    { id: "5", toolName: "delegate", toolArgs: { task: "look" } },
  ]);

  // A reversed list reads as a plausible history while being wrong, which is
  // the failure this pins.
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["1", "4"],
  );
});

test("a finished command carries its output, its code, and its duration", () => {
  const [entry] = terminalEntries([
    run(
      "1",
      "npm run build",
      { stdout: "built", stderr: "warning", exitCode: 2 },
      { toolDurationMs: 4200 },
    ),
  ]);

  assert.equal(entry.command, "npm run build");
  assert.equal(entry.stdout, "built");
  assert.equal(entry.stderr, "warning");
  assert.equal(entry.exitCode, 2);
  assert.equal(entry.durationMs, 4200);
  // Failed comes from the exit code, not from the call's own status: a command
  // that exits non-zero failed even though the call around it succeeded (D227).
  assert.equal(entry.outcome, "failed");
  assert.equal(entry.omittedChars, 0);
});

test("a running command shows its progress, and completion clears it", () => {
  const progress = run(
    "1",
    "npm test",
    { output: "RUNS  spec/a.test.ts" },
    { toolStatus: "running" },
  );
  const [live] = terminalEntries([progress]);
  assert.equal(live.stdout, "RUNS  spec/a.test.ts");
  assert.equal(live.outcome, "running");

  // The completed result reports an empty stdout. That emptiness is meaningful:
  // it has to suppress the progress snapshot rather than fall back to it.
  const [done] = terminalEntries([
    run("1", "npm test", { stdout: "", stderr: "", exitCode: 1 }),
  ]);
  assert.equal(done.stdout, "");
  assert.equal(done.outcome, "failed");
});

test("an imported message with a bare string result still prints", () => {
  const [entry] = terminalEntries([
    run("1", "ls", "a.txt\nb.txt", { toolStatus: undefined }),
  ]);

  assert.equal(entry.stdout, "a.txt\nb.txt");
  assert.equal(entry.outcome, "unknown");
});

test("an empty result never falls back to its own JSON body", () => {
  const message = run("1", "true", { stdout: "", stderr: "", exitCode: 0 });
  // A message body is often the pretty-printed result itself; printing it would
  // invent output the command never wrote.
  message.content = JSON.stringify(
    { stdout: "", stderr: "", exitCode: 0 },
    null,
    2,
  );

  assert.equal(terminalEntries([message])[0].stdout, "");
});

test("a run call with no command is skipped instead of shown blank", () => {
  assert.equal(
    terminalEntry({
      id: "1",
      toolName: "Bash",
      toolArgs: {},
      toolResult: "something",
      toolStatus: "success",
    }),
    null,
  );
});

test("long output keeps its tail, starts on a line, and says what it dropped", () => {
  const body = Array.from(
    { length: 600 },
    (_, index) => `line ${index} ${"x".repeat(40)}`,
  ).join("\n");
  assert.ok(body.length > TERMINAL_ENTRY_CHARS);

  const [entry] = terminalEntries([
    run("1", "cat big.log", { stdout: body, stderr: "", exitCode: 0 }),
  ]);

  // The error of a failing command is at its end, so the cut is from the front.
  assert.ok(entry.stdout.length <= TERMINAL_ENTRY_CHARS);
  assert.ok(body.endsWith(entry.stdout));
  assert.equal(entry.omittedChars, body.length - entry.stdout.length);
  // Half a line at the top reads as corrupted output rather than as a cut.
  const firstLine = entry.stdout.split("\n")[0];
  assert.ok(
    body.includes(`\n${firstLine}\n`),
    "the first kept line is a whole line, not the tail of a cut one",
  );
  assert.equal(TERMINAL_ENTRY_CHARS, 8_000);
});

test("copying the panel yields the commands and what they printed", () => {
  const entries = terminalEntries([
    run("1", "npm test", { stdout: "out", stderr: "err", exitCode: 0 }),
    run("2", "true", { stdout: "", stderr: "", exitCode: 0 }),
  ]);

  assert.equal(terminalText(entries), "$ npm test\nout\nerr\n\n$ true");
});

test("only a state worth saying out loud gets a label", () => {
  assert.equal(terminalState("running"), "running");
  assert.equal(terminalState("failed"), "failed");
  assert.equal(terminalState("denied"), "denied");
  // Success and "nothing to claim" are silence: the row already shows the exit
  // code and the duration.
  assert.equal(terminalState("ok"), null);
  assert.equal(terminalState("unknown"), null);
});

test("every locale can label the command panel", async () => {
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
      "empty",
      "emptyHint",
      "count",
      "copyAll",
      "openInChat",
      "jump",
      "stderr",
      "exit",
      "running",
      "failed",
      "denied",
      "clipped",
    ]) {
      assert.match(
        source,
        new RegExp(`(?<!\\w)["']?${key}["']?\\s*:\\s*["\`][^"\`]+["\`]`),
        `${LOCALES[index]} is missing panel.terminal.${key}`,
      );
    }
    assert.match(
      source,
      /(?<!\w)["']?terminal["']?\s*:\s*"/,
      `${LOCALES[index]} is missing panel.tabs.terminal`,
    );
    // A placeholder translated into another name renders as literal braces.
    assert.match(
      source,
      /(?<!\w)["']?clipped["']?\s*:\s*["`][^"`]*\{\{chars\}\}/,
      `${LOCALES[index]} lost the {{chars}} placeholder in panel.terminal.clipped`,
    );
    assert.match(
      source,
      /(?<!\w)["']?exit["']?\s*:\s*["`][^"`]*\{\{code\}\}/,
      `${LOCALES[index]} lost the {{code}} placeholder in panel.terminal.exit`,
    );
    assert.match(
      source,
      /(?<!\w)["']?count["']?\s*:\s*["`][^"`]*\{\{commands\}\}/,
      `${LOCALES[index]} lost the {{commands}} placeholder in panel.terminal.count`,
    );
  }
});

test("the tab is wired into the panel without inventing a channel", async () => {
  const [tabs, workPanel, tab, css] = await Promise.all([
    read("src/lib/work-panel-tabs.ts"),
    read("src/components/workpanel/WorkPanel.tsx"),
    read("src/components/workpanel/TerminalTab.tsx"),
    read("src/styles/work-panel.css"),
  ]);

  assert.match(tabs, /tab\.kind === "terminal"/);
  assert.match(workPanel, /toolWorkPanelTab\("terminal"\)/);
  assert.match(workPanel, /activeTab\?\.kind === "terminal"/);
  // The panel is a projection of what the transcript already holds: no invoke,
  // no stream of its own, and nothing polled on a timer.
  assert.doesNotMatch(tab, /lib\/api/);
  assert.doesNotMatch(tab, /window\.api/);
  assert.doesNotMatch(tab, /setInterval/);

  const block = css.slice(
    css.indexOf("/* W-15:"),
    css.indexOf("@keyframes terminal-pulse"),
  );
  assert.ok(block.includes(".terminal-output {"));
  // Output is tool output, so it sits on the tool-row plate. The neighbouring
  // log panel references `--ds-surface`, which is defined nowhere and silently
  // resolves to nothing; this block must not inherit that mistake.
  assert.match(block, /background: var\(--ds-tool-row-bg\)/);
  assert.doesNotMatch(block, /--ds-surface/);
});
