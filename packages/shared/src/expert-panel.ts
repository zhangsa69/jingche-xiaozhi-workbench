/**
 * Expert panel (W-25).
 *
 * A panel is one instruction handed to several experts at once. The dispatch is
 * plain prompt text, not a new orchestrator: the runtime already runs several
 * `Task` calls from one assistant message in parallel and already merges the
 * delegations back into the parent turn. Reusing that path keeps the aggregation
 * behaviour identical to a hand-written fan-out and adds no new execution stack.
 *
 * The prompt therefore has to do the two things the runtime does not: say who
 * does what, and ask for **one** deliverable instead of a bundle of reports.
 */

import {
  MAX_EXPERT_PANEL_MEMBERS,
  resolveExpertSelection,
  type ExpertPreset,
} from "./expert-presets.js";

export type ExpertPanelRequest = {
  instruction: string;
  /** Expert ids in pick order; unknown ids are dropped, duplicates collapse. */
  expertIds: readonly string[];
  /** Display names keyed by expert id, so the prompt reads like the UI. */
  labels?: Readonly<Record<string, string | undefined>>;
  limit?: number;
};

const AGGREGATION = [
  "Then merge the results into ONE deliverable:",
  "- Lead with what the instruction asked for, not with who said what.",
  "- Keep a disagreement only when it changes the recommendation, and name both sides.",
  "- Drop duplicated findings; keep the sharper wording of each.",
  "- End with what still needs a human decision, and nothing else.",
  "",
  "Do not re-dispatch an expert whose result already covered its part.",
].join("\n");

function labelOf(expert: ExpertPreset, labels?: Readonly<Record<string, string | undefined>>): string {
  const label = labels?.[expert.id]?.trim();
  return label || expert.id;
}

/**
 * Build the panel prompt. Returns an empty string when there is nothing to run
 * (blank instruction or no resolvable expert) so callers can disable the action
 * instead of sending a prompt that asks for nothing.
 */
export function buildExpertPanelPrompt(request: ExpertPanelRequest): string {
  const instruction = request.instruction.trim();
  if (!instruction) return "";
  const members = resolveExpertSelection(
    request.expertIds,
    request.limit ?? MAX_EXPERT_PANEL_MEMBERS,
  );
  if (members.length === 0) return "";

  const lines = [
    "Run this request as one expert panel.",
    "",
    "Instruction:",
    instruction,
    "",
    "Dispatch one Task per expert in the same assistant message so they run in",
    "parallel. Pass `agent` as listed and the brief below as the task text:",
    "",
  ];
  members.forEach((expert, index) => {
    lines.push(
      `${index + 1}. ${labelOf(expert, request.labels)} — agent: "${expert.delegate}"`,
    );
    for (const briefLine of expert.brief.split("\n")) {
      lines.push(`   ${briefLine}`);
    }
    lines.push("");
  });
  lines.push(AGGREGATION);
  return lines.join("\n");
}
