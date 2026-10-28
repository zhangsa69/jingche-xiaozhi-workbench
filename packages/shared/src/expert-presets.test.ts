import { describe, expect, it } from "vitest";
import {
  EXPERT_CATEGORIES,
  EXPERT_PRESETS,
  MAX_EXPERT_PANEL_MEMBERS,
  expertsInCategory,
  findExpertPreset,
  matchExperts,
  resolveExpertSelection,
} from "./expert-presets.js";
import { SUBAGENT_PRESETS } from "./subagent-presets.js";

const delegateIds = SUBAGENT_PRESETS.map((preset) => preset.id);

describe("EXPERT_PRESETS", () => {
  it("ships twelve experts", () => {
    expect(EXPERT_PRESETS).toHaveLength(12);
  });

  it("keeps ids unique, because selection travels as ids", () => {
    const ids = EXPERT_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every expert a two-character monogram", () => {
    for (const preset of EXPERT_PRESETS) {
      expect(preset.initials).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("only uses declared categories", () => {
    for (const preset of EXPERT_PRESETS) {
      expect(EXPERT_CATEGORIES).toContain(preset.category);
    }
  });

  it("covers every category, so no tab opens empty", () => {
    for (const category of EXPERT_CATEGORIES) {
      expect(expertsInCategory(category).length).toBeGreaterThan(0);
    }
  });

  it("delegates only to subagent presets that actually ship", () => {
    // A dangling delegate would make a team run dispatch a `Task` naming an
    // agent the runtime cannot load, which fails only at run time.
    for (const preset of EXPERT_PRESETS) {
      expect(delegateIds).toContain(preset.delegate);
    }
  });

  it("writes a brief long enough to change the answer", () => {
    for (const preset of EXPERT_PRESETS) {
      expect(preset.brief.length).toBeGreaterThan(120);
    }
  });
});

describe("findExpertPreset", () => {
  it("resolves a known id", () => {
    expect(findExpertPreset("code-reviewer")?.category).toBe("engineering");
  });

  it("returns undefined for an unknown id instead of throwing", () => {
    expect(findExpertPreset("nope")).toBeUndefined();
  });
});

describe("resolveExpertSelection", () => {
  it("keeps catalog order regardless of pick order", () => {
    const picked = resolveExpertSelection(["incident-responder", "architect"]);
    expect(picked.map((preset) => preset.id)).toEqual(["architect", "incident-responder"]);
  });

  it("collapses duplicates", () => {
    expect(resolveExpertSelection(["architect", "architect"])).toHaveLength(1);
  });

  it("drops unknown ids", () => {
    expect(resolveExpertSelection(["architect", "ghost"]).map((p) => p.id)).toEqual([
      "architect",
    ]);
  });

  it("caps the panel at the shared limit", () => {
    const all = EXPERT_PRESETS.map((preset) => preset.id);
    expect(resolveExpertSelection(all)).toHaveLength(MAX_EXPERT_PANEL_MEMBERS);
  });

  it("honours a tighter limit", () => {
    const all = EXPERT_PRESETS.map((preset) => preset.id);
    expect(resolveExpertSelection(all, 2)).toHaveLength(2);
  });
});

describe("matchExperts", () => {
  const labels = { architect: "Solution Architect", "data-analyst": "数据分析师" };

  it("returns everything for an empty query", () => {
    expect(matchExperts("   ", labels)).toHaveLength(EXPERT_PRESETS.length);
  });

  it("matches the translated label ignoring case", () => {
    expect(matchExperts("architect", labels)).toEqual(["architect"]);
  });

  it("matches non-Latin labels", () => {
    expect(matchExperts("数据", { "data-analyst": "数据分析师" })).toEqual(["data-analyst"]);
  });

  it("matches a monogram", () => {
    expect(matchExperts("ux", labels)).toContain("ux-researcher");
  });

  it("matches the category word", () => {
    expect(matchExperts("ops", labels)).toEqual(["release-manager", "incident-responder"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(matchExperts("zzz", labels)).toEqual([]);
  });
});
