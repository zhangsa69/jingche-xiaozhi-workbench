import { describe, expect, it } from "vitest";
import {
  buildContextReferenceBlock,
  contextReferenceCandidates,
  contextReferenceToken,
  findContextReferences,
  MAX_CONTEXT_BLOCK_CHARS,
  MAX_CONTEXT_EXCERPT_CHARS,
  MAX_CONTEXT_REFERENCES,
  stripContextReferenceTokens,
} from "./context-reference.js";

const sessions = [
  { id: "a", title: "Invoice parser", messageCount: 12 },
  { id: "b", title: "Rust build fix", messageCount: 1 },
  { id: "c", title: "Landing page copy", messageCount: 40 },
];

describe("contextReferenceToken", () => {
  it("wraps the title so spaces survive", () => {
    expect(contextReferenceToken(" Rust build fix ")).toBe('#"Rust build fix"');
  });
});

describe("contextReferenceCandidates", () => {
  it("matches titles case-insensitively", () => {
    expect(contextReferenceCandidates(sessions, "rust").map((row) => row.id)).toEqual(["b"]);
  });

  it("lists everything recent-first for an empty query", () => {
    expect(contextReferenceCandidates(sessions, "").map((row) => row.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("never offers the conversation being written in", () => {
    expect(
      contextReferenceCandidates(sessions, "", { excludeId: "a" }).map((row) => row.id),
    ).toEqual(["b", "c"]);
  });

  it("respects the limit and never returns duplicates", () => {
    const rows = contextReferenceCandidates(
      [...sessions, { id: "a", title: "Invoice parser", messageCount: 12 }],
      "",
      { limit: 2 },
    );
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("skips untitled sessions", () => {
    expect(
      contextReferenceCandidates([{ id: "x", title: "  ", messageCount: 3 }], ""),
    ).toEqual([]);
  });
});

describe("findContextReferences", () => {
  it("resolves tokens to sessions", () => {
    const refs = findContextReferences('see #"Invoice parser" and #"Rust build fix"', sessions);
    expect(refs.map((ref) => ref.id)).toEqual(["a", "b"]);
  });

  it("ignores a mistyped title instead of guessing", () => {
    expect(findContextReferences('#"Invoice prsr"', sessions)).toEqual([]);
  });

  it("does not reference the current session through a token", () => {
    expect(findContextReferences('#"Invoice parser"', sessions, { excludeId: "a" })).toEqual([]);
  });

  it("counts a repeated token once", () => {
    const refs = findContextReferences('#"Invoice parser" #"Invoice parser"', sessions);
    expect(refs).toHaveLength(1);
  });

  it("caps how many conversations one draft can cite", () => {
    const many = Array.from({ length: 9 }, (_, i) => `#"S${i}"`).join(" ");
    const rows = Array.from({ length: 9 }, (_, i) => ({
      id: `s${i}`,
      title: `S${i}`,
      messageCount: 2,
    }));
    expect(findContextReferences(many, rows)).toHaveLength(MAX_CONTEXT_REFERENCES);
  });

  it("leaves plain hashes alone", () => {
    expect(findContextReferences("issue #42", sessions)).toEqual([]);
  });
});

describe("buildContextReferenceBlock", () => {
  it("is empty without references", () => {
    expect(buildContextReferenceBlock([])).toBe("");
  });

  it("names every reference and says it is an excerpt", () => {
    const block = buildContextReferenceBlock([
      { id: "a", title: "Invoice parser", messageCount: 12 },
      { id: "b", title: "Rust build fix", messageCount: 1 },
    ]);
    expect(block).toContain('"Invoice parser" (12 messages)');
    expect(block).toContain('"Rust build fix" (1 message)');
    expect(block).toMatch(/not as summaries/);
  });

  it("carries the transcript tail when one is available", () => {
    const block = buildContextReferenceBlock([
      { id: "a", title: "Invoice parser", messageCount: 3, excerpt: "we settled on cents" },
    ]);
    expect(block).toContain('"we settled on cents"');
  });

  it("trims an oversized excerpt", () => {
    const block = buildContextReferenceBlock([
      {
        id: "a",
        title: "Long",
        messageCount: 3,
        excerpt: "x".repeat(MAX_CONTEXT_EXCERPT_CHARS + 50),
      },
    ]);
    expect(block).toContain("…");
    expect(block.length).toBeLessThanOrEqual(MAX_CONTEXT_BLOCK_CHARS + 40);
  });

  it("stays inside the block budget", () => {
    const refs = Array.from({ length: MAX_CONTEXT_REFERENCES }, (_, i) => ({
      id: `s${i}`,
      title: `Conversation number ${i}`,
      messageCount: 9,
      excerpt: "y".repeat(MAX_CONTEXT_EXCERPT_CHARS),
    }));
    expect(buildContextReferenceBlock(refs).length).toBeLessThanOrEqual(
      MAX_CONTEXT_BLOCK_CHARS,
    );
  });
});

describe("stripContextReferenceTokens", () => {
  it("removes tokens that resolved", () => {
    expect(
      stripContextReferenceTokens('compare with #"Invoice parser" please', ["Invoice parser"]),
    ).toBe("compare with please");
  });

  it("keeps a mistyped token visible", () => {
    expect(stripContextReferenceTokens('see #"typo"', ["Invoice parser"])).toBe('see #"typo"');
  });

  it("does nothing when nothing was referenced", () => {
    expect(stripContextReferenceTokens("plain text", [])).toBe("plain text");
  });
});
