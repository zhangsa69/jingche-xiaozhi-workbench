import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// W-10: the sidebar shows the same position the transcript bar shows. It is a
// second consumer of one derived value, never a second counter.

test("a running session row mounts the step badge", async () => {
  const sidebar = await read("src/components/Sidebar.tsx");

  assert.match(sidebar, /import \{ SessionPlanProgress \} from "\.\/SessionPlanProgress";/);
  assert.match(sidebar, /<SessionPlanProgress sessionId=\{session\.id\} \/>/);
});

test("the badge derives steps and position from the shared helpers", async () => {
  const badge = await read("src/components/SessionPlanProgress.tsx");

  assert.match(badge, /parsePlanSteps\(checkpoint\?\.markdown\)/);
  assert.match(badge, /planStepProgress\(steps, messages\)/);
  assert.match(badge, /isActivePlanExecution\(checkpoint\)/);
  assert.match(badge, /state\.runningSessions\[sessionId\] === true/);
  // Only a running row replays the transcript; idle rows stay free.
  assert.match(
    badge,
    /return running \? <RunningPlanProgress sessionId=\{sessionId\} \/> : null;/,
  );
  // A session the window never painted has no transcript: no `0/8` guesses.
  assert.match(badge, /messages \? planStepProgress\(steps, messages\) : null/);
  assert.match(badge, /if \(!progress \|\| !isActivePlanExecution\(checkpoint\) \|\| steps\.length < 2\)/);
  // The active transcript is live; a retained pane holds that session's last
  // painted rows.
  assert.match(badge, /state\.activeSessionId === sessionId/);
  assert.match(badge, /state\.retainedTranscripts\[sessionId\]/);
  assert.match(badge, /\{progress\.current\}\/\{progress\.total\}/);
});

test("the badge speaks the transcript's own words", async () => {
  const badge = await read("src/components/SessionPlanProgress.tsx");

  assert.match(badge, /t\("chat\.stepsProgress", \{/);
  assert.match(badge, /t\("chat\.stepsPending", \{ total: progress\.total \}\)/);
  assert.match(badge, /className="thread-item-steps"/);
});

test("the badge is styled with tokens", async () => {
  const css = await read("src/styles/sidebar-threads.css");
  const match = css.match(/\.thread-item-steps \{([^}]*)\}/);

  assert.ok(match, "sidebar-threads.css must style the step badge");
  assert.match(match[1], /color: var\(--ds-text-muted\)/);
  assert.match(match[1], /font-size: var\(--text-xs\)/);
  assert.match(match[1], /font-variant-numeric: tabular-nums/);
  assert.doesNotMatch(match[1], /\b\d+px\b/);
});
