import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [skin, tokens, composer, composerMenus, messages, workPanel, settings, markdown] =
  await Promise.all([
    read("../src/styles/app-background.css"),
    read("../src/styles/tokens.css"),
    read("../src/styles/composer.css"),
    read("../src/styles/composer-menus.css"),
    read("../src/styles/messages.css"),
    read("../src/styles/work-panel.css"),
    read("../src/styles/settings.css"),
    read("../src/components/Markdown.tsx"),
  ]);

test("window chrome stays out of the wallpaper skin", () => {
  // The titlebar and the window-controls band are overlays on top of the thread
  // scroller, and the transcript's top padding only clears them at offset zero.
  // A translucent plate there shows scrolled text through the bar.
  assert.doesNotMatch(
    skin,
    /:root \.main-titlebar\b|:root \.conversation-topbar\b|:root \.window-controls\b/,
  );
});

test("the card surface token is derived, not duplicated", () => {
  // One declaration that follows `--ds-bg-secondary` across themes: the light
  // block moves that token, and the card plate follows without a second literal.
  assert.match(tokens, /--ds-card-surface:\s*var\(--ds-bg-secondary\);/);
});

test("the decision cards carry their own opaque plate", () => {
  // Each of these used to be a 3.5%-10% wash that only read as a card because
  // the chat pane behind it was opaque. The wallpaper skin thins that pane.
  assert.match(
    composer,
    /\.plan-approval-bar \{[\s\S]*?background:\s*var\(--ds-card-surface\);/,
  );
  assert.match(
    composer,
    /\.plan-approval-split \{[\s\S]*?background:\s*var\(--ds-raised\);/,
  );
  assert.match(
    messages,
    /\.asktool-card \{[\s\S]*?background:\s*var\(--ds-card-surface\);/,
  );
  assert.match(
    messages,
    /\.permission-card \{[\s\S]*?background:\s*color-mix\(in oklab, var\(--ds-warning\) 10%, var\(--ds-card-surface\)\);/,
  );
  assert.match(
    messages,
    /\.permission-card\.risk-high \{[\s\S]*?var\(--ds-error\) 10%, var\(--ds-card-surface\)\)/,
  );
  assert.match(
    messages,
    /\.permission-card\.risk-low \{[\s\S]*?background:\s*var\(--ds-card-surface\);/,
  );
  assert.match(
    messages,
    /\.turn-outcome-card \{[\s\S]*?background:\s*var\(--ds-card-surface\);/,
  );
  assert.match(
    messages,
    /\.message-error \{[\s\S]*?var\(--ds-error\) 7%, var\(--ds-card-surface\)\)/,
  );
});

test("tool output is an opaque plate too", () => {
  // The tool output block is the densest content in the transcript, so it takes
  // the same treatment; the error variant tints the plate instead of floating.
  assert.match(tokens, /--ds-tool-row-bg:\s*var\(--ds-card-surface\);/);
  assert.equal(
    (tokens.match(/--ds-tool-row-bg:/g) ?? []).length,
    2,
    "--ds-tool-row-bg must be declared in both theme blocks",
  );
  assert.match(
    messages,
    /\.tool-row-content\.is-error \{[\s\S]*?var\(--ds-error\) 7%, var\(--ds-card-surface\)\)/,
  );
});

test("process containers stay washes by contract", () => {
  // These are pinned to the soft tile by transcript-style and subagent tests:
  // the opaque plate is reserved for the surfaces the user has to act on.
  assert.match(
    messages,
    /\.tool-activity-group\.has-subagents \{[\s\S]*?background:\s*var\(--ds-tile\);/,
  );
  assert.match(messages, /\.subagent-run \{[\s\S]*?background:\s*var\(--ds-tile\);/);
  assert.match(
    workPanel,
    /\.subagent-detail-task-card \{[\s\S]*?background:\s*var\(--ds-tile\);/,
  );
});

test("the composer row groups can give width back", () => {
  // The toolbar is nowrap and the model chip is its widest child, so a rigid
  // group keeps its content width and pushes the chip past the shell edge.
  assert.match(
    composer,
    /\.composer-left,\s*\.composer-right \{[\s\S]*?flex:\s*0 1 auto;[\s\S]*?min-width:\s*0;/,
  );
});

test("the model chip is capped against its container, not the viewport", () => {
  assert.match(
    composerMenus,
    /\.composer-right \.composer-model-thinking-chip \{\s*max-width:\s*min\(300px, 100%\);/,
  );
  assert.doesNotMatch(
    composerMenus,
    /\.composer-right \.composer-model-thinking-chip \{[^}]*calc\(100vw/,
  );
});

test("container-relative caps replace viewport caps in the approval card", () => {
  assert.match(composer, /\.plan-approval-artifact-path \{[\s\S]*?max-width:\s*min\(100%, 320px\);/);
  assert.doesNotMatch(
    composer,
    /\.plan-approval-artifact-path \{[\s\S]*?max-width:\s*min\([0-9]+vw/,
  );
});

test("the subagent detail row and badge cannot overflow the dock", () => {
  assert.match(
    workPanel,
    /\.subagent-detail-summary \{[\s\S]*?flex:\s*0 1 auto;[\s\S]*?min-width:\s*0;/,
  );
  assert.match(workPanel, /\.subagent-detail-badge \{[\s\S]*?max-width:\s*100%;[\s\S]*?overflow:\s*hidden;/);
});

test("the switch stands its motion down under reduced motion", () => {
  // The knob transition is a real positional move and the busy state pulses.
  assert.match(
    settings,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.settings-toggle-thumb \{\s*transition:\s*none;[\s\S]*?\.settings-toggle\.is-busy \.settings-toggle-thumb \{\s*animation:\s*none;/,
  );
  // The on-state offset is state, not motion, so it must survive.
  assert.match(settings, /\.settings-toggle\.on \.settings-toggle-thumb \{\s*transform:\s*translateX\(12px\);/);
});

test("inline chat images are reachable from the keyboard", () => {
  // Both clickable image branches used to be <img onClick> with no keyboard path.
  const remoteBranch = markdown.match(/className="chat-image-remote"[\s\S]*?\/>/)?.[0] ?? "";
  const localBranch = markdown.match(/className="chat-image-local"[\s\S]*?\/>/)?.[0] ?? "";
  assert.ok(remoteBranch, "the remote image branch must exist");
  assert.ok(localBranch, "the local image branch must exist");
  assert.match(remoteBranch, /role="button"/);
  assert.match(remoteBranch, /onKeyDown=/);
  assert.match(localBranch, /role=\{localRef \? "button" : undefined\}/);
  assert.match(localBranch, /onKeyDown=/);
});
