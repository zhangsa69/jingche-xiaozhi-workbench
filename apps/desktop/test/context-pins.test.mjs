import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(here, relative), "utf8");

const shared = read("../../../packages/shared/src/context-pins.ts");
const sheet = read("../src/components/ContextPickerSheet.tsx");
const composer = read("../src/components/Composer.tsx");
const toolbar = read("../src/features/chat/composer/ComposerToolbar.tsx");
const css = read("../src/styles/context-pins.css");
const globals = read("../src/styles/globals.css");
const submit = read("../src/features/chat/composer/hooks/useComposerSubmit.ts");

const LOCALES = ["en", "de", "es", "fr", "ko", "tr", "zh-CN", "zh-TW"];
const KEYS = ["title", "open", "hint", "budget", "empty", "selected", "clear", "role"];

test("the picker quotes turns instead of summarising them", () => {
  assert.match(shared, /export const MAX_CONTEXT_PINS = 8;/);
  assert.match(shared, /export const MAX_CONTEXT_PIN_CHARS = 1_600;/);
  assert.match(shared, /They are quoted verbatim/);
  // A block built from a summary would be a claim the user never made.
  assert.match(shared, /> \$\{pin\.role\}: \$\{collapse\(pin\.text\)\}/);
});

test("ticks resolve in transcript order and never exceed the budget", () => {
  assert.match(shared, /for \(const candidate of candidates\) \{/);
  assert.match(shared, /pins\.length >= limit \|\| spent \+ candidate\.chars > budget/);
  // An id that is no longer in the transcript is skipped, not substituted.
  assert.match(shared, /if \(!wanted\.has\(candidate\.id\)\) continue;/);
});

test("tool payloads are not pinnable turns", () => {
  assert.match(composer, /message\.role !== "tool"/);
});

test("pins are sent as a block, not merged into the draft", () => {
  assert.match(composer, /buildContextPinBlock\(pinSelection\.pins\)/);
  assert.match(composer, /\$\{content\}\\n\\n\$\{pinBlock\}/);
  // The submit path still sees exactly what the user typed.
  assert.doesNotMatch(submit, /contextPin|buildContextPinBlock/);
});

test("a delivered pin is cleared so it is not resent silently", () => {
  assert.match(composer, /if \(accepted\) setPinnedIds\(\[\]\);/);
});

test("switching sessions drops ticks from the other transcript", () => {
  assert.match(composer, /\}, \[activeSessionId\]\);/);
});

test("the picker is reachable from the composer toolbar", () => {
  assert.match(toolbar, /<ContextPickerSheet t=\{t\} controller=\{contextPicker\} \/>/);
  assert.match(toolbar, /contextPicker: ContextPickerController/);
  // A tick list, not a text field: the rows are buttons with checkbox semantics.
  assert.match(sheet, /role="checkbox"/);
  assert.match(sheet, /aria-checked=\{checked\}/);
  assert.match(globals, /@import "\.\/context-pins\.css";/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
});

test("the docked surface is fixed and gated until it is measured", () => {
  const composerMenus = read("../src/styles/composer-menus.css");
  /*
    AnchoredMenu portals the surface to <body>, so it leaves the flow of a
    100%-tall `#root` inside a clipping body. Without `position: fixed` it
    lands below the window and the click reads as doing nothing — which is
    exactly what shipped before the shared base existed.
  */
  const base = composerMenus.match(/\.composer-menu \{([^}]*)\}/);
  assert.ok(base, "composer-menus.css defines the shared .composer-menu base");
  assert.match(base[1], /position: fixed;/);
  assert.match(base[1], /visibility: hidden;/);
  assert.match(
    composerMenus,
    /\.composer-menu\.is-open \{[^}]*visibility: visible;/,
  );
  // Both composer-docked sheets ride on that one base.
  assert.match(sheet, /menuClassName="composer-menu context-pins-menu"/);
  assert.match(
    read("../src/components/PromptLibrarySheet.tsx"),
    /menuClassName="composer-menu prompt-library-menu"/,
  );
});

test("the tick reads as a checkbox, not a radio dot", () => {
  // A 14px box with the 8px radius step clamps to 7px and renders as a filled
  // circle, which tells the user only one row can be picked.
  assert.match(css, /\.context-pins-box \{[^}]*border-radius: var\(--radius-3xs\);/);
  assert.match(sheet, /role="checkbox"/);
});

test("the picker speaks all eight locales", () => {
  for (const locale of LOCALES) {
    const source = read(`../../../packages/i18n/src/locales/${locale}/index.ts`);
    assert.ok(/"?contextPins"?:/.test(source), `${locale} has no contextPins section`);
    for (const key of KEYS) {
      assert.ok(
        new RegExp(`"?${key}"?:`).test(source),
        `${locale} is missing contextPins.${key}`,
      );
    }
  }
});
