import { describe, expect, it } from "vitest";
import {
  DATASET_INDEX_LIMIT,
  appendDatasetIndexPrompt,
  buildDatasetIndexPrompt,
  normalizeDatasetPath,
  type DatasetIndexEntry,
} from "./dataset-index-prompt.js";

const folder = (name: string, path: string, itemCount?: number): DatasetIndexEntry => ({
  name,
  path,
  kind: "folder",
  ...(itemCount === undefined ? {} : { itemCount }),
});

const file = (name: string, path: string): DatasetIndexEntry => ({
  name,
  path,
  kind: "file",
});

describe("normalizeDatasetPath", () => {
  it("unifies separators and drops the trailing slash", () => {
    expect(normalizeDatasetPath("E:\\work\\pitch\\")).toBe("E:/work/pitch");
  });

  it("keeps roots intact", () => {
    expect(normalizeDatasetPath("/")).toBe("/");
    expect(normalizeDatasetPath("C:\\")).toBe("C:");
  });
});

describe("buildDatasetIndexPrompt", () => {
  it("returns nothing when nothing is mounted", () => {
    expect(buildDatasetIndexPrompt([])).toBe("");
  });

  it("lists a folder with its item count and a file without one", () => {
    const prompt = buildDatasetIndexPrompt([
      folder("Pitch archive", "E:/work/pitch", 12),
      file("House style", "E:/work/style.md"),
    ]);
    expect(prompt).toContain("- Pitch archive — E:/work/pitch (folder, 12 items)");
    expect(prompt).toContain("- House style — E:/work/style.md (file)");
  });

  it("says a single item, not 1 items", () => {
    expect(buildDatasetIndexPrompt([folder("One", "E:/one", 1)])).toContain("(folder, 1 item)");
  });

  it("frames entries as pointers rather than summaries", () => {
    const prompt = buildDatasetIndexPrompt([folder("Pitch", "E:/pitch")]);
    expect(prompt).toMatch(/a pointer,\s*not a summary/i);
  });

  it("keeps mount order instead of sorting by name", () => {
    const prompt = buildDatasetIndexPrompt([
      folder("Zebra", "E:/zebra"),
      folder("Alpha", "E:/alpha"),
    ]);
    expect(prompt.indexOf("Zebra")).toBeLessThan(prompt.indexOf("Alpha"));
  });

  it("drops duplicates that differ only by separators or case", () => {
    const prompt = buildDatasetIndexPrompt([
      folder("Pitch", "E:/Work/Pitch"),
      folder("Pitch again", "e:\\work\\pitch\\"),
    ]);
    expect(prompt.match(/- Pitch/g)).toHaveLength(1);
  });

  it("skips blank paths rather than printing a dash with nothing after it", () => {
    expect(buildDatasetIndexPrompt([folder("", "   ")])).toBe("");
  });

  it("counts what it did not list instead of trailing off", () => {
    const entries = Array.from({ length: 5 }, (_, index) => folder(`D${index}`, `E:/d${index}`));
    const prompt = buildDatasetIndexPrompt(entries, { limit: 2 });
    expect(prompt).toContain("D0");
    expect(prompt).not.toContain("D2 —");
    expect(prompt).toContain("…and 3 more datasets not listed.");
  });

  it("uses the singular for one hidden dataset", () => {
    const entries = [folder("A", "E:/a"), folder("B", "E:/b")];
    expect(buildDatasetIndexPrompt(entries, { limit: 1 })).toContain("…and 1 more dataset not listed.");
  });

  it("defaults to the shared limit", () => {
    const entries = Array.from({ length: DATASET_INDEX_LIMIT + 2 }, (_, index) =>
      folder(`D${index}`, `E:/d${index}`),
    );
    expect(buildDatasetIndexPrompt(entries)).toContain("…and 2 more datasets not listed.");
  });

  it("does not count a disabled limit as everything hidden", () => {
    const entries = [folder("A", "E:/a")];
    expect(buildDatasetIndexPrompt(entries, { limit: 0 })).toBe("");
  });
});

describe("appendDatasetIndexPrompt", () => {
  it("leaves the prompt untouched when nothing is mounted", () => {
    const base = "You are a careful editor.\n";
    expect(appendDatasetIndexPrompt(base, [])).toBe(base);
  });

  it("keeps the base prompt as a prefix and adds one blank line", () => {
    const base = "You are a careful editor.";
    const result = appendDatasetIndexPrompt(base, [folder("Pitch", "E:/pitch")]);
    expect(result.startsWith(base)).toBe(true);
    expect(result).toContain(`${base}\n\n## Mounted datasets`);
  });

  it("trims a trailing newline rather than stacking blank lines", () => {
    const result = appendDatasetIndexPrompt("Base.\n\n\n", [folder("Pitch", "E:/pitch")]);
    expect(result).toContain("Base.\n\n## Mounted datasets");
  });

  it("returns just the block when the base prompt is empty", () => {
    const result = appendDatasetIndexPrompt("", [folder("Pitch", "E:/pitch")]);
    expect(result.startsWith("## Mounted datasets")).toBe(true);
  });
});
