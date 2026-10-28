import { describe, expect, it } from "vitest";
import { buildExpertPanelPrompt } from "./expert-panel.js";
import { EXPERT_PRESETS, findExpertPreset } from "./expert-presets.js";

const instruction = "Review the pricing change before Friday.";

describe("buildExpertPanelPrompt", () => {
  it("returns nothing without an instruction", () => {
    expect(buildExpertPanelPrompt({ instruction: "   ", expertIds: ["architect"] })).toBe("");
  });

  it("returns nothing when no expert resolves", () => {
    expect(buildExpertPanelPrompt({ instruction, expertIds: ["ghost"] })).toBe("");
  });

  it("carries the instruction verbatim", () => {
    const prompt = buildExpertPanelPrompt({ instruction, expertIds: ["architect"] });
    expect(prompt).toContain(instruction);
  });

  it("names the delegate preset for every member", () => {
    const prompt = buildExpertPanelPrompt({
      instruction,
      expertIds: ["architect", "test-engineer"],
    });
    expect(prompt).toContain(`agent: "${findExpertPreset("architect")?.delegate}"`);
    expect(prompt).toContain(`agent: "${findExpertPreset("test-engineer")?.delegate}"`);
  });

  it("asks for one parallel batch rather than sequential rounds", () => {
    const prompt = buildExpertPanelPrompt({ instruction, expertIds: ["architect"] });
    expect(prompt).toMatch(/same assistant message/i);
    expect(prompt).toMatch(/parallel/i);
  });

  it("includes each member's brief so the delegate inherits the domain", () => {
    const brief = findExpertPreset("contract-reviewer")?.brief ?? "";
    const prompt = buildExpertPanelPrompt({ instruction, expertIds: ["contract-reviewer"] });
    expect(prompt).toContain(brief.split("\n")[0]);
  });

  it("uses the translated label when one is supplied", () => {
    const prompt = buildExpertPanelPrompt({
      instruction,
      expertIds: ["architect"],
      labels: { architect: "方案架构师" },
    });
    expect(prompt).toContain("方案架构师");
  });

  it("falls back to the id when the label is missing or blank", () => {
    const prompt = buildExpertPanelPrompt({
      instruction,
      expertIds: ["architect"],
      labels: { architect: "  " },
    });
    expect(prompt).toContain("1. architect");
  });

  it("deduplicates and keeps catalog order", () => {
    const prompt = buildExpertPanelPrompt({
      instruction,
      expertIds: ["incident-responder", "architect", "architect"],
    });
    expect(prompt.match(/^\d+\. /gm)).toHaveLength(2);
    expect(prompt.indexOf("architect")).toBeLessThan(prompt.indexOf("incident-responder"));
  });

  it("caps members at the panel limit", () => {
    const prompt = buildExpertPanelPrompt({
      instruction,
      expertIds: EXPERT_PRESETS.map((preset) => preset.id),
    });
    expect(prompt.match(/^\d+\. /gm)).toHaveLength(4);
  });

  it("asks for one deliverable and names the disagreement rule", () => {
    const prompt = buildExpertPanelPrompt({ instruction, expertIds: ["architect"] });
    expect(prompt).toMatch(/ONE deliverable/);
    expect(prompt).toMatch(/disagreement only when it changes the recommendation/i);
  });

  it("forbids re-dispatching work already answered", () => {
    const prompt = buildExpertPanelPrompt({ instruction, expertIds: ["architect"] });
    expect(prompt).toMatch(/Do not re-dispatch/i);
  });
});
