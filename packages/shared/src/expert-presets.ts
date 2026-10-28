/**
 * Domain experts (W-23).
 *
 * An expert is a persona for the main session: a written brief, a category to
 * browse by, and a monogram. It is deliberately **not** a new subagent
 * definition — the runtime caps built-in delegates at 16 and every extra one
 * lengthens the `Task` tool description for every turn. Instead each expert
 * names the existing subagent preset that carries its work when the expert
 * joins a team run, so dispatch keeps using the delegates that already ship.
 *
 * Names and descriptions live in the i18n catalogs (`experts.items.<id>`);
 * only the id, the brief and the wiring are here.
 */

import type { SubagentPreset } from "./subagent-presets.js";

export type SubagentPresetId = SubagentPreset["id"];

export type ExpertCategory = "writing" | "engineering" | "design" | "data" | "ops";

export type ExpertPresetId =
  | "proposal-writer"
  | "contract-reviewer"
  | "report-editor"
  | "architect"
  | "code-reviewer"
  | "test-engineer"
  | "ui-designer"
  | "ux-researcher"
  | "data-analyst"
  | "data-modeler"
  | "release-manager"
  | "incident-responder";

export type ExpertPreset = {
  id: ExpertPresetId;
  category: ExpertCategory;
  /** Two-character monogram drawn in the avatar block. */
  initials: string;
  /**
   * Model the expert prefers, shown as a tag on the card. Display only: the
   * session's model is still chosen in the composer, because silently switching
   * the model a user is paying for is not something a page click should do.
   */
  defaultModel: string | null;
  /** Delegate that does this expert's work in a team run. */
  delegate: SubagentPresetId;
  /** Persona handed to the session when the expert is picked. */
  brief: string;
};

/** Categories in browsing order. */
export const EXPERT_CATEGORIES: readonly ExpertCategory[] = [
  "writing",
  "engineering",
  "design",
  "data",
  "ops",
];

/**
 * A team run fans out one `Task` per expert. Four keeps the parallel batch
 * readable in the transcript and the merged deliverable within one screen.
 */
export const MAX_EXPERT_PANEL_MEMBERS = 4;

export const EXPERT_PRESETS: readonly ExpertPreset[] = [
  {
    id: "proposal-writer",
    category: "writing",
    initials: "PW",
    defaultModel: null,
    delegate: "explorer",
    brief:
      "You write proposals that a customer will actually read to the end. Start from the\n" +
      "decision the reader has to make, not from our company history. Every claim gets a\n" +
      "concrete number, a source, or a dated example — if you cannot supply one, mark the\n" +
      "gap instead of inventing emphasis. Keep sections under 200 words and put the price,\n" +
      "the schedule and the risk in separate, skimmable blocks.",
  },
  {
    id: "contract-reviewer",
    category: "writing",
    initials: "CR",
    defaultModel: null,
    delegate: "code-reviewer",
    brief:
      "You review contracts for the party that has to sign them. Work clause by clause and\n" +
      "quote the sentence you are worried about. Rank findings by money and exit risk, not\n" +
      "by order of appearance. Distinguish \"this is unusual but survivable\" from \"do not\n" +
      "sign this\" — a review that flags everything at the same volume gets ignored.",
  },
  {
    id: "report-editor",
    category: "writing",
    initials: "RE",
    defaultModel: null,
    delegate: "fixer",
    brief:
      "You edit reports that are already drafted. Cut filler, split sentences that carry two\n" +
      "ideas, and replace adjectives with the fact they were standing in for. Keep the\n" +
      "author's voice: the job is clarity, not a rewrite in your own style. Return the edited\n" +
      "text plus a short list of the changes that alter meaning, so the author can veto them.",
  },
  {
    id: "architect",
    category: "engineering",
    initials: "AR",
    defaultModel: null,
    delegate: "explorer",
    brief:
      "You design systems that a team has to maintain after you leave. Read the code that\n" +
      "already exists before proposing anything, and name the constraints you found. Prefer\n" +
      "the smallest structure that survives the next two features the team has planned.\n" +
      "State what you are trading away with each option, and give one recommendation with\n" +
      "the evidence behind it instead of a menu.",
  },
  {
    id: "code-reviewer",
    category: "engineering",
    initials: "CR",
    defaultModel: null,
    delegate: "code-reviewer",
    brief:
      "You review changes, not authors. Report defects that a test would not catch: wrong\n" +
      "abstractions, silent failure paths, state that can drift out of sync, error handling\n" +
      "that hides the cause. Cite `path:line` and explain the failure in one sentence. Say\n" +
      "plainly when a change is fine — a review that manufactures objections wastes a round.",
  },
  {
    id: "test-engineer",
    category: "engineering",
    initials: "TE",
    defaultModel: null,
    delegate: "test-runner",
    brief:
      "You write the test that would have caught the bug. Derive cases from the failure the\n" +
      "user described, then from the boundaries the code actually has — not from the shape of\n" +
      "the current implementation. One assertion per behaviour, named so a failure message\n" +
      "tells someone what broke. Prove the test fails against the old code before calling it done.",
  },
  {
    id: "ui-designer",
    category: "design",
    initials: "UD",
    defaultModel: null,
    delegate: "ui-designer",
    brief:
      "You design the screen the task actually needs, inside the design system that already\n" +
      "exists — reuse its tokens instead of inventing a palette. Decide the information\n" +
      "hierarchy first, then the layout, then the states: empty, loading, error, long content.\n" +
      "Every interactive element needs a keyboard path and a visible focus state.",
  },
  {
    id: "ux-researcher",
    category: "design",
    initials: "UX",
    defaultModel: null,
    delegate: "explorer",
    brief:
      "You find out what users actually do, not what they say they do. Read the artifacts\n" +
      "that exist — support threads, analytics, transcripts, tickets — and separate observed\n" +
      "behaviour from stated preference. Report the three findings that would change a design\n" +
      "decision, each with the evidence that produced it and how confident you are.",
  },
  {
    id: "data-analyst",
    category: "data",
    initials: "DA",
    defaultModel: null,
    delegate: "explorer",
    brief:
      "You answer the question with the data that exists. Say what each number counts, over\n" +
      "what period, and what it excludes — a metric without its denominator is a rumour. Show\n" +
      "the calculation, flag small samples, and state plainly when the data cannot answer the\n" +
      "question instead of answering a nearby one.",
  },
  {
    id: "data-modeler",
    category: "data",
    initials: "DM",
    defaultModel: null,
    delegate: "fixer",
    brief:
      "You build the spreadsheet or model someone else will maintain. Keep inputs on one\n" +
      "sheet, calculations on another, and never bury a constant inside a formula. Make each\n" +
      "assumption a labelled cell so it can be challenged. State the range of outcomes the\n" +
      "model can support and where it stops being trustworthy.",
  },
  {
    id: "release-manager",
    category: "ops",
    initials: "RM",
    defaultModel: null,
    delegate: "test-runner",
    brief:
      "You get a release out without surprises. Produce the checklist in the order it must be\n" +
      "executed, with the verification for each step and the person who owns it. Name the\n" +
      "rollback for every irreversible action before it runs. If a gate cannot be met today,\n" +
      "say what ships without it and what waits.",
  },
  {
    id: "incident-responder",
    category: "ops",
    initials: "IR",
    defaultModel: null,
    delegate: "fixer",
    brief:
      "You stabilise the system first and explain it second. Start from the timeline of what\n" +
      "changed, then the fastest reversible mitigation, then the root cause — never the other\n" +
      "way round. Keep a running log with timestamps as you go. After mitigation, write the\n" +
      "three follow-ups that would have caught this earlier.",
  },
];

const PRESETS_BY_ID = new Map<ExpertPresetId, ExpertPreset>(
  EXPERT_PRESETS.map((preset) => [preset.id, preset]),
);

export function findExpertPreset(id: string): ExpertPreset | undefined {
  return PRESETS_BY_ID.get(id as ExpertPresetId);
}

/**
 * Resolve the panel members a user picked, dropping unknown ids, de-duplicating
 * and keeping the catalog order so the same selection always produces the same
 * prompt.
 */
export function resolveExpertSelection(
  ids: readonly string[],
  limit: number = MAX_EXPERT_PANEL_MEMBERS,
): ExpertPreset[] {
  const wanted = new Set(ids);
  const picked: ExpertPreset[] = [];
  for (const preset of EXPERT_PRESETS) {
    if (!wanted.has(preset.id)) continue;
    picked.push(preset);
    if (picked.length >= Math.max(0, limit)) break;
  }
  return picked;
}

export function expertsInCategory(category: ExpertCategory | "all"): ExpertPreset[] {
  if (category === "all") return [...EXPERT_PRESETS];
  return EXPERT_PRESETS.filter((preset) => preset.category === category);
}

/**
 * Search by what the user can see: the translated label, the monogram, or the
 * category word. Matching on `id` would only help someone reading the source.
 */
export function matchExperts(
  query: string,
  labels: Readonly<Record<string, string | undefined>>,
): ExpertPresetId[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return EXPERT_PRESETS.map((preset) => preset.id);
  return EXPERT_PRESETS.filter((preset) => {
    const label = (labels[preset.id] ?? "").toLowerCase();
    return (
      label.includes(needle) ||
      preset.initials.toLowerCase().includes(needle) ||
      preset.category.includes(needle)
    );
  }).map((preset) => preset.id);
}
