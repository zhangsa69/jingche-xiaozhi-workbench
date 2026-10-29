/**
 * Dictation transport (W-31).
 *
 * Two halves live here: "can this build record at all?" for the button's initial
 * state, and the upload call that turns a recording into text. The endpoint and
 * the HTTP request stay in the main process — the renderer only hands over bytes.
 */
import { api } from "./api";

/**
 * Recording needs `getUserMedia`. Unlike a speech recogniser, this is present in
 * every Electron build, so `false` now only means a platform without media
 * devices at all.
 */
export function canRecord(scope: { mediaDevices?: MediaDevices } | null = typeof navigator === "undefined" ? null : navigator): boolean {
  return Boolean(scope?.mediaDevices?.getUserMedia);
}

/** A refused microphone is a state the user has to see, not a generic failure. */
export function errorIsPermissionDenial(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  return name === "NotAllowedError" || name === "SecurityError";
}

/** A machine with no input device reports this instead of a permission error. */
export function errorIsMissingDevice(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { name?: unknown }).name === "NotFoundError",
  );
}

export type Transcription = { ok: true; text: string } | { ok: false; error: string };

export async function transcribeRecording(wav: Uint8Array): Promise<Transcription> {
  try {
    const result = await api.voiceTranscribe({ audio: wav, mimeType: "audio/wav" });
    return result.ok
      ? { ok: true, text: result.text }
      : { ok: false, error: result.error };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
