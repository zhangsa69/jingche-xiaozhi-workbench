import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(here, relative), "utf8");

const sheet = read("../src/components/PromptLibrarySheet.tsx");
const hook = read("../src/hooks/use-prompt-library.ts");
const store = read("../src/lib/prompt-library-store.ts");
const shared = read("../../../packages/shared/src/prompt-library.ts");
const composer = read("../src/components/Composer.tsx");
const input = read("../src/features/chat/composer/ComposerInput.tsx");
const toolbar = read("../src/features/chat/composer/ComposerToolbar.tsx");
const submit = read("../src/features/chat/composer/hooks/useComposerSubmit.ts");
const css = read("../src/styles/prompt-library.css");
const globals = read("../src/styles/globals.css");

const LOCALES = ["en", "de", "es", "fr", "ko", "tr", "zh-CN", "zh-TW"];
const KEYS = [
  "title",
  "count",
  "searchPlaceholder",
  "filterAll",
  "empty",
  "emptyHint",
  "noResults",
  "uses",
  "pin",
  "unpin",
  "editTags",
  "remove",
  "tagsLabel",
  "tagsPlaceholder",
  "recallHint",
];

test("the library is plain data with one source of truth in shared", () => {
  assert.match(shared, /export type PromptLibraryEntry = \{/);
  assert.match(shared, /export function recordPromptUsage\(/);
  assert.match(shared, /export function matchPrompts\(/);
  assert.match(shared, /export function promptLibraryStatus\(/);
  assert.match(shared, /export function recallPrompt\(/);
  assert.match(shared, /export function parsePromptLibrary\(/);
  // The renderer must not re-implement sorting or dedupe for its own copy.
  assert.match(hook, /from "@pi-desktop\/shared"/);
  assert.match(hook, /matchPrompts\(/);
  assert.match(sheet, /from "@pi-desktop\/shared"/);
});

test("slash commands never become recallable prompt text", () => {
  assert.match(shared, /!normalized\.startsWith\("\/"\)/);
});

test("pins outrank recency in the list but not in the recall walk", () => {
  assert.match(shared, /left\.pinned !== right\.pinned/);
  assert.match(
    shared,
    /export function promptRecallHistory[\s\S]*?\.sort\(\(left, right\) => right\.lastUsedAt - left\.lastUsedAt\)/,
  );
});

test("the library is stored locally under its own key", () => {
  assert.match(store, /pi\.desktop\.promptLibrary/);
  assert.match(store, /localStorage\.getItem\(PROMPT_LIBRARY_STORAGE_KEY\)/);
  assert.match(store, /parsePromptLibrary\(JSON\.parse\(raw\)\)/);
  // A corrupt or blocked write is not allowed to take the composer down.
  assert.match(store, /catch \{/);
  assert.doesNotMatch(sheet, /localStorage/);
});

test("only accepted sends are recorded, using the visible text", () => {
  assert.match(
    submit,
    /stripInlineComposerFileReferenceTokens\(text, activeFileReferences\)/,
  );
  assert.match(submit, /if \(accepted && typeof onAcceptedPrompt === "function"\)/);
  assert.match(composer, /onAcceptedPrompt: promptLibrary\.remember/);
  // The chip sentinels must never be what the library remembers.
  assert.doesNotMatch(submit, /onAcceptedPrompt\?\.\(inlineContent\)/);
});

test("ArrowUp recalls only from an empty box and yields to the caret otherwise", () => {
  assert.match(
    input,
    /event\.key === "ArrowUp" &&[\s\S]*?!event\.shiftKey[\s\S]*?!value\.trim\(\)/,
  );
  assert.match(input, /onRecallPrompt\?\.\(\)/);
  // Autocomplete still owns ArrowUp while its menu is open.
  const acBlock = input.indexOf("if (composerAc.hasItems)");
  const recallBlock = input.indexOf("event.key === \"ArrowUp\" &&");
  assert.ok(acBlock >= 0 && recallBlock > acBlock);
  assert.match(composer, /promptLibrary\.recall\(value\)/);
  assert.match(composer, /promptLibrary\.resetRecall\(\)/);
});

test("recall refuses to resume after the draft was edited", () => {
  assert.match(shared, /if \(editable && anchorIndex === -1\) return null;/);
  assert.match(shared, /if \(editable && cursor\.anchor !== cursor\.text\) return null;/);
});

test("the panel uses real controls and inserts through the store prefill channel", () => {
  assert.match(sheet, /<input/);
  assert.match(sheet, /<button/);
  assert.match(sheet, /<form/);
  assert.match(sheet, /aria-pressed=\{entry\.pinned\}/);
  assert.match(sheet, /aria-label=\{t\("promptLibrary\.searchPlaceholder"\)\}/);
  assert.doesNotMatch(sheet, /<div[^>]*role="button"/);
  assert.match(hook, /useAppStore\.getState\(\)\.appendComposerDraftText\(text\)/);
  assert.match(toolbar, /<PromptLibrarySheet t=\{t\} controller=\{promptLibrary\} \/>/);
});

test("the panel is reachable from the composer toolbar", () => {
  assert.match(sheet, /trigger=\{\(ref\) => \(/);
  assert.match(sheet, /aria-haspopup="dialog"/);
  assert.match(sheet, /onClick=\{controller\.toggleOpen\}/);
  assert.match(toolbar, /promptLibrary: PromptLibraryController/);
  assert.match(globals, /@import "\.\/prompt-library\.css";/);
});

test("eight locales carry the same prompt library keys and placeholders", () => {
  for (const locale of LOCALES) {
    const source = read(`../../../packages/i18n/src/locales/${locale}/index.ts`);
    const section = source.match(/"?promptLibrary"?:\s*\{([\s\S]*?)\n  \},/);
    assert.ok(section, `${locale} is missing promptLibrary`);
    for (const key of KEYS) {
      assert.match(
        section[1],
        new RegExp(`"?${key}"?:\\s*"`),
        `${locale} is missing promptLibrary.${key}`,
      );
    }
    for (const placeholder of ["{{count}}"]) {
      const body = section[1];
      assert.ok(
        body.includes(placeholder),
        `${locale} is missing ${placeholder} in promptLibrary`,
      );
    }
  }
});

test("the panel styles stay on design tokens", () => {
  assert.match(css, /var\(--ds-text-primary\)/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(css, /font-size:\s*\d/);
  assert.doesNotMatch(css, /border-radius:\s*\d/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
