import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

// W-02: one wall clock per reply, counting while it runs and frozen after it
// settles. The value is whole-turn time, not provider streaming time.
test("each reply shows a duration that ticks while streaming and freezes when done", async () => {
  const [shared, turn] = await Promise.all([
    read("src/features/chat/transcript/shared.tsx"),
    read("src/features/chat/transcript/AssistantTurn.tsx"),
  ]);

  assert.match(shared, /durationMs\?: number/);
  assert.match(shared, /live\?: boolean/);
  assert.match(shared, /chat\.processingFor/);
  assert.match(shared, /chat\.processedFor/);
  assert.match(shared, /message-meta\$\{live \? " is-live" : ""\}/);
  assert.match(shared, /formatToolDuration\(Math\.floor\(durationMs \/ 1000\)\)/);

  assert.match(turn, /const \[finishedAt, setFinishedAt\] = useState<number \| null>\(null\)/);
  assert.match(turn, /window\.setInterval\(\(\) => setNow\(Date\.now\(\)\), 1000\)/);
  assert.match(turn, /if \(wasActiveRef\.current && !isActive\) setFinishedAt\(Date\.now\(\)\)/);
  // The live branch and the frozen branch both feed the same field.
  assert.match(turn, /durationMs=\{turnDurationMs\}\s+live/);
  assert.match(turn, /durationMs=\{turnDurationMs\}\s*\/>/);
  // A reloaded turn still reconstructs an end instead of dropping the value.
  assert.match(turn, /lastCreated \+ \(last\.responseDurationMs \?\? 0\)/);
});

// W-07: every tool row in a multi-call group carries its ordinal and its own
// single-step duration; a group with one call shows no ordinal.
test("tool rows carry an ordinal and a single-step duration", async () => {
  const [toolRow, activityGroup, styles] = await Promise.all([
    read("src/features/chat/transcript/ToolRow.tsx"),
    read("src/features/chat/transcript/ActivityGroup.tsx"),
    read("src/styles/messages.css"),
  ]);

  assert.match(toolRow, /stepIndex\?: number/);
  assert.match(toolRow, /className="tool-row-step"/);
  assert.match(toolRow, /\{stepIndex\}/);
  assert.match(toolRow, /className=\{`tool-row-duration/);
  assert.match(toolRow, /message\.toolDurationMs \?\?/);
  assert.match(toolRow, /const ticking = outcome === "running" \|\| status === "running"/);

  assert.match(activityGroup, /const toolTotal = items\.filter\(\(item\) => item\.kind === "tool"\)\.length/);
  assert.match(activityGroup, /toolTotal > 1/);
  assert.match(activityGroup, /stepIndex = toolStep/);

  assert.match(styles, /\.tool-row-step \{/);
  assert.match(styles, /\.tool-row-duration \{/);
  assert.match(styles, /\.tool-row-duration\.is-live \{/);
});
