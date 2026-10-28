/**
 * W-08: three rungs for a turn that has gone quiet.
 *
 * Silence is what makes people assume the app has hung, so the indicator
 * escalates in steps instead of repeating one line forever. The ladder only
 * ever moves up — a hint that could retreat would flicker between warnings
 * while the model retries behind the scenes, and each rung would be announced
 * more than once.
 */
export const SILENCE_RUNGS = [20, 45, 120] as const;

/** 0 = still normal, 1 = slow, 2 = very slow, 3 = likely stuck. */
export type SilenceLevel = 0 | 1 | 2 | 3;

/** `chat.*` keys for rungs 1–3, in escalation order. */
export const SILENCE_HINT_KEYS = [
  "chat.slowResponseHint",
  "chat.verySlowResponseHint",
  "chat.stalledResponseHint",
] as const;

/** Only used when a catalog is missing the key outright. */
export const SILENCE_HINT_FALLBACKS = [
  "Still waiting on the model — slower than usual. Keep waiting, or stop this reply.",
  "45 seconds with no output — that is unusually slow.",
  "Over two minutes with no output: this reply is likely stuck. Stop it and retry.",
] as const;

export function silenceLevel(elapsedSeconds: number): SilenceLevel {
  const seconds = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
  if (seconds >= SILENCE_RUNGS[2]) return 3;
  if (seconds >= SILENCE_RUNGS[1]) return 2;
  if (seconds >= SILENCE_RUNGS[0]) return 1;
  return 0;
}
