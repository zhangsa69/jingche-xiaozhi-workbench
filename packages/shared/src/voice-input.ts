/**
 * Voice dictation state machine (W-31).
 *
 * The app records locally and hands the audio to a transcription service; it
 * does not use the browser's speech recogniser. Chromium's engine uploads to a
 * service the app cannot reach from every network, and when that service is
 * unreachable it neither answers nor fails — measured behaviour was silence for
 * twenty seconds after `start()`. A local recorder plus an explicit HTTP call
 * turns that into a normal request with a normal error.
 *
 * What this module owns is the part that has to be right either way: what a
 * press may do in each state, when text is committed to the draft, and how a
 * failure is reported without losing the recording the user just made.
 */

export type VoiceStatus =
  | "unsupported"
  | "idle"
  | "requesting"
  | "listening"
  | "transcribing"
  | "denied"
  | "error";

export type VoiceEvent =
  | { type: "press" }
  | { type: "permission-granted" }
  | { type: "permission-denied" }
  /** The recogniser finished: the recording goes to the transcription service. */
  | { type: "stop" }
  | { type: "transcribed"; text: string }
  | { type: "transcribe-failed"; message?: string }
  | { type: "reset" };

export type VoiceState = {
  status: VoiceStatus;
  /** Why the last attempt failed; cleared on the next press. */
  message: string | null;
};

export const INITIAL_VOICE_STATE: VoiceState = {
  status: "idle",
  message: null,
};

/** Set in `message` when the service answered but heard nothing usable. */
export const VOICE_EMPTY_REASON = "empty";
/** Set in `message` when the request never reached the service. */
export const VOICE_UNREACHABLE_REASON = "unreachable";

export function initialVoiceState(engineAvailable: boolean): VoiceState {
  return engineAvailable
    ? INITIAL_VOICE_STATE
    : { status: "unsupported", message: null };
}

/**
 * Whether the button should be pressable. `requesting` is included so a press
 * that opened the microphone can be undone; `transcribing` is not, because that
 * request is already in flight and cancelling it would throw away the audio the
 * user just recorded.
 */
export function voiceCanPress(state: VoiceState): boolean {
  return (
    state.status === "idle" ||
    state.status === "requesting" ||
    state.status === "listening" ||
    state.status === "error" ||
    state.status === "denied"
  );
}

/**
 * Apply one event. `committed` is the text to append to the draft, if any —
 * returned separately so the caller never has to re-read state to know whether
 * something was said.
 */
export function voiceReduce(
  state: VoiceState,
  event: VoiceEvent,
): { state: VoiceState; committed: string } {
  switch (event.type) {
    case "press": {
      if (state.status === "unsupported") return { state, committed: "" };
      if (state.status === "transcribing") return { state, committed: "" };
      if (state.status === "requesting") {
        return { state: { status: "idle", message: null }, committed: "" };
      }
      // A second press while recording ends the recording and starts the upload;
      // any other press begins (or retries) a session.
      if (state.status === "listening") {
        return { state: { status: "transcribing", message: null }, committed: "" };
      }
      return { state: { status: "requesting", message: null }, committed: "" };
    }
    case "permission-granted": {
      if (state.status !== "requesting") return { state, committed: "" };
      return { state: { status: "listening", message: null }, committed: "" };
    }
    case "permission-denied": {
      if (state.status !== "requesting") return { state, committed: "" };
      return { state: { status: "denied", message: null }, committed: "" };
    }
    case "stop": {
      if (state.status !== "listening") return { state, committed: "" };
      return { state: { status: "transcribing", message: null }, committed: "" };
    }
    case "transcribed": {
      if (state.status !== "transcribing") return { state, committed: "" };
      const text = normalizeTranscript(event.text);
      if (!text) {
        return {
          state: { status: "error", message: VOICE_EMPTY_REASON },
          committed: "",
        };
      }
      return { state: { status: "idle", message: null }, committed: text };
    }
    case "transcribe-failed": {
      if (state.status !== "transcribing") return { state, committed: "" };
      return {
        state: {
          status: "error",
          message: event.message?.trim() || VOICE_UNREACHABLE_REASON,
        },
        committed: "",
      };
    }
    case "reset": {
      return {
        state: {
          status: state.status === "unsupported" ? "unsupported" : "idle",
          message: null,
        },
        committed: "",
      };
    }
    default:
      return { state, committed: "" };
  }
}

/** Whether the button shows a live dot (microphone open or request in flight). */
export function voiceIsLive(state: VoiceState): boolean {
  return state.status === "requesting" || state.status === "listening";
}

/** Whether the button shows a busy spinner while the audio is transcribed. */
export function voiceIsBusy(state: VoiceState): boolean {
  return state.status === "transcribing";
}

/** i18n key for the button tooltip, one per state. */
export function voiceLabelKey(state: VoiceState): string {
  switch (state.status) {
    case "unsupported":
      return "voice.unsupported";
    case "requesting":
      return "voice.requesting";
    case "listening":
      return "voice.listening";
    case "transcribing":
      return "voice.transcribing";
    case "denied":
      return "voice.denied";
    case "error":
      // "I heard nothing" and "I could not reach the service" need different
      // advice, so the reason decides the label.
      return state.message === VOICE_EMPTY_REASON
        ? "voice.empty"
        : "voice.unreachable";
    default:
      return "voice.start";
  }
}

/** One spoken stretch as the transcription service reports it. */
export type VoiceTranscribeSegment = {
  text: string;
  start: number;
  end: number;
  speaker?: string;
};

export type VoiceTranscribeRequest = {
  audio: Uint8Array;
  mimeType?: string;
};

export type VoiceTranscribeResult =
  | { ok: true; text: string; segments: VoiceTranscribeSegment[] }
  | { ok: false; error: string };

/**
 * Turn FunASR's `{ success, data: [{ text, speaker, time_range }] }` into one
 * draft-ready string.
 *
 * Segments are joined with a newline: the service already split them at pauses,
 * and running them into one line would hide that it heard two separate
 * utterances. A failure payload returns null so the caller reports the service's
 * own message instead of an empty transcript.
 */
export function parseRecognizeResponse(
  payload: unknown,
): { text: string; segments: VoiceTranscribeSegment[] } | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { success?: unknown; data?: unknown };
  if (record.success === false) return null;
  if (!Array.isArray(record.data)) return null;

  const segments: VoiceTranscribeSegment[] = [];
  for (const entry of record.data) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as {
      text?: unknown;
      speaker?: unknown;
      start?: unknown;
      time_range?: unknown;
    };
    if (typeof item.text !== "string") continue;
    const text = normalizeTranscript(item.text);
    if (!text) continue;
    const range = Array.isArray(item.time_range) ? item.time_range : [];
    const start = typeof item.start === "number" ? item.start : Number(range[0]) || 0;
    const end = Number(range[1]);
    segments.push({
      text,
      start,
      end: Number.isFinite(end) ? end : start,
      ...(typeof item.speaker === "string" && item.speaker
        ? { speaker: item.speaker }
        : {}),
    });
  }
  return { text: segments.map((segment) => segment.text).join("\n"), segments };
}

const CJK = "\\u3000-\\u303f\\u4e00-\\u9fff\\uff00-\\uffef";
const SPACE_BEFORE_CJK = new RegExp(`\\s+(?=[${CJK}])`, "g");
const SPACE_AFTER_CJK = new RegExp(`(?<=[${CJK}])\\s+`, "g");

/**
 * Clean a transcript from a token-per-word engine.
 *
 * FunASR returns "正 是 因 为" — one space per token. Chinese has no word
 * spaces, so those must go; English words keep theirs. Punctuation is CJK
 * punctuation, hence the same rule applies around it.
 */
export function normalizeTranscript(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(SPACE_BEFORE_CJK, "")
    .replace(SPACE_AFTER_CJK, "")
    .trim();
}

/**
 * Split text at the cursor so dictation lands where the caret is instead of
 * always at the end. Trailing spaces are trimmed inside the insert so a
 * dictation after a period does not produce a double space.
 */
export function insertDictation(
  value: string,
  cursor: number,
  text: string,
): { value: string; cursor: number } {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return { value, cursor };
  const at = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, at);
  const after = value.slice(at);
  const needsSpaceBefore = before.length > 0 && !/\s$/.test(before);
  const needsSpaceAfter = after.length > 0 && !/^\s/.test(after);
  const inserted = `${needsSpaceBefore ? " " : ""}${clean}${needsSpaceAfter ? " " : ""}`;
  return { value: `${before}${inserted}${after}`, cursor: at + inserted.length };
}
