import { describe, expect, it } from "vitest";
import {
  EMPTY_TRANSCRIPT,
  accumulateTranscript,
  transcriptIsEmpty,
  transcriptText,
} from "./voice-stream.js";

const feed = (chunks: Parameters<typeof accumulateTranscript>[1][]) =>
  chunks.reduce(
    (acc, chunk) => {
      const next = accumulateTranscript(acc.transcript, chunk);
      return { transcript: next.transcript, seen: [...acc.seen, next.text] };
    },
    { transcript: EMPTY_TRANSCRIPT, seen: [] as string[] },
  );

describe("accumulateTranscript", () => {
  it("concatenates online fragments instead of replacing them", () => {
    // The service sends "正是因", "为存在", … — each one is new text, not a
    // revision of the previous one.
    const { transcript, seen } = feed([
      { kind: "online", text: "正是因" },
      { kind: "online", text: "为存在" },
      { kind: "online", text: "绝对正" },
    ]);
    expect(transcript.pending).toBe("正是因为存在绝对正");
    expect(seen.at(-1)).toBe("正是因为存在绝对正");
  });

  it("lets the finished sentence replace every fragment it covers", () => {
    const { transcript, seen } = feed([
      { kind: "online", text: "正是因" },
      { kind: "online", text: "为存在" },
      { kind: "offline", text: "正是因为存在绝对正义" },
    ]);
    expect(transcript.confirmed).toBe("正是因为存在绝对正义");
    expect(transcript.pending).toBe("");
    expect(seen.at(-1)).toBe("正是因为存在绝对正义");
    expect(transcriptText(transcript)).toBe("正是因为存在绝对正义");
  });

  it("continues with the next sentence after a finished one", () => {
    const { transcript } = feed([
      { kind: "online", text: "第一句" },
      { kind: "offline", text: "第一句。" },
      { kind: "online", text: "第二" },
      { kind: "online", text: "句" },
    ]);
    expect(transcriptText(transcript)).toBe("第一句。第二句");
  });

  it("drops the comma the service repeats at the start of the next sentence", () => {
    // Measured output: the second sentence arrives as "，但是不要因为…" while the
    // first already ended with a full stop.
    const { transcript } = feed([
      { kind: "offline", text: "第一句。" },
      { kind: "offline", text: "，但是不要" },
    ]);
    expect(transcript.confirmed).toBe("第一句。但是不要");
  });

  it("keeps leading punctuation when nothing precedes it", () => {
    const { transcript } = feed([{ kind: "offline", text: "，开头就是逗号" }]);
    expect(transcript.confirmed).toBe("，开头就是逗号");
  });

  it("removes the token spaces a Chinese engine emits", () => {
    const { transcript } = feed([
      { kind: "online", text: "正 是 因" },
      { kind: "offline", text: "正 是 因 为 存 在" },
    ]);
    expect(transcript.confirmed).toBe("正是因为存在");
  });

  it("ignores blank chunks without clearing what is already there", () => {
    const { transcript, seen } = feed([
      { kind: "online", text: "有字" },
      { kind: "online", text: "   " },
      { kind: "offline", text: "" },
    ]);
    expect(transcriptText(transcript)).toBe("有字");
    expect(seen.at(-1)).toBe("有字");
  });

  it("reports emptiness only when nothing was said", () => {
    expect(transcriptIsEmpty(EMPTY_TRANSCRIPT)).toBe(true);
    expect(transcriptIsEmpty(feed([{ kind: "online", text: "嗯" }]).transcript)).toBe(false);
  });
});
