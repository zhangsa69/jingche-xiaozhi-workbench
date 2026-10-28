import { describe, expect, it } from "vitest";
import {
  activeSessionTabAfterClose,
  closeSessionTab,
  hiddenSessionTabCount,
  MAX_SESSION_TABS,
  openSessionTab,
  pruneSessionTabs,
} from "./session-tabs.js";

describe("openSessionTab", () => {
  it("appends a new tab", () => {
    expect(openSessionTab(["a"], "b")).toEqual(["a", "b"]);
  });

  it("keeps an existing tab where it was", () => {
    expect(openSessionTab(["a", "b", "c"], "a")).toEqual(["a", "b", "c"]);
  });

  it("does not create a second tab for the same session", () => {
    expect(openSessionTab(["a", "b"], "b")).toEqual(["a", "b"]);
  });

  it("ignores an empty id and blank duplicates", () => {
    expect(openSessionTab([], "")).toEqual([]);
    expect(openSessionTab(["a", ""], "  ")).toEqual(["a"]);
  });

  it("normalises ids before comparing", () => {
    expect(openSessionTab(["a"], " a ")).toEqual(["a"]);
  });

  it("drops the oldest tab once the bar is full", () => {
    const tabs = ["a", "b", "c"];
    expect(openSessionTab(tabs, "d", 3)).toEqual(["b", "c", "d"]);
  });

  it("keeps the newest tab even when the limit is one", () => {
    expect(openSessionTab(["a"], "b", 1)).toEqual(["b"]);
  });

  it("does not mutate the array it is given", () => {
    const tabs = ["a"];
    openSessionTab(tabs, "b");
    expect(tabs).toEqual(["a"]);
  });

  it("defaults to the documented limit", () => {
    const tabs = Array.from({ length: MAX_SESSION_TABS }, (_, i) => `s${i}`);
    expect(openSessionTab(tabs, "next")).toHaveLength(MAX_SESSION_TABS);
    expect(openSessionTab(tabs, "next")[MAX_SESSION_TABS - 1]).toBe("next");
  });
});

describe("closeSessionTab", () => {
  it("removes only the named tab", () => {
    expect(closeSessionTab(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("is a no-op for an unknown id", () => {
    expect(closeSessionTab(["a"], "zzz")).toEqual(["a"]);
  });
});

describe("activeSessionTabAfterClose", () => {
  it("leaves the active tab alone when another tab closes", () => {
    expect(activeSessionTabAfterClose(["a", "b", "c"], "c", "a")).toBe("a");
  });

  it("hands the active slot to the right neighbour", () => {
    expect(activeSessionTabAfterClose(["a", "b", "c"], "b", "b")).toBe("c");
  });

  it("falls back to the left neighbour at the end of the bar", () => {
    expect(activeSessionTabAfterClose(["a", "b", "c"], "c", "c")).toBe("b");
  });

  it("reports nothing left when the last tab closes", () => {
    expect(activeSessionTabAfterClose(["a"], "a", "a")).toBeUndefined();
  });

  it("keeps the active id when the closed tab was never open", () => {
    expect(activeSessionTabAfterClose(["a"], "gone", "a")).toBe("a");
  });
});

describe("pruneSessionTabs", () => {
  it("forgets sessions that no longer exist", () => {
    expect(pruneSessionTabs(["a", "b", "c"], ["a", "c"])).toEqual(["a", "c"]);
  });

  it("drops duplicates while keeping order", () => {
    expect(pruneSessionTabs(["b", "a", "b"], ["a", "b"])).toEqual(["b", "a"]);
  });

  it("empties out when nothing is live", () => {
    expect(pruneSessionTabs(["a", "b"], [])).toEqual([]);
  });
});

describe("hiddenSessionTabCount", () => {
  it("counts only what the limit pushed off the bar", () => {
    expect(hiddenSessionTabCount(["a", "b", "c"], 5)).toBe(0);
    expect(hiddenSessionTabCount(["a", "b", "c"], 2)).toBe(1);
  });
});
