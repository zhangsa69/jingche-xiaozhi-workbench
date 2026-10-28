import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const readRepo = (path) =>
  readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

const LOCALES = ["zh-CN", "zh-TW", "en", "de", "es", "fr", "ko", "tr"];

// W-05: an approved contract's steps are structure, not a runtime counter.
// Both the list and the position are derived — the snapshot is the list, the
// `UpdateStep` rows are the position — so a restart, a second window and the
// sidebar cannot disagree.

test("the shared helpers own parsing and replay", async () => {
  const source = await readRepo("packages/shared/src/plan-steps.ts");

  assert.match(source, /export function parsePlanSteps/);
  assert.match(source, /export function planStepProgress/);
  assert.match(source, /export const PLAN_STEP_TOOL_NAME = "UpdateStep";/);
  // Checkboxes describe tasks; a numbered acceptance-criteria list must not be
  // mistaken for them, so the shapes are tried in order.
  assert.match(source, /CHECKBOX_STEP/);
  assert.match(source, /if \(steps\.length >= 2\) return steps;/);
  // Progress only counts rows that reported something.
  assert.match(source, /message\.toolStatus === "error" \|\| message\.toolStatus === "denied"/);
});

test("the runtime offers the marker only inside an approved execution", async () => {
  const runtime = await readRepo("packages/agent-runtime/src/runtime.ts");

  assert.match(
    runtime,
    /this\.autonomousExecution && this\.mode === "agent" && this\.planSteps\.length >= 2/,
  );
  assert.match(runtime, /name === PLAN_STEP_TOOL_NAME \|\|/);
  assert.match(runtime, /this\.planSteps = parsePlanSteps\(execution\.plan\);/);
  // The instruction carries the same numbering the bar renders.
  assert.match(runtime, /"<approved-steps>"/);
  assert.match(runtime, /this\.planSteps\.map\(\(step\) => `\$\{step\.index\}\. \$\{step\.title\}`\)/);
  // A normal prompt is not an execution: the contract leaves with it.
  assert.match(
    runtime,
    /if \(this\.planSteps\.length > 0\) \{\r?\n      this\.planSteps = \[\];\r?\n      this\.rebuildToolCatalog\(\);/,
  );
});

test("the bar sits above the rows it describes and survives a reading window", async () => {
  const transcript = await read("src/features/chat/transcript/ChatTranscript.tsx");

  const bar = transcript.indexOf("<PlanStepBar");
  assert.ok(bar > 0, "ChatTranscript must mount the step bar");
  assert.ok(
    bar < transcript.indexOf('className="thread-scroll"'),
    "the bar is a sibling above the scroller, so it never scrolls away",
  );
  assert.match(transcript, /!transcriptReadOnly && !readingWindow/);
});

test("the bar derives both halves and can locate a step", async () => {
  const bar = await read("src/components/PlanStepBar.tsx");

  assert.match(bar, /parsePlanSteps\(checkpoint\?\.markdown\)/);
  assert.match(bar, /planStepProgress\(steps, messages\)/);
  assert.match(bar, /isActivePlanExecution\(checkpoint\)/);
  // Before approval the plan card owns the steps; a single-step contract is not
  // a progress bar.
  assert.match(
    bar,
    /if \(!isActivePlanExecution\(checkpoint\) \|\| steps\.length < 2\) return null;/,
  );
  assert.match(bar, /\[data-message-id="\$\{CSS\.escape\(messageId\)\}"\]/);
  assert.match(bar, /aria-current=\{active \? "step" : undefined\}/);
});

test("the bar is styled with tokens", async () => {
  const css = await read("src/styles/chrome.css");
  const block = css.slice(
    css.indexOf(".plan-steps {"),
    css.indexOf(".plan-step-index"),
  );

  assert.ok(block.length > 0, "chrome.css must style the bar");
  assert.match(block, /border-bottom: 1px solid var\(--ds-border-subtle\)/);
  assert.doesNotMatch(block, /\b\d+px\b(?! solid)/);
});

test("every locale can say the position and the destination", async () => {
  const catalogs = await Promise.all(
    LOCALES.map((locale) =>
      readRepo(`packages/i18n/src/locales/${locale}/index.ts`),
    ),
  );

  for (const [index, source] of catalogs.entries()) {
    for (const [key, placeholders] of [
      ["stepsProgress", ["{{current}}", "{{total}}"]],
      ["stepsPending", ["{{total}}"]],
      ["stepsGoTo", ["{{step}}", "{{title}}"]],
    ]) {
      const line = source
        .split(/\r?\n/)
        .find((candidate) => new RegExp(`["']?${key}["']?\\s*:`).test(candidate));
      assert.ok(line, `${LOCALES[index]} is missing chat.${key}`);
      for (const placeholder of placeholders) {
        assert.ok(
          line.includes(placeholder),
          `${LOCALES[index]} chat.${key} needs ${placeholder}`,
        );
      }
    }
  }
});
