import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  initialVoiceState,
  voiceCanPress,
  voiceIsLive,
  voiceLabelKey,
  voiceReduce,
  type VoiceEvent,
  type VoiceState,
} from "@pi-desktop/shared";

import {
  errorIsPermissionDenial,
  finalTranscript,
  interimTranscript,
  resolveSpeechEngine,
  type SpeechRecognizer,
} from "../lib/voice-dictation";

/**
 * How long the button waits for the recogniser to say anything at all.
 *
 * Chromium's engine uploads audio to a remote service, so a blocked network is
 * silent rather than broken: `start()` succeeds, the microphone opens, and then
 * nothing. Ten seconds is long enough for a slow first result and short enough
 * that the button does not pulse forever with no explanation.
 */
const FIRST_RESULT_TIMEOUT_MS = 10_000;

export type VoiceDictation = {
  status: VoiceState["status"];
  labelKey: string;
  live: boolean;
  disabled: boolean;
  /** Uncommitted text, for the tooltip while the user is still speaking. */
  partial: string;
  press: () => void;
};

/**
 * One recogniser per composer. The engine is resolved once because a build
 * either has the speech service or does not; re-checking per press would only
 * make the button flicker between states.
 */
export function useVoiceDictation(options: {
  onCommitted: (text: string) => void;
  lang: string;
}): VoiceDictation {
  const engine = useMemo(() => resolveSpeechEngine(), []);
  const [state, setState] = useState<VoiceState>(() => initialVoiceState(engine.available));
  const stateRef = useRef(state);
  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommittedRef = useRef(options.onCommitted);
  onCommittedRef.current = options.onCommitted;
  const langRef = useRef(options.lang);
  langRef.current = options.lang;

  const apply = useCallback((event: VoiceEvent): VoiceState => {
    const { state: next, committed } = voiceReduce(stateRef.current, event);
    stateRef.current = next;
    setState(next);
    if (committed) onCommittedRef.current(committed);
    return next;
  }, []);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const releaseRecognizer = useCallback(() => {
    const recognizer = recognizerRef.current;
    recognizerRef.current = null;
    if (!recognizer) return;
    recognizer.onresult = null;
    recognizer.onerror = null;
    recognizer.onend = null;
    recognizer.abort();
  }, []);

  const stopListening = useCallback(() => {
    clearWatchdog();
    releaseRecognizer();
  }, [clearWatchdog, releaseRecognizer]);

  /**
   * Arm the silence timer. Every transcript event re-arms it, so a long
   * dictation is never cut off — only an engine that answers with nothing.
   */
  const armWatchdog = useCallback(() => {
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      watchdogRef.current = null;
      if (!voiceIsLive(stateRef.current)) return;
      // Stop the microphone first: leaving it open behind an error state would
      // keep the OS recording indicator lit after the feature gave up.
      releaseRecognizer();
      apply({ type: "timeout" });
    }, FIRST_RESULT_TIMEOUT_MS);
  }, [apply, clearWatchdog, releaseRecognizer]);

  const startRecognizer = useCallback(() => {
    if (!engine.available) return;
    releaseRecognizer();
    const recognizer = engine.create();
    recognizer.lang = langRef.current;
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.onresult = (event) => {
      // Any transcript — interim included — proves the service is reachable.
      clearWatchdog();
      const final = finalTranscript(event);
      if (final) {
        apply({ type: "final", text: final });
        return;
      }
      apply({ type: "partial", text: interimTranscript(event) });
      armWatchdog();
    };
    recognizer.onerror = (event) => {
      clearWatchdog();
      if (errorIsPermissionDenial(event.error)) {
        apply({ type: "permission-denied" });
        return;
      }
      apply({
        type: "error",
        message: event.message?.trim() || event.error,
      });
    };
    // The engine ends sessions on its own when it hears silence; leaving the
    // button pulsing after that would be a lie about the microphone.
    recognizer.onend = () => {
      clearWatchdog();
      if (voiceIsLive(stateRef.current)) apply({ type: "stop" });
    };
    recognizerRef.current = recognizer;
    try {
      recognizer.start();
    } catch (error) {
      // A throwing `start()` used to leave the state machine parked on
      // `requesting` with the button disabled — unrecoverable without a remount.
      releaseRecognizer();
      apply({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    apply({ type: "permission-granted" });
    armWatchdog();
  }, [apply, armWatchdog, clearWatchdog, engine, releaseRecognizer]);

  const press = useCallback(() => {
    const next = apply({ type: "press" });
    if (next.status === "requesting") {
      startRecognizer();
      return;
    }
    if (next.status === "idle") stopListening();
  }, [apply, startRecognizer, stopListening]);

  // Switching pages while the microphone is open must not leave it open.
  useEffect(
    () => () => {
      clearWatchdog();
      releaseRecognizer();
    },
    [clearWatchdog, releaseRecognizer],
  );

  return {
    status: state.status,
    labelKey: voiceLabelKey(state),
    live: voiceIsLive(state),
    disabled: !voiceCanPress(state),
    partial: state.partial,
    press,
  };
}
