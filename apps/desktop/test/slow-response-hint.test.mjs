import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const LOCALES = ["zh-CN", "zh-TW", "en", "de", "es", "fr", "ko", "tr"];

// W-08: a long wait for the first event escalates in three rungs instead of
// repeating one line forever. The ladder is a pure function, so the thresholds
// live in one place and cannot drift from the copy they select.

test("the silence ladder has three rungs and never steps back", async () => {
  const ladder = await read("src/features/chat/transcript/silence-ladder.ts");

  assert.match(ladder, /export const SILENCE_RUNGS = \[20, 45, 120\] as const;/);
  assert.match(ladder, /if \(seconds >= SILENCE_RUNGS\[2\]\) return 3;/);
  assert.match(ladder, /if \(seconds >= SILENCE_RUNGS\[1\]\) return 2;/);
  assert.match(ladder, /if \(seconds >= SILENCE_RUNGS\[0\]\) return 1;/);
  assert.match(ladder, /return 0;/);
  // A value that is not a number must not silence the rung.
  assert.match(ladder, /Number\.isFinite\(elapsedSeconds\)/);
  assert.match(
    ladder,
    /SILENCE_HINT_KEYS = \[[\s\S]{0,240}"chat\.stalledResponseHint",[\s\S]{0,20}\] as const/,
  );
});

test("the working indicator speaks the current rung only", async () => {
  const [group, styles] = await Promise.all([
    read("src/features/chat/transcript/ActivityGroup.tsx"),
    read("src/styles/messages.css"),
  ]);

  assert.match(group, /const level = silenceLevel\(elapsed\);/);
  assert.match(group, /data-silence=\{level\}/);
  assert.match(group, /t\(SILENCE_HINT_KEYS\[level - 1\], \{/);
  assert.match(group, /defaultValue: SILENCE_HINT_FALLBACKS\[level - 1\]/);
  assert.match(group, /className="working-indicator-hint"/);
  // The hint must stay inside the polite live region, not fight it.
  assert.match(group, /role="status"[\s\S]{0,600}SILENCE_HINT_KEYS/);

  assert.match(styles, /\.working-indicator\.is-slow \{/);
  assert.match(styles, /\.working-indicator-hint \{/);
  // The last rung is the one that has to be noticed.
  assert.match(styles, /\.working-indicator\[data-silence="3"\] \.working-indicator-hint \{/);
});

test("every locale carries all three silence hints", async () => {
  const catalogs = await Promise.all(
    LOCALES.map((locale) =>
      readFile(
        new URL(
          `../../../packages/i18n/src/locales/${locale}/index.ts`,
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );

  for (const [index, source] of catalogs.entries()) {
    for (const key of [
      "slowResponseHint",
      "verySlowResponseHint",
      "stalledResponseHint",
    ]) {
      assert.match(
        source,
        new RegExp(`["']?${key}["']?\\s*:\\s*"[^"]{10,}"`),
        `${LOCALES[index]} is missing chat.${key}`,
      );
    }
  }
});
