import { readSettingsSource, readMainModule } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

/*
  Settings → 信息 shows what the build is, where logs live, and how updates
  arrive. It used to also carry a Report a problem action that opened a public
  issue tracker, which told end users where the source lived (D313, ADR 0157).
  The product now ships closed, so the intake is gone end to end and nothing in
  this panel may point at a repository again (D425).
*/

const settingsPageSource = await readSettingsSource();
const searchSource = await readFile(new URL("../src/lib/settings-search.ts", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8");
const protocolSource = await readFile(
  new URL("../../../packages/shared/src/protocol.ts", import.meta.url),
  "utf8",
);
const appIpcSource = await readMainModule("ipc/app-ipc.ts");

test("the info panel carries no feedback action", () => {
  assert.doesNotMatch(settingsPageSource, /settings\.feedback/);
  assert.doesNotMatch(settingsPageSource, /openFeedback/);
  // One action per row, and the row itself is what search indexes.
  assert.doesNotMatch(searchSource, /"settings\.feedback"/);
});

test("no layer still exposes a feedback channel", () => {
  assert.doesNotMatch(protocolSource, /appOpenFeedback/);
  assert.doesNotMatch(apiSource, /openFeedback/);
  // The main-process handler was the only caller of the guarded opener here.
  assert.doesNotMatch(appIpcSource, /buildBugReportUrl|assertFeedbackIssueUrl/);
  assert.doesNotMatch(appIpcSource, /safeOpenExternal/);
});

test("no locale still ships feedback copy", async () => {
  const locales = await readdir(new URL("../../../packages/i18n/src/locales", import.meta.url), {
    withFileTypes: true,
  });
  for (const locale of locales.filter((entry) => entry.isDirectory())) {
    const source = await readFile(
      new URL(`../../../packages/i18n/src/locales/${locale.name}/index.ts`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /^\s*["']?(feedback|feedbackDesc|openFeedback)["']?\s*:/m, locale.name);
  }
});
