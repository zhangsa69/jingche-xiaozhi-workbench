import { describe, expect, it } from "vitest";
import {
  INITIAL_VOICE_STATE,
  VOICE_TIMEOUT_REASON,
  initialVoiceState,
  insertDictation,
  voiceCanPress,
  voiceIsLive,
  voiceLabelKey,
  voiceReduce,
} from "./voice-input.js";

const run = (events: Parameters<typeof voiceReduce>[1][]) =>
  events.reduce(
    (acc, event) => {
      const next = voiceReduce(acc.state, event);
      return {
        state: next.state,
        committed: next.committed ? [...acc.committed, next.committed] : acc.committed,
      };
    },
    { state: INITIAL_VOICE_STATE, committed: [] as string[] },
  );

describe("initialVoiceState", () => {
  it("starts idle when the shell exposes a recogniser", () => {
    expect(initialVoiceState(true).status).toBe("idle");
  });

  it("starts unsupported when it does not, and stays unpressed", () => {
    const state = initialVoiceState(false);
    expect(state.status).toBe("unsupported");
    expect(voiceCanPress(state)).toBe(false);
    expect(voiceReduce(state, { type: "press" }).state.status).toBe("unsupported");
  });
});

describe("voiceReduce", () => {
  it("asks for permission before it listens", () => {
    const { state } = run([{ type: "press" }]);
    expect(state.status).toBe("requesting");
    expect(voiceIsLive(state)).toBe(true);
  });

  it("ignores a partial arriving before permission", () => {
    const { state } = run([{ type: "press" }, { type: "partial", text: "hi" }]);
    expect(state.partial).toBe("");
  });

  it("keeps partials live but commits only the final", () => {
    const { state, committed } = run([
      { type: "press" },
      { type: "permission-granted" },
      { type: "partial", text: "ship it" },
      { type: "partial", text: "shipped" },
      { type: "final", text: "shipped today" },
    ]);
    expect(state.status).toBe("idle");
    expect(state.partial).toBe("");
    expect(committed).toEqual(["shipped today"]);
  });

  it("commits nothing when the recogniser only produced partials", () => {
    const { committed } = run([
      { type: "press" },
      { type: "permission-granted" },
      { type: "partial", text: "half a thought" },
      { type: "stop" },
    ]);
    expect(committed).toEqual([]);
  });

  it("remembers a refusal instead of pretending it listened", () => {
    const { state } = run([{ type: "press" }, { type: "permission-denied" }]);
    expect(state.status).toBe("denied");
    expect(voiceLabelKey(state)).toBe("voice.denied");
  });

  it("treats a press after a failure as a retry", () => {
    const { state } = run([
      { type: "press" },
      { type: "permission-granted" },
      { type: "error", message: "device busy" },
      { type: "press" },
    ]);
    expect(state.status).toBe("requesting");
    expect(state.message).toBeNull();
  });

  it("ignores an error that arrives while idle", () => {
    const { state } = run([{ type: "error", message: "stale" }]);
    expect(state.status).toBe("idle");
    expect(state.message).toBeNull();
  });

  it("stops a live dictation on a second press", () => {
    const { state } = run([
      { type: "press" },
      { type: "permission-granted" },
      { type: "press" },
    ]);
    expect(state.status).toBe("idle");
    expect(voiceIsLive(state)).toBe(false);
  });

  it("drops a final that lands after the session ended", () => {
    const { committed } = run([
      { type: "press" },
      { type: "permission-granted" },
      { type: "press" },
      { type: "final", text: "late" },
    ]);
    expect(committed).toEqual([]);
  });

  it("labels every state", () => {
    expect(voiceLabelKey(INITIAL_VOICE_STATE)).toBe("voice.start");
    expect(voiceLabelKey({ status: "listening", partial: "", message: null })).toBe(
      "voice.listening",
    );
    expect(voiceLabelKey({ status: "error", partial: "", message: null })).toBe("voice.error");
    expect(voiceLabelKey(initialVoiceState(false))).toBe("voice.unsupported");
  });

  it("lets a press cancel a request the engine never answered", () => {
    // Chromium accepts `start()` and then stays silent when its remote speech
    // service is unreachable. The button has to stay pressable, or the user is
    // stuck in "requesting" until the composer remounts.
    const requesting = run([{ type: "press" }]).state;
    expect(voiceCanPress(requesting)).toBe(true);
    expect(run([{ type: "press" }, { type: "press" }]).state.status).toBe("idle");
  });

  it("reports a silent engine as unreachable, not as a microphone refusal", () => {
    const { state, committed } = run([
      { type: "press" },
      { type: "permission-granted" },
      { type: "partial", text: "半句话" },
      { type: "timeout" },
    ]);
    expect(state.status).toBe("error");
    expect(state.message).toBe(VOICE_TIMEOUT_REASON);
    expect(state.partial).toBe("");
    expect(committed).toEqual([]);
    expect(voiceLabelKey(state)).toBe("voice.unreachable");
    // The retry path must stay open after a timeout.
    expect(voiceCanPress(state)).toBe(true);
  });

  it("ignores a timeout once the session already ended", () => {
    const { state } = run([{ type: "timeout" }]);
    expect(state.status).toBe("idle");
  });
});

describe("insertDictation", () => {
  it("inserts at the caret, not at the end", () => {
    expect(insertDictation("hello world", 5, "there")).toEqual({
      value: "hello there world",
      cursor: 11,
    });
  });

  it("trims recogniser noise and does not double the spaces", () => {
    expect(insertDictation("hello ", 6, "  world  ")).toEqual({
      value: "hello world",
      cursor: 11,
    });
  });

  it("ignores empty transcripts", () => {
    expect(insertDictation("keep", 2, "   ")).toEqual({ value: "keep", cursor: 2 });
  });

  it("clamps a caret past the end", () => {
    expect(insertDictation("ab", 99, "c").value).toBe("ab c");
  });
});
