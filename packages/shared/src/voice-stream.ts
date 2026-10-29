/**
 * Streaming transcript assembly (W-31).
 *
 * The 2pass service sends two kinds of text and they mean different things:
 *
 *   - `2pass-online` — a fragment of the sentence being spoken ("正是因",
 *     "为存在"). Fragments are concatenated; each one is new, not a revision.
 *   - `2pass-offline` — the finished sentence, punctuated. It replaces every
 *     fragment collected since the last sentence.
 *
 * A client that treats both as "the current text" shows a sentence twice, and a
 * client that treats `online` as a revision only ever shows the last fragment.
 * Measured on the deployed service: first fragment after ~1.6 s, then one every
 * ~0.65 s, and the offline sentence ~1.5 s after the speaker pauses.
 */
import { normalizeTranscript } from "./voice-input.js";

export type VoiceStreamChunk = {
  kind: "online" | "offline";
  text: string;
};

/** `confirmed` are punctuated sentences; `pending` is the fragment in progress. */
export type Transcript = {
  confirmed: string;
  pending: string;
};

export const EMPTY_TRANSCRIPT: Transcript = { confirmed: "", pending: "" };

/** What the user should see right now. */
export function transcriptText(transcript: Transcript): string {
  return `${transcript.confirmed}${transcript.pending}`;
}

const SENTENCE_END = /[。！？；：，、.!?;:,]$/;
const SENTENCE_START = /^[。！？；：，、.!?;:,]/;

/**
 * The service often prefixes a sentence with the comma that ended the previous
 * one ("，但是不要因为…"). Keeping both produces "，。" in the middle of the
 * draft, so a leading punctuation mark is dropped when a sentence already ended.
 */
function stripLeadingPunctuation(text: string, confirmed: string): string {
  if (!confirmed || !SENTENCE_END.test(confirmed)) return text;
  return text.replace(SENTENCE_START, "").trimStart();
}

/**
 * Absorb one chunk. Returns the new accumulator and the text to display, so the
 * caller never has to remember whether the last chunk was a fragment.
 */
export function accumulateTranscript(
  transcript: Transcript,
  chunk: VoiceStreamChunk,
): { transcript: Transcript; text: string } {
  const piece = normalizeTranscript(chunk.text);
  if (!piece) return { transcript, text: transcriptText(transcript) };

  if (chunk.kind === "online") {
    const next: Transcript = {
      confirmed: transcript.confirmed,
      pending: transcript.pending + piece,
    };
    return { transcript: next, text: transcriptText(next) };
  }

  const sentence = stripLeadingPunctuation(piece, transcript.confirmed);
  const next: Transcript = {
    confirmed: transcript.confirmed + sentence,
    // The finished sentence already contains every fragment it replaced.
    pending: "",
  };
  return { transcript: next, text: transcriptText(next) };
}

/** True when the transcript has nothing worth writing to the draft. */
export function transcriptIsEmpty(transcript: Transcript): boolean {
  return transcriptText(transcript).trim().length === 0;
}

/**
 * The host pushes the assembled text, not raw service messages: the renderer
 * only needs "what the draft should say now", and keeping the assembly on one
 * side means a reconnect can never splice two half-accumulators together.
 */
export type VoiceStreamUpdate =
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  | { type: "closed" };

export type VoiceStreamStartResult = { ok: true } | { ok: false; error: string };

export type VoiceStreamStopResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export type VoiceStreamAudioRequest = { pcm: Uint8Array };
