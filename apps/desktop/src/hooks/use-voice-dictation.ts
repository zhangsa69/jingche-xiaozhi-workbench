import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  initialVoiceState,
  voiceCanPress,
  voiceIsBusy,
  voiceIsLive,
  voiceLabelKey,
  voiceReduce,
  type VoiceEvent,
  type VoiceState,
} from "@pi-desktop/shared";

import { api } from "../lib/api";
import {
  canRecord,
  errorIsMissingDevice,
  errorIsPermissionDenial,
  transcribeRecording,
} from "../lib/voice-dictation";
import { startRecording, type VoiceRecorder } from "../lib/voice-recorder";

/**
 * A dictation longer than this is almost certainly a forgotten button. Stopping
 * on our own keeps the session short and tells the user what happened.
 */
const MAX_RECORDING_MS = 120_000;

/**
 * The last PCM frame is flushed by the recorder, but the IPC call it starts is
 * asynchronous. Waiting a moment before asking for the final transcript keeps
 * the last syllable from being cut off by the stop request overtaking it.
 */
const TAIL_FLUSH_MS = 120;

export type VoiceDictation = {
  status: VoiceState["status"];
  labelKey: string;
  /** Microphone open or request in flight: the button pulses. */
  live: boolean;
  /** Waiting on the service: the button spins. */
  busy: boolean;
  disabled: boolean;
  press: () => void;
};

/**
 * Dictation as it happens: audio streams to the host while the user speaks, and
 * the assembled text is pushed back for display. The recording is also kept
 * whole, so a build whose stream cannot be reached still has a way to transcribe
 * — that path just waits until the user stops.
 */
export function useVoiceDictation(options: {
  /** Text to show right now; replaces the previous value for this session. */
  onInterim: (text: string) => void;
  /** Final text, committed once the session ends. */
  onCommitted: (text: string) => void;
}): VoiceDictation {
  const available = useMemo(() => canRecord(), []);
  const [state, setState] = useState<VoiceState>(() => initialVoiceState(available));
  const stateRef = useRef(state);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const limitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef(false);
  const bufferedRef = useRef<Uint8Array[]>([]);
  const onInterimRef = useRef(options.onInterim);
  onInterimRef.current = options.onInterim;
  const onCommittedRef = useRef(options.onCommitted);
  onCommittedRef.current = options.onCommitted;

  const apply = useCallback((event: VoiceEvent): VoiceState => {
    const { state: next, committed } = voiceReduce(stateRef.current, event);
    stateRef.current = next;
    setState(next);
    if (committed) onCommittedRef.current(committed);
    return next;
  }, []);

  // Live text arrives from the host while the session is open. It is displayed
  // but not committed: the draft only settles once the session ends, so a
  // revision cannot leave two versions of the same sentence behind.
  useEffect(() => {
    const off = api.onVoiceStream((update) => {
      if (update.type === "text") onInterimRef.current(update.text);
    });
    return off;
  }, []);

  const clearLimit = useCallback(() => {
    if (limitRef.current !== null) {
      clearTimeout(limitRef.current);
      limitRef.current = null;
    }
  }, []);

  const discard = useCallback(async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    clearLimit();
    bufferedRef.current = [];
    streamRef.current = false;
    await recorder?.cancel();
    void api.voiceStreamCancel();
  }, [clearLimit]);

  const sendFrame = useCallback((pcm: Uint8Array) => {
    if (!streamRef.current) {
      // Frames captured before the socket opened are sent once it does.
      if (bufferedRef.current.length < 64) bufferedRef.current.push(pcm);
      return;
    }
    void api.voiceStreamAudio({ pcm });
  }, []);

  const finish = useCallback(async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    clearLimit();
    const recording = recorder ? await recorder.stop() : null;

    if (streamRef.current) {
      streamRef.current = false;
      if (TAIL_FLUSH_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, TAIL_FLUSH_MS));
      }
      const result = await api.voiceStreamStop();
      if (result.ok) {
        apply({ type: "transcribed", text: result.text });
        return;
      }
      apply({ type: "transcribe-failed", message: result.error });
      return;
    }

    if (!recording) {
      apply({ type: "transcribe-failed", message: "empty" });
      return;
    }
    const result = await transcribeRecording(recording.wav);
    if (result.ok) {
      apply({ type: "transcribed", text: result.text });
      return;
    }
    apply({ type: "transcribe-failed", message: result.error });
  }, [apply, clearLimit]);

  const begin = useCallback(async () => {
    try {
      const recorder = await startRecording({ onPcm: sendFrame });
      recorderRef.current = recorder;
      const next = apply({ type: "permission-granted" });
      // The press may have been cancelled while the device was opening; in that
      // case the microphone must close again rather than stay open unowned.
      if (next.status !== "listening") {
        recorderRef.current = null;
        await recorder.cancel();
        return;
      }

      const started = await api
        .voiceStreamStart()
        .catch((error: unknown) => ({
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        }));
      streamRef.current = started.ok;
      if (started.ok) {
        const buffered = bufferedRef.current;
        bufferedRef.current = [];
        for (const pcm of buffered) void api.voiceStreamAudio({ pcm });
      }

      limitRef.current = setTimeout(() => {
        limitRef.current = null;
        apply({ type: "stop" });
        void finish();
      }, MAX_RECORDING_MS);
    } catch (error) {
      if (errorIsPermissionDenial(error)) {
        apply({ type: "permission-denied" });
        return;
      }
      apply({
        type: "transcribe-failed",
        message: errorIsMissingDevice(error)
          ? "no-input-device"
          : error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }, [apply, finish, sendFrame]);

  const press = useCallback(() => {
    const next = apply({ type: "press" });
    if (next.status === "requesting") {
      void begin();
      return;
    }
    if (next.status === "transcribing") {
      void finish();
      return;
    }
    if (next.status === "idle") {
      void discard();
    }
  }, [apply, begin, discard, finish]);

  // Leaving the page with the microphone open must close it.
  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (limitRef.current !== null) clearTimeout(limitRef.current);
      streamRef.current = false;
      void recorder?.cancel();
      void api.voiceStreamCancel();
    },
    [],
  );

  return {
    status: state.status,
    labelKey: voiceLabelKey(state),
    live: voiceIsLive(state),
    busy: voiceIsBusy(state),
    disabled: !voiceCanPress(state),
    press,
  };
}
