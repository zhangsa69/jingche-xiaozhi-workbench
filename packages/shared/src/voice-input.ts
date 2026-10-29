/**
 * Voice dictation state machine (W-31).
 *
 * The transcription engine is the platform's, not ours: the desktop shell either
 * exposes a speech recogniser or it does not. What this module owns is the part
 * that has to be right either way — what a press may do in each state, when text
 * is committed to the draft, and when a partial transcript must be thrown away.
 *
 * Partial text is never committed. A recogniser that revises "ship it" into
 * "shipped" would otherwise leave both words in the box, and the user has no way
 * to tell which one the model will read.
 */

export type VoiceStatus =
  | "unsupported"
  | "idle"
  | "requesting"
  | "listening"
  | "denied"
  | "error";

export type VoiceEvent =
  | { type: "press" }
  | { type: "permission-granted" }
  | { type: "permission-denied" }
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "stop" }
  /**
   * The recogniser accepted `start()` but then went quiet. Chromium's engine
   * uploads audio to a remote service, so a blocked or refused network looks
   * exactly like this: no result, no error, no end — forever.
   */
  | { type: "timeout" }
  | { type: "error"; message?: string }
  | { type: "reset" };

export type VoiceState = {
  status: VoiceStatus;
  /** Live, uncommitted transcript for the button's tooltip. */
  partial: string;
  /** Set when the engine reported a failure; cleared on the next press. */
  message: string | null;
};

export const INITIAL_VOICE_STATE: VoiceState = {
  status: "idle",
  partial: "",
  message: null,
};

export function initialVoiceState(
  engineAvailable: boolean,
): VoiceState {
  return engineAvailable
    ? INITIAL_VOICE_STATE
    : { status: "unsupported", partial: "", message: null };
}

/**
 * Whether the button should be pressable. `requesting` is included on purpose:
 * if the engine never answers, the press that started it must stay undoable —
 * a disabled button would trap the user in a state they cannot leave.
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
      if (state.status === "listening" || state.status === "requesting") {
        return {
          state: { status: "idle", partial: "", message: null },
          committed: "",
        };
      }
      // A press after a failure is a retry, not a second concurrent session.
      return {
        state: { status: "requesting", partial: "", message: null },
        committed: "",
      };
    }
    case "permission-granted": {
      if (state.status !== "requesting") return { state, committed: "" };
      return { state: { status: "listening", partial: "", message: null }, committed: "" };
    }
    case "permission-denied": {
      if (state.status !== "requesting") return { state, committed: "" };
      return {
        state: { status: "denied", partial: "", message: null },
        committed: "",
      };
    }
    case "partial": {
      if (state.status !== "listening") return { state, committed: "" };
      return { state: { ...state, partial: event.text }, committed: "" };
    }
    case "final": {
      if (state.status !== "listening") return { state, committed: "" };
      const text = event.text.replace(/\s+/g, " ").trim();
      return {
        state: { status: "idle", partial: "", message: null },
        committed: text,
      };
    }
    case "stop":
    case "reset": {
      return {
        state: {
          status: state.status === "unsupported" ? "unsupported" : "idle",
          partial: "",
          message: null,
        },
        committed: "",
      };
    }
    case "timeout": {
      if (state.status !== "requesting" && state.status !== "listening") {
        return { state, committed: "" };
      }
      return {
        state: { status: "error", partial: "", message: VOICE_TIMEOUT_REASON },
        committed: "",
      };
    }
    case "error": {
      // An error during a dictation ends it; an error while idle is stale news
      // and would otherwise replace the resting state with a permanent banner.
      if (state.status !== "requesting" && state.status !== "listening") {
        return { state, committed: "" };
      }
      return {
        state: {
          status: "error",
          partial: "",
          message: event.message ?? null,
        },
        committed: "",
      };
    }
    default:
      return { state, committed: "" };
  }
}

/** Whether the button shows a live dot. */
export function voiceIsLive(state: VoiceState): boolean {
  return state.status === "requesting" || state.status === "listening";
}

/** Sentinel stored in `message` when the engine never answered (see `timeout`). */
export const VOICE_TIMEOUT_REASON = "timeout";

/** i18n key for the button tooltip, one per state. */
export function voiceLabelKey(state: VoiceState): string {
  switch (state.status) {
    case "unsupported":
      return "voice.unsupported";
    case "requesting":
      return "voice.requesting";
    case "listening":
      return "voice.listening";
    case "denied":
      return "voice.denied";
    case "error":
      // A silent engine and a refused one need different advice: the first is
      // a network problem, the second is a microphone problem.
      return state.message === VOICE_TIMEOUT_REASON
        ? "voice.unreachable"
        : "voice.error";
    default:
      return "voice.start";
  }
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
