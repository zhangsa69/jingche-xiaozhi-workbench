import { readComposerSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const composerSource = await readComposerSource();
const styles = await loadStyles();

function ruleBlock(source, selector) {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing ${selector} rule`);
  // Prefer the layout rule (height: 28px) when color-only overrides exist first.
  let idx = start;
  while (idx !== -1) {
    const open = source.indexOf("{", idx);
    const close = source.indexOf("}", open);
    const block = source.slice(idx, close + 1);
    if (block.includes("height: 28px")) return block;
    idx = source.indexOf(`${selector} {`, close + 1);
  }
  throw new Error(`no 28px layout rule for ${selector}`);
}

test("model chip label avoids leading-none under truncation", () => {
  assert.match(composerSource, /className="composer-model-thinking-model"/);
  assert.doesNotMatch(
    composerSource,
    /composer-model-thinking-model[^"]*leading-none|truncate text-sm leading-none/,
  );
});

test("model menu options show one complete display name on hover", () => {
  assert.match(
    composerSource,
    /const optionTitle =\s*model\.displayName \|\| model\.modelId;/,
  );
  assert.match(composerSource, /title=\{optionTitle\}/);
  const optionBlock =
    composerSource.match(/const optionTitle[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.doesNotMatch(optionBlock, /max-w-\[170px\]|font-mono text-text-secondary/);
});

test("composer runtime chips keep compact line-height for descenders", () => {
  for (const selector of [".mode-chip"]) {
    const block = ruleBlock(styles, selector);
    assert.match(block, /line-height:\s*var\(--leading-compact\);/);
    assert.match(block, /overflow:\s*visible;/);
  }

  assert.match(
    styles,
    /\.composer-model-thinking-chip\s*\{[\s\S]*?line-height:\s*var\(--leading-compact\);/,
  );
  assert.match(
    styles,
    /\.composer-model-thinking-model,\s*\.composer-model-thinking-level\s*\{[\s\S]*?text-overflow:\s*ellipsis;/,
  );
});

test("mode switch shows all four modes behind one sliding glider", () => {
  assert.match(composerSource, /<ComposerModeSwitch/);
  assert.match(composerSource, /role="radiogroup"/);
  assert.match(composerSource, /MODE_CYCLE\.map/);
  assert.match(composerSource, /className="mode-switch-glider"/);

  const block = styles.match(/\.mode-switch-glider\s*\{[^}]+\}/)?.[0] ?? "";
  assert.match(block, /width:\s*calc\(\(100% - 4px\) \/ 4\);/);
  assert.match(
    block,
    /transform:\s*translateX\(calc\(var\(--mode-switch-index, 0\) \* 100%\)\);/,
  );
  // Labels fold to icons first, before the row could need to wrap.
  assert.match(
    styles,
    /@container composer-stack \(max-width: 660px\)[\s\S]*?\.mode-switch-label\s*\{\s*display:\s*none;/,
  );
});

test("mode switch pulses while planning is live and respects reduced motion", () => {
  assert.match(composerSource, /data-planning=\{planningLive \? "true" : undefined\}/);
  assert.match(
    styles,
    /\.mode-switch\[data-planning="true"\] \.mode-switch-option\[aria-checked="true"\] svg\s*\{[\s\S]*?animation:\s*composer-mode-planning-pulse/,
  );
  assert.match(styles, /prefers-reduced-motion:\s*reduce[\s\S]*?\.mode-switch-glider,/);
});

test("the toolbar wraps before the action row can leave the shell", () => {
  const toolbar = styles.match(/\.composer-toolbar\s*\{[^}]+\}/)?.[0] ?? "";
  assert.match(toolbar, /flex-wrap:\s*wrap;/);
  assert.match(styles, /\.composer-right\s*\{\s*margin-left:\s*auto;/);
  // The widest readouts drop before the row would wrap at common pane widths.
  assert.match(
    styles,
    /@container composer-stack \(max-width: 810px\)[\s\S]*?\.context-inspector-ring-value/,
  );
  // Above the label breakpoint the row is pinned to one line.
  assert.match(
    styles,
    /@container composer-stack \(min-width: 661px\)\s*\{\s*\.composer-toolbar\s*\{\s*flex-wrap:\s*nowrap;/,
  );
});

test("ask and agent carry green and blue tints without a halo", () => {
  assert.match(styles, /--ds-mode-ask:\s*#7ee7a8;/);
  assert.match(styles, /--ds-mode-agent:\s*#7cc8ff;/);
  assert.match(
    styles,
    /\.mode-switch\[data-mode="read-only"\]\s*\{\s*--mode-switch-tint:\s*var\(--ds-mode-ask\);/,
  );
  assert.match(
    styles,
    /\.mode-switch\[data-mode="agent"\]\s*\{\s*--mode-switch-tint:\s*var\(--ds-mode-agent\);/,
  );
  // Glassy fill only: no coloured halo and no glowing icon (matches the reference).
  const glider = styles.match(/\.mode-switch-glider\s*\{[^}]*\}/)?.[0] ?? "";
  assert.doesNotMatch(glider, /0 0 1[0-9]px|0 0 2[0-9]px/);
  assert.doesNotMatch(
    styles,
    /\.mode-switch-option\[aria-checked="true"\] svg\s*\{[^}]*drop-shadow/,
  );
});

test("each mode segment is wide enough for the longest localized label", () => {
  const option = styles.match(/\.mode-switch-option\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(option, /width:\s*76px;/);
  assert.match(option, /font-size:\s*var\(--text-sm\);/);
  // The glider still divides the widened track into four equal keys.
  assert.match(
    styles,
    /\.mode-switch-glider\s*\{[^}]*width:\s*calc\(\(100% - 4px\) \/ 4\);/s,
  );
});
