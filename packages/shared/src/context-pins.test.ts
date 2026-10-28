import { describe, expect, it } from "vitest";
import {
  buildContextPinBlock,
  CONTEXT_PIN_EXCERPT_CHARS,
  contextPinCandidates,
  contextPinUsage,
  MAX_CONTEXT_PIN_CHARS,
  MAX_CONTEXT_PINS,
  selectContextPins,
} from "./context-pins.js";

const messages = [
  { id: "m1", role: "user" as const, text: "we settled on cents, not floats" },
  { id: "m2", role: "assistant" as const, text: "Agreed.   Store integer cents." },
  { id: "m3", role: "system" as const, text: "   " },
  { id: "m4", role: "user" as const, text: "and rounding is half-up" },
];

describe("contextPinCandidates", () => {
  it("keeps order and drops empty turns", () => {
    expect(contextPinCandidates(messages).map((row) => row.id)).toEqual(["m1", "m2", "m4"]);
  });

  it("collapses whitespace in the excerpt but keeps the text verbatim", () => {
    const row = contextPinCandidates(messages).find((entry) => entry.id === "m2");
    expect(row?.excerpt).toBe("Agreed. Store integer cents.");
    expect(row?.text).toBe("Agreed.   Store integer cents.");
  });

  it("truncates a long excerpt with an ellipsis", () => {
    const row = contextPinCandidates([
      { id: "long", role: "user", text: "x".repeat(CONTEXT_PIN_EXCERPT_CHARS + 40) },
    ])[0];
    expect(row.excerpt.endsWith("…")).toBe(true);
    expect(row.excerpt.length).toBe(CONTEXT_PIN_EXCERPT_CHARS + 1);
    expect(row.chars).toBe(CONTEXT_PIN_EXCERPT_CHARS + 40);
  });

  it("skips a message without an id", () => {
    expect(contextPinCandidates([{ id: "", role: "user", text: "hi" }])).toEqual([]);
  });
});

describe("selectContextPins", () => {
  const candidates = contextPinCandidates(messages);

  it("returns ticks in transcript order", () => {
    const { pins } = selectContextPins(candidates, ["m4", "m1"]);
    expect(pins.map((pin) => pin.id)).toEqual(["m1", "m4"]);
  });

  it("ignores ids that are not in the transcript", () => {
    expect(selectContextPins(candidates, ["nope"]).pins).toEqual([]);
  });

  it("stops at the pin count", () => {
    const many = contextPinCandidates(
      Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, role: "user" as const, text: "x" })),
    );
    const { pins, dropped } = selectContextPins(
      many,
      many.map((row) => row.id),
    );
    expect(pins).toHaveLength(MAX_CONTEXT_PINS);
    expect(dropped).toBe(4);
  });

  it("stops at the character budget instead of truncating a turn", () => {
    const big = contextPinCandidates([
      { id: "a", role: "user", text: "a".repeat(MAX_CONTEXT_PIN_CHARS) },
      { id: "b", role: "user", text: "b".repeat(10) },
    ]);
    const { pins, dropped } = selectContextPins(big, ["a", "b"]);
    expect(pins.map((pin) => pin.id)).toEqual(["a"]);
    expect(dropped).toBe(1);
  });

  it("never spends more than the budget", () => {
    const rows = contextPinCandidates(
      Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, role: "user" as const, text: "y".repeat(500) })),
    );
    expect(contextPinUsage(selectContextPins(rows, rows.map((row) => row.id)).pins)).toBeLessThanOrEqual(
      MAX_CONTEXT_PIN_CHARS,
    );
  });
});

describe("buildContextPinBlock", () => {
  it("is empty without pins", () => {
    expect(buildContextPinBlock([])).toBe("");
  });

  it("quotes role and text and calls itself verbatim", () => {
    const block = buildContextPinBlock(contextPinCandidates(messages).slice(0, 2));
    expect(block).toContain("> user: we settled on cents, not floats");
    expect(block).toContain("> assistant: Agreed. Store integer cents.");
    expect(block).toMatch(/verbatim/);
    expect(block).toMatch(/may no longer carry them/);
  });
});
