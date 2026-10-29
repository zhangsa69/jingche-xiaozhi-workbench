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

import {
  canRecord,
  errorIsMissingDevice,
  errorIsPermissionDenial,
  transcribeRecording,
} from "../lib/voice-dictation";
import { startRecording, type VoiceRecorder } from "../lib/voice-recorder";

/**
 * A dictation longer than this is almost certainly a forgotten button. Stopping
 * on our own keeps the upload small and tells the user what happened, instead
 * of failing at the service's size limit minutes later.
 */
const MAX_RECORDING_MS = 120_000;

export type VoiceDictation = {
  status: VoiceState["status"];
  labelKey: string;
  /** Microphone open or request in flight: the button pulses. */
  live: boolean;
  /** Waiting on the transcription service: the button spins. */
  busy: boolean;
  disabled: boolean;
  press: () => void;
};

/**
 * One recorder per composer. Recording and uploading are sequential, so a press
 * during `transcribing` is ignored rather than queued: sending the audio twice
 * would append the same paragraph twice.
 */
export function useVoiceDictation(options: {
  onCommitted: (text: string) => void;
}): VoiceDictation {
  const available = useMemo(() => canRecord(), []);
  const [state, setState] = useState<VoiceState>(() => initialVoiceState(available));
  const stateRef = useRef(state);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const limitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommittedRef = useRef(options.onCommitted);
  onCommittedRef.current = options.onCommitted;

  const apply = useCallback((event: VoiceEvent): VoiceState => {
    const { state: next, committed } = voiceReduce(stateRef.current, event);
    stateRef.current = next;
    setState(next);
    if (committed) onCommittedRef.current(committed);
    return next;
  }, []);

  const clearLimit = useCallback(() => {
    if (limitRef.current !== null) {
      clearTimeout(limitRef.current);
      limitRef.current = null;
    }
  }, []);

  const discardRecorder = useCallback(async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    clearLimit();
    if (recorder) await recorder.cancel();
  }, [clearLimit]);

  const finishRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    clearLimit();
    if (!recorder) {
      apply({ type: "reset" });
      return;
    }

    const recording = await recorder.stop();
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

  const beginRecording = useCallback(async () => {
    try {
      const recorder = await startRecording();
      recorderRef.current = recorder;
      const next = apply({ type: "permission-granted" });
      // The press may have been cancelled while the device was opening; in that
      // case the microphone must close again rather than stay open unowned.
      if (next.status !== "listening") {
        recorderRef.current = null;
        await recorder.cancel();
        return;
      }
      limitRef.current = setTimeout(() => {
        limitRef.current = null;
        // Reaching the limit ends the recording the same way a second press
        // would, so the user still gets their text.
        apply({ type: "stop" });
        void finishRecording();
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
  }, [apply, finishRecording]);

  const press = useCallback(() => {
    const next = apply({ type: "press" });
    if (next.status === "requesting") {
      void beginRecording();
      return;
    }
    if (next.status === "transcribing") {
      void finishRecording();
      return;
    }
    if (next.status === "idle") {
      void discardRecorder();
    }
  }, [apply, beginRecording, discardRecorder, finishRecording]);

  // Leaving the page with the microphone open must close it.
  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (limitRef.current !== null) clearTimeout(limitRef.current);
      void recorder?.cancel();
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
