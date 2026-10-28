import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(here, relative), "utf8");

const shared = read("../../../packages/shared/src/context-reference.ts");
const trigger = read("../../../packages/shared/src/composer-trigger.ts");
const autocomplete = read("../src/hooks/use-composer-autocomplete.ts");
const menu = read("../src/components/ComposerAutocomplete.tsx");
const composer = read("../src/components/Composer.tsx");
const submit = read("../src/features/chat/composer/hooks/useComposerSubmit.ts");

const LOCALES = ["en", "de", "es", "fr", "ko", "tr", "zh-CN", "zh-TW"];
const KEYS = ["contextRefMenu", "contextRefEmpty", "contextRefMessages"];

test("`#` opens the reference menu with the same boundaries as `@`", () => {
  assert.match(trigger, /mode: "context"/);
  assert.match(trigger, /token\.startsWith\("#"\) && isBoundary\(value, start\)/);
  assert.match(trigger, /export type ComposerTriggerMode = "slash" \| "file" \| "context";/);
});

test("references come from the session list, not from a new IPC", () => {
  assert.match(autocomplete, /contextReferenceCandidates\(sessions, trigger\.query, \{/);
  assert.match(autocomplete, /excludeId: activeSessionId/);
  assert.doesNotMatch(autocomplete, /invoke\(\s*["'](session|context)\./);
});

test("a token is inserted as visible, editable text", () => {
  assert.match(autocomplete, /contextReferenceToken\(item\.session\.title\)/);
  assert.match(menu, /#\{item\.session\.title\}/);
});

test("what is sent is quoted, capped, and labelled as an excerpt", () => {
  assert.match(shared, /export const MAX_CONTEXT_REFERENCES = 6;/);
  assert.match(shared, /export const MAX_CONTEXT_EXCERPT_CHARS = 300;/);
  assert.match(shared, /export const MAX_CONTEXT_BLOCK_CHARS = 1_200;/);
  assert.match(shared, /not as summaries/);
});

test("an unknown title is dropped, never fuzzy-matched", () => {
  assert.match(shared, /if \(!session \|\| seen\.has\(session\.id\)\) continue;/);
  assert.match(shared, /const resolvable = new Set\(titles\.map\(normalize\)\)/);
});

test("the composer decorates at the store boundary, leaving the submit path intact", () => {
  assert.match(composer, /findContextReferences\(text, contextReferenceSessions, \{/);
  assert.match(composer, /buildContextReferenceBlock\(withExcerpts\)/);
  assert.match(
    composer,
    /sendPromptRaw\(contextReferences\.decorate\(content\), draft, sessionId\)/,
  );
  // Restore, clear and measurement still see exactly what the user typed.
  assert.doesNotMatch(submit, /contextReferences/);
  assert.doesNotMatch(submit, /decorate\(/);
});

test("the prompt library keeps the user's words, not reference syntax", () => {
  assert.match(
    composer,
    /onAcceptedPrompt: \(text: string\) => promptLibrary\.remember\(stripContextReferences\(text\)\)/,
  );
});

test("the quoted excerpt is the transcript tail already in memory", () => {
  assert.match(composer, /retainedTranscripts\[ref\.id\] \?\? \[\]/);
  assert.match(composer, /message\.role === "assistant" && message\.content\.trim\(\)/);
});

test("the reference menu is labelled in all eight locales", () => {
  for (const locale of LOCALES) {
    const source = read(`../../../packages/i18n/src/locales/${locale}/index.ts`);
    for (const key of KEYS) {
      assert.ok(new RegExp(`"?${key}"?:`).test(source), `${locale} is missing chat.${key}`);
    }
  }
});
