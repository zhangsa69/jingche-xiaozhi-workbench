import { describe, expect, it } from "vitest";
import {
  MAX_LIBRARY_SOURCES,
  addLibrarySource,
  librarySourceName,
  libraryStatus,
  matchLibrarySources,
  mergeLibraryCandidates,
  normalizeLibraryPath,
  removeLibrarySource,
  type LibrarySource,
} from "./library.js";

const folder = (path: string, now = 1): LibrarySource => ({
  id: `lib:${path.toLowerCase()}`,
  name: path.split("/").pop() ?? path,
  path,
  kind: "folder",
  addedAt: now,
});

describe("normalizeLibraryPath", () => {
  it("turns backslashes into slashes and drops trailing separators", () => {
    expect(normalizeLibraryPath("E:\\work\\notes\\")).toBe("E:/work/notes");
  });

  it("keeps drive and unix roots intact", () => {
    expect(normalizeLibraryPath("C:\\")).toBe("C:");
    expect(normalizeLibraryPath("/")).toBe("/");
  });

  it("collapses repeated separators so one folder is one entry", () => {
    expect(normalizeLibraryPath("E://work///notes")).toBe("E:/work/notes");
  });

  it("returns empty for blank input instead of inventing a path", () => {
    expect(normalizeLibraryPath("   ")).toBe("");
  });
});

describe("librarySourceName", () => {
  it("uses the last segment", () => {
    expect(librarySourceName("E:/work/design-system")).toBe("design-system");
  });

  it("falls back to the whole path when no segment remains", () => {
    expect(librarySourceName("C:")).toBe("C:");
  });
});

describe("addLibrarySource", () => {
  it("adds a source with a lower-cased identity", () => {
    const result = addLibrarySource([], { path: "E:/Work/Notes", kind: "folder", now: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.id).toBe("lib:e:/work/notes");
    expect(result.source.name).toBe("Notes");
    expect(result.source.addedAt).toBe(5);
  });

  it("refuses the same folder spelled with different separators or case", () => {
    const first = addLibrarySource([], { path: "E:/Work/Notes", kind: "folder" });
    if (!first.ok) throw new Error("setup failed");
    const again = addLibrarySource(first.sources, {
      path: "e:\\work\\notes\\",
      kind: "folder",
    });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason).toBe("duplicate");
    expect(again.sources).toHaveLength(1);
  });

  it("rejects a blank path", () => {
    const result = addLibrarySource([], { path: "  ", kind: "folder" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("empty");
  });

  it("stops at the cap rather than growing without bound", () => {
    const sources: LibrarySource[] = [];
    for (let index = 0; index < MAX_LIBRARY_SOURCES; index += 1) {
      const added = addLibrarySource(sources, { path: `E:/lib/${index}`, kind: "folder" });
      if (!added.ok) throw new Error("unexpected cap");
      sources.push(added.source);
    }
    const overflow = addLibrarySource(sources, { path: "E:/lib/overflow", kind: "folder" });
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.reason).toBe("limit");
  });
});

describe("removeLibrarySource", () => {
  it("removes only the named id", () => {
    const sources = [folder("E:/a"), folder("E:/b")];
    expect(removeLibrarySource(sources, "lib:e:/a").map((item) => item.path)).toEqual([
      "E:/b",
    ]);
  });
});

describe("matchLibrarySources", () => {
  const sources = [folder("E:/brand/voice"), folder("E:/data/voice-notes"), folder("E:/brand/logo")];

  it("keeps insertion order for a blank query", () => {
    expect(matchLibrarySources(sources, "  ").map((item) => item.path)).toEqual([
      "E:/brand/voice",
      "E:/data/voice-notes",
      "E:/brand/logo",
    ]);
  });

  it("ranks name prefix before name substring before path substring", () => {
    expect(matchLibrarySources(sources, "brand").map((item) => item.path)).toEqual([
      "E:/brand/voice",
      "E:/brand/logo",
    ]);
    expect(matchLibrarySources(sources, "voice").map((item) => item.path)).toEqual([
      "E:/brand/voice",
      "E:/data/voice-notes",
    ]);
  });

  it("is case insensitive so typing lower-case finds CamelCase folders", () => {
    expect(matchLibrarySources([folder("E:/Brand/Voice")], "brand")).toHaveLength(1);
  });
});

describe("mergeLibraryCandidates", () => {
  it("puts library entries first and drops workspace duplicates", () => {
    const merged = mergeLibraryCandidates(
      [
        { path: "E:/work/notes/today.md", kind: "file" },
        { path: "E:/work/readme.md", kind: "file" },
      ],
      [folder("E:/work/notes")],
      "",
      5,
    );
    expect(merged.library.map((entry) => entry.path)).toEqual(["E:/work/notes"]);
    // The folder itself is not in the index, so both files still show.
    expect(merged.workspace).toHaveLength(2);
  });

  it("does not offer a library file twice when the workspace index has it", () => {
    const merged = mergeLibraryCandidates(
      [{ path: "E:/work/readme.md", kind: "file" }],
      [{ ...folder("E:/work/readme.md"), kind: "file" }],
      "",
      5,
    );
    expect(merged.library).toHaveLength(1);
    expect(merged.workspace).toHaveLength(0);
  });

  it("respects the candidate limit per side", () => {
    const merged = mergeLibraryCandidates(
      Array.from({ length: 10 }, (_, index) => ({
        path: `E:/work/${index}.md`,
        kind: "file" as const,
      })),
      [folder("E:/lib/a"), folder("E:/lib/b")],
      "",
      2,
    );
    expect(merged.library).toHaveLength(2);
    expect(merged.workspace).toHaveLength(2);
  });
});

describe("libraryStatus", () => {
  it("is empty only when nothing was added", () => {
    expect(libraryStatus([])).toBe("empty");
    expect(libraryStatus([folder("E:/a")])).toBe("ready");
  });
});
