import { describe, expect, it } from "vitest";
import {
  INITIAL_VOICE_STATE,
  VOICE_EMPTY_REASON,
  initialVoiceState,
  insertDictation,
  normalizeTranscript,
  parseRecognizeResponse,
  voiceCanPress,
  voiceIsBusy,
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

const recording = [{ type: "press" as const }, { type: "permission-granted" as const }];

describe("initialVoiceState", () => {
  it("starts idle when the build can record", () => {
    expect(initialVoiceState(true).status).toBe("idle");
  });

  it("starts unsupported when it cannot, and stays unpressed", () => {
    const state = initialVoiceState(false);
    expect(state.status).toBe("unsupported");
    expect(voiceCanPress(state)).toBe(false);
    expect(voiceReduce(state, { type: "press" }).state.status).toBe("unsupported");
  });
});

describe("voiceReduce", () => {
  it("asks for the microphone before it records", () => {
    const { state } = run([{ type: "press" }]);
    expect(state.status).toBe("requesting");
    expect(voiceIsLive(state)).toBe(true);
  });

  it("lets a press cancel a request that has not opened the microphone yet", () => {
    // The device dialog can sit open for a while; the button must stay a way out.
    const { state } = run([{ type: "press" }, { type: "press" }]);
    expect(state.status).toBe("idle");
    expect(voiceCanPress(state)).toBe(true);
  });

  it("ignores a transcription arriving before the recording stopped", () => {
    const { state, committed } = run([
      ...recording,
      { type: "transcribed", text: "early" },
    ]);
    expect(state.status).toBe("listening");
    expect(committed).toEqual([]);
  });

  it("ends the recording on a second press and waits for the service", () => {
    const { state, committed } = run([...recording, { type: "press" }]);
    expect(state.status).toBe("transcribing");
    expect(voiceIsBusy(state)).toBe(true);
    expect(voiceIsLive(state)).toBe(false);
    expect(committed).toEqual([]);
    // The audio is already uploaded; a third press must not start a second run.
    expect(voiceCanPress(state)).toBe(false);
    expect(run([...recording, { type: "press" }, { type: "press" }]).state.status).toBe(
      "transcribing",
    );
  });

  it("commits the transcript once the service answers", () => {
    const { state, committed } = run([
      ...recording,
      { type: "press" },
      { type: "transcribed", text: "正 是 因 为 存 在 绝 对 正 义" },
    ]);
    expect(state.status).toBe("idle");
    expect(committed).toEqual(["正是因为存在绝对正义"]);
  });

  it("treats an empty transcript as a failure with its own label", () => {
    const { state, committed } = run([
      ...recording,
      { type: "press" },
      { type: "transcribed", text: "   " },
    ]);
    expect(state.status).toBe("error");
    expect(state.message).toBe(VOICE_EMPTY_REASON);
    expect(committed).toEqual([]);
    expect(voiceLabelKey(state)).toBe("voice.empty");
  });

  it("reports an unreachable service without blaming the microphone", () => {
    const { state } = run([
      ...recording,
      { type: "press" },
      { type: "transcribe-failed", message: "connect ECONNREFUSED" },
    ]);
    expect(state.status).toBe("error");
    expect(voiceLabelKey(state)).toBe("voice.unreachable");
    // A retry must be possible straight away.
    expect(voiceCanPress(state)).toBe(true);
  });

  it("remembers a refused microphone instead of pretending it recorded", () => {
    const { state } = run([{ type: "press" }, { type: "permission-denied" }]);
    expect(state.status).toBe("denied");
    expect(voiceLabelKey(state)).toBe("voice.denied");
  });

  it("treats a press after a failure as a retry", () => {
    const { state } = run([
      ...recording,
      { type: "press" },
      { type: "transcribe-failed", message: "boom" },
      { type: "press" },
    ]);
    expect(state.status).toBe("requesting");
    expect(state.message).toBeNull();
  });

  it("labels every state", () => {
    expect(voiceLabelKey(INITIAL_VOICE_STATE)).toBe("voice.start");
    expect(voiceLabelKey({ status: "listening", message: null })).toBe("voice.listening");
    expect(voiceLabelKey({ status: "transcribing", message: null })).toBe(
      "voice.transcribing",
    );
    expect(voiceLabelKey({ status: "requesting", message: null })).toBe("voice.requesting");
    expect(voiceLabelKey(initialVoiceState(false))).toBe("voice.unsupported");
  });
});

describe("normalizeTranscript", () => {
  it("removes the token spaces a Chinese engine emits", () => {
    expect(normalizeTranscript("正 是 因 为 存 在")).toBe("正是因为存在");
  });

  it("keeps spaces between latin words", () => {
    expect(normalizeTranscript("run git status")).toBe("run git status");
  });

  it("tightens spacing around Chinese punctuation", () => {
    expect(normalizeTranscript("好 的 ， 明 天 见 。")).toBe("好的，明天见。");
  });
});

describe("parseRecognizeResponse", () => {
  it("joins segments with a newline and keeps their speakers", () => {
    const parsed = parseRecognizeResponse({
      success: true,
      data: [
        { start: 0.1, time_range: [0.1, 4.6], text: "第 一 段", speaker: "说话人A" },
        { start: 5, time_range: [5, 9], text: "第 二 段", speaker: "说话人B" },
      ],
    });
    expect(parsed?.text).toBe("第一段\n第二段");
    expect(parsed?.segments.map((segment) => segment.speaker)).toEqual([
      "说话人A",
      "说话人B",
    ]);
  });

  it("returns null when the service reports a failure", () => {
    expect(parseRecognizeResponse({ success: false, error: "model not loaded" })).toBeNull();
    expect(parseRecognizeResponse({ nope: true })).toBeNull();
    expect(parseRecognizeResponse(null)).toBeNull();
  });

  it("drops empty segments instead of emitting blank lines", () => {
    const parsed = parseRecognizeResponse({
      success: true,
      data: [{ text: "  " }, { text: "有 字" }, { nope: 1 }],
    });
    expect(parsed?.text).toBe("有字");
    expect(parsed?.segments).toHaveLength(1);
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
