import {
  IPC,
  VOICE_EMPTY_REASON,
  VOICE_UNREACHABLE_REASON,
  parseRecognizeResponse,
  type VoiceTranscribeRequest,
  type VoiceTranscribeResult,
} from "@pi-desktop/shared";
import type { IpcRegistrar } from "./types";

/**
 * The transcription service the app was built against. It is a host setting,
 * not a renderer option: exposing the URL to the page would let any renderer
 * code make the main process POST to an address of its choosing.
 */
const DEFAULT_ENDPOINT = "http://10.120.65.148:10096";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 180_000;
const RECOGNIZE_PATH = "/api/recognize";

/** `PI_ASR_ENDPOINT` overrides the default for other deployments. */
export function resolveAsrEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PI_ASR_ENDPOINT?.trim();
  if (!raw) return DEFAULT_ENDPOINT;
  return raw.replace(/\/+$/, "");
}

type TranscribeOptions = {
  endpoint: string;
  audio: Uint8Array;
  mimeType?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/**
 * POST the recording to the service and flatten its segments.
 *
 * Every failure is returned as data rather than thrown: the button needs a
 * message it can show, and a rejected promise at an IPC boundary would only
 * surface as "Error invoking remote method".
 */
export async function transcribeAudio({
  endpoint,
  audio,
  mimeType = "audio/wav",
  timeoutMs = REQUEST_TIMEOUT_MS,
  fetchImpl = fetch,
}: TranscribeOptions): Promise<VoiceTranscribeResult> {
  if (audio.byteLength === 0) {
    return { ok: false, error: VOICE_EMPTY_REASON };
  }
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return { ok: false, error: "audio too large" };
  }

  const form = new FormData();
  // Copy into a fresh ArrayBuffer: the IPC payload may be a view with a
  // non-zero byte offset, which Blob would otherwise silently honour and send
  // the wrong window of bytes.
  const body = new Uint8Array(audio.byteLength);
  body.set(audio);
  form.append("audio", new Blob([body], { type: mimeType }), "dictation.wav");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${endpoint}${RECOGNIZE_PATH}`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const payload = (await response.json()) as unknown;
    const parsed = parseRecognizeResponse(payload);
    if (!parsed) {
      const reported =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error: unknown }).error)
          : VOICE_UNREACHABLE_REASON;
      return { ok: false, error: reported };
    }
    if (!parsed.text) {
      return { ok: false, error: VOICE_EMPTY_REASON };
    }
    return { ok: true, text: parsed.text, segments: parsed.segments };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === "AbortError"
          ? "timed out"
          : error.message
        : String(error);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/** W-31: local recording, host-side transcription. */
export function registerVoiceIpc({ registrar }: { registrar: IpcRegistrar }): void {
  registrar.handle(
    IPC.invoke.voiceTranscribe,
    async (input?: VoiceTranscribeRequest): Promise<VoiceTranscribeResult> => {
      const audio = input?.audio;
      if (!(audio instanceof Uint8Array)) {
        return { ok: false, error: "missing audio" };
      }
      return transcribeAudio({
        endpoint: resolveAsrEndpoint(),
        audio,
        ...(typeof input?.mimeType === "string" ? { mimeType: input.mimeType } : {}),
      });
    },
  );
}
