import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PRIVACY_ROWS } from "../src/lib/privacy-manifest.ts";
import { SETTINGS_NAV } from "../src/lib/settings-search.ts";
import { en } from "../../../packages/i18n/src/locales/en/index.ts";
import { de } from "../../../packages/i18n/src/locales/de/index.ts";
import { es } from "../../../packages/i18n/src/locales/es/index.ts";
import { fr } from "../../../packages/i18n/src/locales/fr/index.ts";
import { ko } from "../../../packages/i18n/src/locales/ko/index.ts";
import { tr } from "../../../packages/i18n/src/locales/tr/index.ts";
import { zhCN } from "../../../packages/i18n/src/locales/zh-CN/index.ts";
import { zhTW } from "../../../packages/i18n/src/locales/zh-TW/index.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function flatten(value, prefix = "", out = {}) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") out[path] = child;
    else if (child && typeof child === "object") flatten(child, path, out);
  }
  return out;
}

const catalogs = { en, "zh-CN": zhCN, "zh-TW": zhTW, de, es, fr, ko, tr };
const english = flatten(en);

test("the privacy table declares every row once, in screen order", () => {
  assert.deepEqual(
    PRIVACY_ROWS.map((row) => row.id),
    ["prompt", "tools", "files", "credentials", "usage", "telemetry"],
  );

  const ids = PRIVACY_ROWS.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length, "row ids must be unique");
});

test("each row names three distinct settings keys in the same namespace", () => {
  for (const row of PRIVACY_ROWS) {
    assert.equal(row.topicKey, `settings.privacyTopic.${row.id}`, row.id);
    assert.equal(row.upstreamKey, `settings.privacyUpstream.${row.id}`, row.id);
    assert.equal(row.localKey, `settings.privacyLocal.${row.id}`, row.id);
    assert.equal(
      new Set([row.topicKey, row.upstreamKey, row.localKey]).size,
      3,
      `${row.id} must not reuse one key for both columns`,
    );
  }
});

test("every privacy key resolves in all eight locales", () => {
  const keys = [
    "settings.privacy",
    "settings.privacyIntro",
    "settings.privacyTopicColumn",
    "settings.privacyUpstreamColumn",
    "settings.privacyLocalColumn",
    "settings.privacyPolicyNote",
    "settings.privacyOpenLogs",
    ...PRIVACY_ROWS.flatMap((row) => [
      row.topicKey,
      row.upstreamKey,
      row.localKey,
    ]),
  ];

  for (const [id, catalog] of Object.entries(catalogs)) {
    const flat = flatten(catalog);
    for (const key of keys) {
      const value = flat[key];
      assert.equal(typeof value, "string", `${id} is missing ${key}`);
      assert.ok(value.trim().length > 0, `${id} left ${key} empty`);
    }
  }
});

test("the two columns are written differently instead of repeating one sentence", () => {
  for (const row of PRIVACY_ROWS) {
    assert.notEqual(
      english[row.upstreamKey],
      english[row.localKey],
      `${row.id} must say what leaves and what stays, not the same thing twice`,
    );
  }
});

test("the privacy tab is reachable once from the settings rail", () => {
  const entries = SETTINGS_NAV.filter((entry) => entry.id === "privacy");
  assert.equal(entries.length, 1);

  const [entry] = entries;
  assert.equal(entry.labelKey, "settings.nav.privacy");
  assert.equal(entry.titleKey, "settings.privacy");
  assert.equal(entry.group, "system");
  assert.deepEqual(entry.keywordKeys, [
    "settings.privacyTopicColumn",
    "settings.privacyUpstreamColumn",
    "settings.privacyLocalColumn",
    "settings.privacyTopic.prompt",
    "settings.privacyTopic.tools",
    "settings.privacyTopic.files",
    "settings.privacyTopic.credentials",
    "settings.privacyTopic.usage",
    "settings.privacyTopic.telemetry",
  ]);
});

test("settings search keywords point at keys that exist", () => {
  const privacy = SETTINGS_NAV.find((entry) => entry.id === "privacy");
  const keys = [privacy.labelKey, privacy.titleKey, ...privacy.keywordKeys];

  for (const id of Object.keys(catalogs)) {
    const flat = flatten(catalogs[id]);
    for (const key of keys) {
      assert.equal(typeof flat[key], "string", `${id} cannot resolve ${key}`);
    }
  }
});

test("the page renders the manifest rows instead of hardcoding copy", () => {
  const page = read("../src/pages/PrivacyPage.tsx");

  assert.match(page, /import \{ PRIVACY_ROWS \} from "\.\.\/lib\/privacy-manifest"/);
  assert.match(page, /PRIVACY_ROWS\.map\(/);
  assert.match(page, /t\(row\.topicKey\)/);
  assert.match(page, /t\(row\.upstreamKey\)/);
  assert.match(page, /t\(row\.localKey\)/);
  assert.match(page, /<th scope="row">/);
});

test("the settings page wires the privacy tab to the new page", () => {
  const settings = read("../src/features/settings/SettingsPage.tsx");

  assert.match(settings, /import \{ PrivacyPage \} from "\.\.\/\.\.\/pages\/PrivacyPage"/);
  assert.match(settings, /tab === "privacy" && <PrivacyPage \/>/);
});
