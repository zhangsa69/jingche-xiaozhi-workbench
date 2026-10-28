import { describe, expect, it } from "vitest";
import {
  parseRepeatGuardQuestion,
  REPEAT_GUARD_PREFIX,
  repeatGuardQuestion,
  resolveRepeatGuardDecision,
} from "./repeat-guard.js";

describe("repeat guard token", () => {
  it("round-trips the tool and the attempt count", () => {
    const question = repeatGuardQuestion({ toolName: "Edit", attempts: 3 });
    expect(question).toBe(`${REPEAT_GUARD_PREFIX}Edit|3`);
    expect(parseRepeatGuardQuestion(question)).toEqual({
      toolName: "Edit",
      attempts: 3,
    });
  });

  it("keeps a tool name that contains a pipe", () => {
    expect(parseRepeatGuardQuestion(`${REPEAT_GUARD_PREFIX}a|b|4`)).toEqual({
      toolName: "a|b",
      attempts: 4,
    });
  });

  it("ignores anything that is not a well-formed token", () => {
    for (const question of [
      "",
      "Continue anyway?",
      REPEAT_GUARD_PREFIX,
      `${REPEAT_GUARD_PREFIX}Edit`,
      `${REPEAT_GUARD_PREFIX}Edit|`,
      `${REPEAT_GUARD_PREFIX}|3`,
      `${REPEAT_GUARD_PREFIX}Edit|three`,
      `${REPEAT_GUARD_PREFIX}Edit|1`,
    ]) {
      expect(parseRepeatGuardQuestion(question)).toBeNull();
    }
  });

  it("stops on everything except an explicit continue", () => {
    expect(resolveRepeatGuardDecision([["continue"]])).toBe("continue");
    expect(resolveRepeatGuardDecision([["stop"]])).toBe("stop");
    expect(resolveRepeatGuardDecision([[]])).toBe("stop");
    expect(resolveRepeatGuardDecision([null])).toBe("stop");
    expect(resolveRepeatGuardDecision(null)).toBe("stop");
    expect(resolveRepeatGuardDecision(undefined)).toBe("stop");
  });
});
