import { describe, expect, it } from "vitest";
import {
  MAX_PLAN_STEPS,
  PLAN_STEP_TOOL_NAME,
  cleanStepTitle,
  parsePlanSteps,
  planStepProgress,
  stepNumberFromArgs,
} from "./plan-steps.js";
import type { UiMessage } from "./types/messages.js";

function stepRow(
  id: string,
  step: number | string | undefined,
  toolStatus: UiMessage["toolStatus"] = "success",
): UiMessage {
  return {
    id,
    role: "tool",
    content: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    toolName: PLAN_STEP_TOOL_NAME,
    toolCallId: `call-${id}`,
    toolStatus,
    toolArgs: step === undefined ? {} : { step },
  };
}

describe("cleanStepTitle", () => {
  it("keeps the words and drops the Markdown", () => {
    expect(cleanStepTitle("**Add** the `parsePlanSteps` helper")).toBe(
      "Add the parsePlanSteps helper",
    );
    expect(cleanStepTitle("[Read the spec](docs/spec.md):")).toBe(
      "Read the spec",
    );
    expect(cleanStepTitle("Ship it.  ")).toBe("Ship it");
  });

  it("caps a title that would not fit a chip", () => {
    const title = cleanStepTitle("x".repeat(400));
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("parsePlanSteps", () => {
  it("reads a checkbox task list", () => {
    const markdown = [
      "# Plan",
      "",
      "## Steps",
      "- [ ] Add the parser",
      "- [x] Wire the bar",
      "- [ ] Add the contract test",
      "",
      "1. This numbered list is acceptance criteria, not steps",
    ].join("\n");
    expect(parsePlanSteps(markdown)).toEqual([
      { index: 1, title: "Add the parser" },
      { index: 2, title: "Wire the bar" },
      { index: 3, title: "Add the contract test" },
    ]);
  });

  it("falls back to a numbered list and keeps order", () => {
    const markdown = [
      "1. Read the spec",
      "2. Implement the runtime tool",
      "3) Wire the renderer",
    ].join("\n");
    expect(parsePlanSteps(markdown).map((step) => step.title)).toEqual([
      "Read the spec",
      "Implement the runtime tool",
      "Wire the renderer",
    ]);
  });

  it("understands Step labels and numbered headings", () => {
    expect(
      parsePlanSteps("Step 1: parse\nStep 2: render").map((step) => step.title),
    ).toEqual(["parse", "render"]);
    expect(
      parsePlanSteps("## 1. parse\n## 2. render").map((step) => step.title),
    ).toEqual(["parse", "render"]);
  });

  it("ignores fenced code and one-item lists", () => {
    expect(
      parsePlanSteps(["```md", "1. not a step", "2. not a step", "```"].join("\n")),
    ).toEqual([]);
    expect(parsePlanSteps("1. only one task")).toEqual([]);
    expect(parsePlanSteps("")).toEqual([]);
    expect(parsePlanSteps(undefined)).toEqual([]);
  });

  it("caps a runaway checklist", () => {
    const markdown = Array.from(
      { length: MAX_PLAN_STEPS + 12 },
      (_unused, index) => `- [ ] task ${index + 1}`,
    ).join("\n");
    expect(parsePlanSteps(markdown)).toHaveLength(MAX_PLAN_STEPS);
  });
});

describe("stepNumberFromArgs", () => {
  it("accepts a positive in-range number or numeric string", () => {
    expect(stepNumberFromArgs({ step: 3 })).toBe(3);
    expect(stepNumberFromArgs({ step: "3" })).toBe(3);
    expect(stepNumberFromArgs({ step: 0 })).toBeUndefined();
    expect(stepNumberFromArgs({ step: 2.5 })).toBeUndefined();
    expect(stepNumberFromArgs({ step: "three" })).toBeUndefined();
    expect(stepNumberFromArgs({})).toBeUndefined();
    expect(stepNumberFromArgs(null)).toBeUndefined();
  });
});

describe("planStepProgress", () => {
  const steps = parsePlanSteps(
    ["- [ ] parse", "- [ ] render", "- [ ] verify"].join("\n"),
  );

  it("starts empty so the bar can say 0/3", () => {
    const progress = planStepProgress(steps, []);
    expect(progress.current).toBe(0);
    expect(progress.step).toBeUndefined();
    expect(progress.total).toBe(3);
  });

  it("reads the last reported step and its row", () => {
    const progress = planStepProgress(steps, [
      stepRow("a", 1),
      stepRow("b", 2),
    ]);
    expect(progress.current).toBe(2);
    expect(progress.step?.title).toBe("render");
    expect(progress.messageId).toBe("b");
  });

  it("remembers where each reported step began", () => {
    const progress = planStepProgress(steps, [
      stepRow("a", 1),
      stepRow("b", 2),
      stepRow("b-again", 2),
    ]);
    expect(progress.anchors).toEqual({ 1: "a", 2: "b" });
    // The bar still points at the latest row, so a retry of a step shows up.
    expect(progress.messageId).toBe("b-again");
  });

  it("replays to the same reading after a restart", () => {
    const replayed = planStepProgress(steps, [
      stepRow("a", 1),
      stepRow("b", 2),
      stepRow("c", 3),
    ]);
    expect(replayed.current).toBe(3);
    expect(replayed.step?.title).toBe("verify");
  });

  it("ignores failed or denied calls so a retry is not progress", () => {
    const progress = planStepProgress(steps, [
      stepRow("a", 1),
      stepRow("b", 3, "error"),
      stepRow("c", 2, "denied"),
    ]);
    expect(progress.current).toBe(1);
  });

  it("never moves backwards and never exceeds the list", () => {
    const progress = planStepProgress(steps, [
      stepRow("a", 2),
      stepRow("b", 1),
      stepRow("c", 9),
    ]);
    expect(progress.current).toBe(2);
    expect(progress.messageId).toBe("a");
  });

  it("ignores other tools that happen to carry a step argument", () => {
    const other: UiMessage = {
      ...stepRow("x", 2),
      toolName: "Read",
    };
    expect(planStepProgress(steps, [stepRow("a", 1), other]).current).toBe(1);
  });
});
