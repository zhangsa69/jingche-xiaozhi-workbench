import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  TASK_STATUS_LENS,
  TASK_STATUS_LENSES,
  taskStatusLamp,
} from "../src/lib/task-status-light.ts";
import { loadStyles } from "./helpers/styles.mjs";

/*
  The top bar carries a three-lens status lamp left of the overview button. The
  lamp is skeuomorphic on purpose — a metal bezel with three glass lenses — so
  the tests pin both the state machine and the physical cues (bezel gradient,
  specular highlight, halo on the lit lens) that make it read as hardware.
*/

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const topbarSource = await read("../src/components/ConversationTopbar.tsx");
const lampSource = await read("../src/components/TaskStatusLamps.tsx");
const styles = await loadStyles();

test("a parked permission outranks the run, which outranks a failed turn", () => {
  assert.equal(
    taskStatusLamp({ running: true, hasPendingPermission: true, failed: true }),
    "permission",
  );
  assert.equal(taskStatusLamp({ running: true, failed: true }), "running");
  assert.equal(taskStatusLamp({ running: false, failed: true }), "failed");
  assert.equal(taskStatusLamp({ running: false }), "idle");
});

test("each state lights exactly one lens, in stop / attention / go order", () => {
  assert.deepEqual([...TASK_STATUS_LENSES], ["red", "amber", "green"]);
  assert.deepEqual(TASK_STATUS_LENS, {
    failed: "red",
    idle: "green",
    permission: "amber",
    running: "amber",
  });
});

test("the lamp sits in the top bar left of the task overview button", () => {
  const actions = topbarSource.match(/<div className="ct-actions">([\s\S]*?)<\/div>/);
  assert.ok(actions, "ct-actions block");
  const block = actions[1];
  const lampIndex = block.indexOf("<TaskStatusLamps />");
  const overviewIndex = block.indexOf("<TaskOverviewPopover />");
  assert.ok(lampIndex >= 0, "the lamp is mounted");
  assert.ok(overviewIndex >= 0, "the overview button is mounted");
  assert.ok(lampIndex < overviewIndex, "the lamp leads the overview button");
  // Three lenses, one span each, and the state lives on the bezel.
  assert.match(lampSource, /TASK_STATUS_LENSES\.map/);
  assert.match(lampSource, /className="ct-status-lamps"/);
  assert.match(lampSource, /data-lamp=\{lamp\}/);
  assert.match(lampSource, /className=\{`ct-status-lamp \$\{lens\}`\}/);
  // The top bar itself still never subscribes to run state: the lamp owns it.
  assert.doesNotMatch(topbarSource, /runningSessions/);
});

test("the lamp labels itself through i18n, never a hard-coded string", () => {
  assert.match(lampSource, /const label = t\(LAMP_LABEL_KEYS\[lamp\]\)/);
  assert.match(lampSource, /aria-label=\{label\}/);
  assert.doesNotMatch(lampSource, /aria-label="[^"]*[\u4e00-\u9fa5]/);
});

test("the bezel and lenses keep their physical cues", () => {
  // Recessed metal: a lit top lip, a shadowed bottom lip, and a drop shadow.
  const bezel = styles.match(/\.ct-status-lamps \{[^}]*\}/)?.[0] ?? "";
  assert.match(bezel, /linear-gradient/);
  assert.match(bezel, /inset 0 1\.5px 0/);
  assert.match(bezel, /inset 0 -1\.5px 3px/);
  assert.match(bezel, /border-radius: var\(--radius-full\)/);
  // Glass: an unlit lens still holds a trace of its tint.
  const lens = styles.match(/\.ct-status-lamp \{[^}]*\}/)?.[0] ?? "";
  assert.match(lens, /radial-gradient/);
  assert.match(lens, /--lamp-tint/);
  // Specular streak across the top third.
  assert.match(styles, /\.ct-status-lamp::after \{[^}]*linear-gradient/s);
});

test("only the matching lens lights, and only it carries a halo", () => {
  const lit = [
    ["idle", "green"],
    ["running", "amber"],
    ["permission", "amber"],
    ["failed", "red"],
  ];
  for (const [state, lens] of lit) {
    assert.match(
      styles,
      new RegExp(`\\.ct-status-lamps\\[data-lamp="${state}"\\] \\.ct-status-lamp\\.${lens}`),
      `${state} lights ${lens}`,
    );
  }
  const litRule =
    styles.match(/\.ct-status-lamps\[data-lamp="failed"\] \.ct-status-lamp\.red \{[^}]*\}/)?.[0] ?? "";
  assert.match(litRule, /0 0 6px/);
  assert.match(litRule, /0 0 13\.5px/);
});

test("a parked prompt blinks, and the blink respects reduced motion", () => {
  assert.match(
    styles,
    /\.ct-status-lamps\[data-lamp="permission"\] \.ct-status-lamp\.amber \{[^}]*animation:/s,
  );
  assert.match(styles, /@keyframes ct-status-lamp-alert/);
  const reduceBlocks = [
    ...styles.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g),
  ].map((match) => match[1]);
  const lampBlock = reduceBlocks.find((block) => block.includes("ct-status-lamp"));
  assert.ok(lampBlock, "the lamp has a reduced-motion rule");
  assert.match(lampBlock, /animation: none/);
});

test("every locale names the idle, permission, and failed states", async () => {
  const locales = await readdir(new URL("../../../packages/i18n/src/locales", import.meta.url), {
    withFileTypes: true,
  });
  for (const locale of locales.filter((entry) => entry.isDirectory())) {
    const source = await read(`../../../packages/i18n/src/locales/${locale.name}/index.ts`);
    for (const key of ["sessionIdle", "sessionPermission", "sessionStatusFailed"]) {
      assert.match(source, new RegExp(`["']?${key}["']?\\s*:`), `${locale.name}:${key}`);
    }
  }
});
