import { describe, expect, it } from "vitest";
import {
  MAX_PROMPT_LIBRARY_ENTRIES,
  MAX_PROMPT_LIBRARY_TAGS,
  PROMPT_RECALL_LIMIT,
  matchPrompts,
  normalizePromptTags,
  normalizePromptText,
  parsePromptLibrary,
  promptEntryId,
  promptLibraryStatus,
  promptRecallHistory,
  recallPrompt,
  recordPromptUsage,
  removePrompt,
  setPromptTags,
  togglePromptPinned,
  type PromptLibraryEntry,
} from "./prompt-library.js";

const record = (text: string, at = 1_000): PromptLibraryEntry[] =>
  recordPromptUsage([], text, at);

describe("normalizePromptText / promptEntryId", () => {
  it("collapses whitespace so the same prompt typed twice is one entry", () => {
    expect(normalizePromptText("  write\n a\ttest  ")).toBe("write a test");
    expect(promptEntryId(normalizePromptText("a  b"))).toBe(
      promptEntryId(normalizePromptText("a b")),
    );
  });

  it("gives different prompts different ids", () => {
    expect(promptEntryId("summarise this")).not.toBe(promptEntryId("summarise that"));
  });
});

describe("recordPromptUsage", () => {
  it("creates a pinned=false entry with a single use", () => {
    const [entry] = record("explain the diff");
    expect(entry).toMatchObject({ text: "explain the diff", uses: 1, pinned: false });
    expect(entry.tags).toEqual([]);
  });

  it("bumps uses and recency instead of adding a duplicate", () => {
    const first = record("explain the diff", 1_000);
    const second = recordPromptUsage(first, "explain  the diff", 5_000);
    expect(second).toHaveLength(1);
    expect(second[0].uses).toBe(2);
    expect(second[0].lastUsedAt).toBe(5_000);
  });

  it("keeps a pinned entry's pin and tags when it is used again", () => {
    let entries = record("ship the patch");
    const id = entries[0].id;
    entries = togglePromptPinned(entries, id);
    entries = setPromptTags(entries, id, ["release"]);
    const next = recordPromptUsage(entries, "ship the patch", 9_000);
    expect(next[0]).toMatchObject({ pinned: true, tags: ["release"], uses: 2 });
  });

  it("returns the same array for blank, slash-command and oversized prompts", () => {
    const entries = record("keep me");
    expect(recordPromptUsage(entries, "   ")).toBe(entries);
    expect(recordPromptUsage(entries, "/model opus")).toBe(entries);
    expect(recordPromptUsage(entries, "x".repeat(4_001))).toBe(entries);
  });

  it("orders the newest prompt first", () => {
    let entries = record("first", 1_000);
    entries = recordPromptUsage(entries, "second", 2_000);
    expect(entries.map((entry) => entry.text)).toEqual(["second", "first"]);
  });

  it("caps the library but never prunes a pinned entry", () => {
    let entries: PromptLibraryEntry[] = [];
    for (let index = 0; index < MAX_PROMPT_LIBRARY_ENTRIES; index += 1) {
      entries = recordPromptUsage(entries, `prompt ${index}`, index);
    }
    // Pinning the oldest entry means a prune has to take the next-oldest one.
    entries = togglePromptPinned(entries, entries[entries.length - 1].id);
    const overflow = recordPromptUsage(entries, "one more", 999_999);
    expect(overflow).toHaveLength(MAX_PROMPT_LIBRARY_ENTRIES);
    expect(overflow.some((entry) => entry.text === "prompt 0")).toBe(true);
    expect(overflow.some((entry) => entry.text === "prompt 1")).toBe(false);
    expect(overflow[0].text).toBe("one more");
  });
});

describe("pins, tags and removal", () => {
  it("toggles only the requested entry", () => {
    let entries = record("one");
    entries = recordPromptUsage(entries, "two", 2_000);
    const next = togglePromptPinned(entries, entries[0].id);
    expect(next[0].pinned).toBe(true);
    expect(next[1].pinned).toBe(false);
  });

  it("normalises tags: trim, dedupe case-insensitively, cap the count", () => {
    expect(normalizePromptTags([" Release ", "release", "", "QA"])).toEqual([
      "Release",
      "QA",
    ]);
    const many = Array.from({ length: 9 }, (_, index) => `t${index}`);
    expect(normalizePromptTags(many)).toHaveLength(MAX_PROMPT_LIBRARY_TAGS);
  });

  it("replaces the tag list of one entry only", () => {
    let entries = record("one");
    entries = recordPromptUsage(entries, "two", 2_000);
    const next = setPromptTags(entries, entries[0].id, ["a", "b"]);
    expect(next[0].tags).toEqual(["a", "b"]);
    expect(next[1].tags).toEqual([]);
  });

  it("removes an entry by id", () => {
    const entries = record("one");
    expect(removePrompt(entries, entries[0].id)).toEqual([]);
  });
});

describe("matchPrompts", () => {
  it("requires every token to match text or a tag", () => {
    let entries = record("translate the release notes to German");
    entries = recordPromptUsage(entries, "write unit tests for the parser", 2_000);
    const testsEntry = entries.find((entry) => entry.text.startsWith("write unit"));
    entries = setPromptTags(entries, testsEntry!.id, ["testing"]);
    expect(matchPrompts(entries, "translate german")).toHaveLength(1);
    expect(matchPrompts(entries, "translate testing")).toHaveLength(0);
    expect(matchPrompts(entries, "testing")).toHaveLength(1);
  });

  it("floats pinned entries above newer ones", () => {
    let entries = record("old but pinned", 1_000);
    entries = recordPromptUsage(entries, "newest", 9_000);
    entries = togglePromptPinned(entries, entries[1].id);
    expect(matchPrompts(entries, "").map((entry) => entry.text)).toEqual([
      "old but pinned",
      "newest",
    ]);
  });

  it("does not mutate the caller's array", () => {
    const entries = record("one");
    const before = entries.map((entry) => entry.text);
    matchPrompts(entries, "");
    expect(entries.map((entry) => entry.text)).toEqual(before);
  });
});

describe("promptLibraryStatus", () => {
  it("counts total and pinned and orders tags by usage", () => {
    let entries = record("one");
    entries = recordPromptUsage(entries, "two", 2_000);
    entries = setPromptTags(entries, entries[0].id, ["qa", "release"]);
    entries = setPromptTags(entries, entries[1].id, ["qa"]);
    entries = togglePromptPinned(entries, entries[0].id);
    expect(promptLibraryStatus(entries)).toEqual({
      total: 2,
      pinned: 1,
      tags: ["qa", "release"],
    });
  });
});

describe("recall", () => {
  it("builds a recency-ordered history for ArrowUp", () => {
    let entries = record("first", 1_000);
    entries = recordPromptUsage(entries, "second", 2_000);
    expect(promptRecallHistory(entries)).toEqual(["second", "first"]);
  });

  it("walks older one step at a time and stops at the oldest", () => {
    const history = ["third", "second", "first"];
    const first = recallPrompt(history, { text: "", anchor: null });
    expect(first).toEqual({ text: "third", anchor: "third" });
    const second = recallPrompt(history, { text: "third", anchor: "third" });
    expect(second).toEqual({ text: "second", anchor: "second" });
    const third = recallPrompt(history, { text: "second", anchor: "second" });
    expect(third).toEqual({ text: "first", anchor: "first" });
    expect(recallPrompt(history, { text: "first", anchor: "first" })).toBeNull();
  });

  it("refuses to resume after the user edited a recalled prompt", () => {
    // Two entries, anchored on the newest: stepping older here would discard
    // the edit, which is exactly what the guard exists to prevent.
    expect(
      recallPrompt(["two", "one"], { text: "two edited", anchor: "two" }),
    ).toBeNull();
    expect(
      recallPrompt(["hello"], { text: "hello there", anchor: "hello" }),
    ).toBeNull();
    expect(recallPrompt(["hello"], { text: "typed", anchor: null })).toBeNull();
  });

  it("returns to an empty draft when stepping past the newest entry", () => {
    expect(
      recallPrompt(["third", "second"], { text: "third", anchor: "third" }, "newer"),
    ).toEqual({ text: "", anchor: null });
  });

  it("returns null with an empty history or an unknown anchor", () => {
    expect(recallPrompt([], { text: "", anchor: null })).toBeNull();
    expect(recallPrompt(["a"], { text: "a", anchor: "gone" })).toBeNull();
  });

  it("respects the recall limit", () => {
    const entries = Array.from({ length: PROMPT_RECALL_LIMIT + 5 }, (_, index) =>
      recordPromptUsage([], `prompt ${index}`, index + 1)[0],
    );
    expect(promptRecallHistory(entries)).toHaveLength(PROMPT_RECALL_LIMIT);
  });
});

describe("parsePromptLibrary", () => {
  it("rebuilds valid entries and recomputes ids", () => {
    const parsed = parsePromptLibrary([
      { text: "  keep   me ", tags: [" A ", ""], pinned: true, uses: 3 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      text: "keep me",
      tags: ["A"],
      pinned: true,
      uses: 3,
    });
    expect(parsed[0].id).toBe(promptEntryId("keep me"));
  });

  it("drops unusable rows instead of throwing", () => {
    expect(
      parsePromptLibrary([
        null,
        "text",
        { text: 42 },
        { text: "   " },
        { text: "/model" },
      ]),
    ).toEqual([]);
    expect(parsePromptLibrary({ not: "an array" })).toEqual([]);
  });

  it("keeps the first of two entries with the same text", () => {
    const parsed = parsePromptLibrary([
      { text: "same", pinned: true },
      { text: "same  ", pinned: false },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].pinned).toBe(true);
  });

  it("coerces a non-boolean pin to false and a missing recency to createdAt", () => {
    const parsed = parsePromptLibrary([{ text: "one", pinned: "yes", createdAt: 10 }]);
    expect(parsed[0]).toMatchObject({ pinned: false, createdAt: 10, lastUsedAt: 10 });
  });
});
