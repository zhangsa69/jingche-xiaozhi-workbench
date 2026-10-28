import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseRepeatGuardQuestion,
  repeatGuardQuestion,
  resolveRepeatGuardDecision,
} from "../../../packages/shared/src/repeat-guard.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const LOCALES = ["zh-CN", "zh-TW", "en", "de", "es", "fr", "ko", "tr"];
const GUARD_KEYS = [
  "repeatGuardTitle",
  "repeatGuardQuestion",
  "repeatGuardContinue",
  "repeatGuardStop",
];

const [cardSource, ...locales] = await Promise.all([
  read("../src/components/AskToolCard.tsx"),
  ...LOCALES.map((locale) => read(`../../../packages/i18n/src/locales/${locale}/index.ts`)),
]);

test("the card only recognizes a guard question it can parse", () => {
  assert.deepEqual(parseRepeatGuardQuestion(repeatGuardQuestion({ toolName: "Edit", attempts: 3 })), {
    toolName: "Edit",
    attempts: 3,
  });
  assert.equal(parseRepeatGuardQuestion("Should I keep going?"), null);
  assert.equal(parseRepeatGuardQuestion("@@repeat-guard@@Edit"), null);
  assert.equal(parseRepeatGuardQuestion("@@repeat-guard@@|3"), null);
});

test("only an explicit continue keeps the loop alive", () => {
  assert.equal(resolveRepeatGuardDecision([["continue"]]), "continue");
  assert.equal(resolveRepeatGuardDecision([["stop"]]), "stop");
  assert.equal(resolveRepeatGuardDecision([[null]]), "stop");
  assert.equal(resolveRepeatGuardDecision(null), "stop");
  assert.equal(resolveRepeatGuardDecision(undefined), "stop");
});

test("the guard takes over the card instead of being one more question", () => {
  assert.match(cardSource, /import \{ parseRepeatGuardQuestion, type AskToolQuestion \}/);
  assert.match(cardSource, /const guard = parseRepeatGuardQuestion\(current\.question\)/);
  // The model's sentence never reaches the user; the locale supplies it.
  assert.match(cardSource, /t\("askTool\.repeatGuardQuestion", \{\s*tool: guard\.toolName,\s*count: guard\.attempts,?\s*\}\)/);
  assert.match(cardSource, /t\("askTool\.repeatGuardTitle"\)/);
  // Progress, indicators, decline-all, skip, and the custom answer are noise
  // when there is exactly one decision to make.
  assert.match(cardSource, /\{guard \? null : \(\s*<div className="asktool-card-progress">/);
  assert.match(cardSource, /\{guard \? null : \(\s*<div className="asktool-indicators"/);
  assert.match(cardSource, /\{guard \? null : \(\s*<button\s*type="button"\s*className="asktool-decline"/);
  assert.match(cardSource, /\{guard \? null : \(\s*<button\s*type="button"\s*className=\{`asktool-option asktool-custom-option/);
  assert.match(cardSource, /\{guard \? null : \(\s*<div className="asktool-card-actions">/);
});

test("one click on a guard option is the whole decision", () => {
  assert.match(cardSource, /const decideGuard = \(decision: string\) => \{\s*void submit\(/);
  assert.match(
    cardSource,
    /request\.questions\.map\(\(_, questionIndex\) =>\s*questionIndex === index \? \[decision\] : null,?\s*\)/,
  );
  assert.match(cardSource, /onClick=\{\(\) => \(guard \? decideGuard\(option\) : selectOption\(option\)\)\}/);
  // Selecting a guard option must not wait for a separate submit button.
  assert.match(cardSource, /option === "continue"\s*\?\s*t\("askTool\.repeatGuardContinue"\)/);
  assert.match(cardSource, /option === "stop"\s*\?\s*t\("askTool\.repeatGuardStop"\)/);
});

test("every locale can carry the guard question", () => {
  locales.forEach((source, index) => {
    for (const key of GUARD_KEYS) {
      assert.match(
        source,
        // Some catalogs quote their keys and others do not.
        new RegExp(`(?<!\\w)["']?${key}["']?:`),
        `packages/i18n/src/locales/${LOCALES[index]}/index.ts is missing askTool.${key}`,
      );
    }
    assert.match(
      source,
      /\{\{tool\}\}/,
      `packages/i18n/src/locales/${LOCALES[index]}/index.ts must interpolate the tool name`,
    );
    assert.match(
      source,
      /\{\{count\}\}/,
      `packages/i18n/src/locales/${LOCALES[index]}/index.ts must interpolate the attempt count`,
    );
  });
});
