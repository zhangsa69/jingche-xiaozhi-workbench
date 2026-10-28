import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(here, relative), "utf8");

const page = read("../src/pages/ExpertsPage.tsx");
const presets = read("../../../packages/shared/src/expert-presets.ts");
const panel = read("../../../packages/shared/src/expert-panel.ts");
const en = read("../../../packages/i18n/src/locales/en/index.ts");
const appState = read("../src/stores/app-state.ts");
const shell = read("../src/features/app/AppShell.tsx");
const sidebar = read("../src/components/Sidebar.tsx");
const search = read("../src/components/SearchDialog.tsx");

const EXPERT_IDS = [
  "proposal-writer",
  "contract-reviewer",
  "report-editor",
  "architect",
  "code-reviewer",
  "test-engineer",
  "ui-designer",
  "ux-researcher",
  "data-analyst",
  "data-modeler",
  "release-manager",
  "incident-responder",
];

test("the page reads the catalog instead of re-listing experts", () => {
  // Twelve cards copied into JSX would drift from the presets the panel prompt
  // is built from, and the drift would only show up in a team run.
  assert.match(page, /from "@pi-desktop\/shared"/);
  assert.match(page, /EXPERT_PRESETS/);
  assert.match(page, /expertsInCategory/);
  assert.match(page, /findExpertPreset/);
  assert.doesNotMatch(page, /const EXPERTS\s*=/);
});

test("every expert is described in the catalogs, not only in code", () => {
  for (const id of EXPERT_IDS) {
    assert.ok(presets.includes(`id: "${id}"`), `${id} missing from presets`);
    assert.match(
      en,
      new RegExp(`"?${id}"?:\\s*\\{\\s*name: "[^"]+",\\s*description: "[^"]+"`),
      `${id} has no English name/description`,
    );
  }
});

test("picking an expert hands over prompt text the user can still see", () => {
  // The persona must not live in a hidden session setting: the brief goes into
  // the composer, so it can be read and edited before it is sent.
  assert.match(page, /appendComposerDraftText\(preset\.brief\)/);
  assert.match(page, /setPage\("chat"\)/);
  assert.doesNotMatch(page, /systemPrompt/);
});

test("the model on a card is a label, never a silent switch", () => {
  assert.match(presets, /defaultModel/);
  assert.match(page, /t\("experts\.prefersModel"/);
  // No session-configuration call from this page: a click here must not move
  // the user onto a different model.
  assert.doesNotMatch(page, /configureActiveSession/);
});

test("a team run is one parallel batch, built by the shared builder", () => {
  assert.match(page, /buildExpertPanelPrompt/);
  assert.match(panel, /same assistant message/);
  assert.match(page, /MAX_EXPERT_PANEL_MEMBERS/);
});

test("the panel refuses to launch without an instruction", () => {
  assert.match(page, /disabled=\{team\.length === 0 \|\| !instruction\.trim\(\)\}/);
  assert.match(panel, /if \(!instruction\) return "";/);
});

test("the panel cannot exceed its limit from the UI", () => {
  assert.match(page, /current\.length >= MAX_EXPERT_PANEL_MEMBERS/);
  assert.match(page, /showToast\(t\("experts\.teamFull"/);
});

test("interactive elements are real buttons and a real input", () => {
  assert.match(page, /<input/);
  assert.match(page, /type="search"/);
  assert.match(page, /aria-pressed=\{category === id\}/);
  assert.match(page, /<textarea/);
  assert.doesNotMatch(page, /role="button"/);
});

test("the page is reachable from state, the shell, the footer and search", () => {
  assert.match(appState, /\| "experts"/);
  assert.match(shell, /import\("\.\.\/\.\.\/pages\/ExpertsPage"\)/);
  assert.match(shell, /page === "experts" \?/);
  assert.match(sidebar, /data-nav="experts"/);
  assert.match(sidebar, /aria-pressed=\{page === "experts"\}/);
  assert.match(search, /page: "experts", labelKey: "experts\.title"/);
});
