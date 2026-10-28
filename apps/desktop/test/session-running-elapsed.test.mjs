import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const LOCALES = ["zh-CN", "zh-TW", "en", "de", "es", "fr", "ko", "tr"];

// W-09: a running session row shows how long it has been working, and only
// that row re-renders every second.
test("running session rows tick their own elapsed time", async () => {
  const [sidebar, elapsed] = await Promise.all([
    read("src/components/Sidebar.tsx"),
    read("src/components/SessionRunningElapsed.tsx"),
  ]);

  assert.match(sidebar, /\{running \? <SessionRunningElapsed \/> : null\}/);
  assert.match(elapsed, /window\.setInterval\(\(\) => setNow\(Date\.now\(\)\), 1000\)/);
  assert.match(elapsed, /return \(\) => window\.clearInterval\(id\)/);
  assert.match(elapsed, /formatToolDuration\(seconds\)/);
  assert.match(elapsed, /className="thread-item-elapsed"/);
});

// The new key must exist in every catalog; there is no parity test guarding
// this, so a missing translation would silently fall back to English.
test("every locale carries nav.sessionRunningFor", async () => {
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
    assert.match(
      source,
      /["']?sessionRunningFor["']?\s*:\s*"[^"]*\{\{time\}\}[^"]*"/,
      `${LOCALES[index]} is missing nav.sessionRunningFor`,
    );
  }
});
