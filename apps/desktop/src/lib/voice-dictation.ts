/**
 * Bridge to the shell's speech recogniser (W-31).
 *
 * The recogniser belongs to the platform: Chromium exposes it only when the
 * build ships a speech service, so this module's first job is to answer
 * "is there one?" honestly. Everything the button does afterwards is decided by
 * the state machine in `@pi-desktop/shared`, not here.
 */

export type SpeechRecognitionResultEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      length: number;
      [index: number]: { transcript: string };
    };
  };
};

export type SpeechRecognitionErrorEvent = {
  error: string;
  message?: string;
};

export type SpeechRecognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type RecognizerConstructor = new () => SpeechRecognizer;

type SpeechWindow = {
  SpeechRecognition?: RecognizerConstructor;
  webkitSpeechRecognition?: RecognizerConstructor;
};

function speechWindow(): SpeechWindow | null {
  if (typeof window === "undefined") return null;
  return window as unknown as SpeechWindow;
}

export type SpeechEngine =
  | { available: true; create: () => SpeechRecognizer }
  | { available: false };

/**
 * Chromium on Linux and most Electron builds ship without the speech service;
 * `available: false` is the normal case, not an exotic one.
 */
export function resolveSpeechEngine(scope: SpeechWindow | null = speechWindow()): SpeechEngine {
  const ctor = scope?.SpeechRecognition ?? scope?.webkitSpeechRecognition;
  if (!ctor) return { available: false };
  return {
    available: true,
    create: () => new ctor(),
  };
}

/** The interim text of the newest result, which is what the button shows. */
export function interimTranscript(event: SpeechRecognitionResultEvent): string {
  let text = "";
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (result.isFinal) continue;
    text += result[0]?.transcript ?? "";
  }
  return text.trim();
}

/** Everything final in the event, joined — one utterance may land as several. */
export function finalTranscript(event: SpeechRecognitionResultEvent): string {
  let text = "";
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (!result.isFinal) continue;
    text += result[0]?.transcript ?? "";
  }
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A refused microphone is a state the user has to see; every other engine error
 * is reported as-is so a "device busy" is not mistaken for "you said no".
 */
export function errorIsPermissionDenial(error: string): boolean {
  return error === "not-allowed" || error === "service-not-allowed";
}
