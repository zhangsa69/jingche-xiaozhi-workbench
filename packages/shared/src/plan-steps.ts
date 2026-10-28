/** Structural steps of one approved plan or goal execution (W-05). */
import type { UiMessage } from "./types/messages.js";

/**
 * One node of an approved contract, parsed from its Markdown snapshot.
 *
 * Steps are derived, never stored: the approved snapshot is already the durable
 * record, so parsing it on read keeps a restart, a re-approval and a second
 * renderer window agreeing on the same list without a schema of its own.
 */
export type PlanStep = {
  /** 1-based position the model reports with `UpdateStep`. */
  index: number;
  title: string;
};

/** Tool the runtime offers while an approved contract executes. Each call
 * records "I am starting step N" as an ordinary tool row, which is what makes
 * progress survive a restart: the transcript is the only source of truth. */
export const PLAN_STEP_TOOL_NAME = "UpdateStep";

/** A plan with more steps than this is a checklist, not a progress bar. */
export const MAX_PLAN_STEPS = 40;

const MAX_STEP_TITLE = 120;

const CHECKBOX_STEP = /^\s*[-*+]\s+\[[ xX]\]\s+(\S.*)$/;
const NUMBERED_STEP = /^\s*(\d{1,2})[.)]\s+(\S.*)$/;
const STEP_LABEL = /^\s*(?:step|phase|schritt|étape|paso)\s*(\d{1,2})\s*[:.)-]\s*(\S.*)$/i;
const STEP_HEADING = /^\s{0,3}#{2,4}\s+(\d{1,2})[.):-]?\s+(\S.*)$/;

/** Strip the Markdown that reads well in a document but badly in a chip. */
export function cleanStepTitle(raw: string): string {
  const text = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/[。．.；;:,，、\s]+$/, "")
    .trim();
  return text.length > MAX_STEP_TITLE
    ? `${text.slice(0, MAX_STEP_TITLE - 1).trimEnd()}…`
    : text;
}

/**
 * Parse the ordered steps of a contract snapshot.
 *
 * Checkboxes win over numbered lists, which win over `Step N:` labels, which
 * win over numbered headings. The first shape that yields at least two entries
 * is the list: a plan whose tasks are checkboxes must not have its acceptance
 * criteria numbered list mistaken for the steps below it.
 */
export function parsePlanSteps(markdown: string | undefined): PlanStep[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const shapes: Array<(line: string) => string | undefined> = [
    (line) => CHECKBOX_STEP.exec(line)?.[1],
    (line) => NUMBERED_STEP.exec(line)?.[2],
    (line) => STEP_LABEL.exec(line)?.[2],
    (line) => STEP_HEADING.exec(line)?.[2],
  ];
  for (const shape of shapes) {
    const steps = collectSteps(lines, shape);
    if (steps.length >= 2) return steps;
  }
  return [];
}

/** One pass over the snapshot for one shape. Fenced code is not a step list. */
function collectSteps(
  lines: string[],
  shape: (line: string) => string | undefined,
): PlanStep[] {
  const steps: PlanStep[] = [];
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const raw = shape(line);
    if (!raw) continue;
    const title = cleanStepTitle(raw);
    if (!title) continue;
    steps.push({ index: steps.length + 1, title });
    if (steps.length >= MAX_PLAN_STEPS) break;
  }
  return steps;
}

/** The step number a `UpdateStep` call reported, when it is a valid one. */
export function stepNumberFromArgs(args: unknown): number | undefined {
  if (!args || typeof args !== "object") return undefined;
  const raw = (args as { step?: unknown }).step;
  const value =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isInteger(value) && value > 0 && value <= MAX_PLAN_STEPS
    ? value
    : undefined;
}

export type PlanStepProgress = {
  steps: PlanStep[];
  total: number;
  /** Highest step reported so far; `0` before the first `UpdateStep` row. */
  current: number;
  /** Current step, or `undefined` before the run has marked one. */
  step?: PlanStep;
  /** Transcript row that reported the current step, for click-to-locate. */
  messageId?: string;
  /** Earliest row that reported each step, so any reported step can be found. */
  anchors: Readonly<Record<number, string>>;
};

/**
 * Replay the transcript into a progress reading.
 *
 * Only successful `UpdateStep` rows count: a denied or failed call reported
 * nothing, so a retry of the same step must not read as progress. Progress is
 * monotonic within a run, so an echoed earlier number can never move the bar
 * backwards.
 */
export function planStepProgress(
  steps: PlanStep[],
  messages: readonly UiMessage[],
): PlanStepProgress {
  let current = 0;
  let messageId: string | undefined;
  const anchors: Record<number, string> = {};
  for (const message of messages) {
    if (message.role !== "tool" || message.toolName !== PLAN_STEP_TOOL_NAME) {
      continue;
    }
    if (message.toolStatus === "error" || message.toolStatus === "denied") {
      continue;
    }
    const reported = stepNumberFromArgs(message.toolArgs);
    if (reported === undefined || reported > steps.length) continue;
    // The first successful report of a step is where the work for it began,
    // which is what a reader clicks to see.
    anchors[reported] ??= message.id;
    if (reported < current) continue;
    current = reported;
    messageId = message.id;
  }
  return {
    steps,
    total: steps.length,
    current,
    ...(current > 0 ? { step: steps[current - 1] } : {}),
    ...(messageId ? { messageId } : {}),
    anchors,
  };
}
