import { useCallback, useMemo, useRef, useState } from "react";
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

  const releaseRecognizer = useCallback(() => {
    const recognizer = recognizerRef.current;
    recognizerRef.current = null;
    if (!recognizer) return;
    recognizer.onresult = null;
    recognizer.onerror = null;
    recognizer.onend = null;
    recognizer.abort();
  }, []);

  const startRecognizer = useCallback(() => {
    if (!engine.available) return;
    releaseRecognizer();
    const recognizer = engine.create();
    recognizer.lang = langRef.current;
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.onresult = (event) => {
      const final = finalTranscript(event);
      if (final) {
        apply({ type: "final", text: final });
        return;
      }
      apply({ type: "partial", text: interimTranscript(event) });
    };
    recognizer.onerror = (event) => {
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
      if (voiceIsLive(stateRef.current)) apply({ type: "stop" });
    };
    recognizerRef.current = recognizer;
    recognizer.start();
    apply({ type: "permission-granted" });
  }, [apply, engine, releaseRecognizer]);

  const press = useCallback(() => {
    const next = apply({ type: "press" });
    if (next.status === "requesting") {
      startRecognizer();
      return;
    }
    if (next.status === "idle") releaseRecognizer();
  }, [apply, releaseRecognizer, startRecognizer]);

  return {
    status: state.status,
    labelKey: voiceLabelKey(state),
    live: voiceIsLive(state),
    disabled: !voiceCanPress(state),
    partial: state.partial,
    press,
  };
}
