import WebSocket from "ws";
import {
  EMPTY_TRANSCRIPT,
  IPC,
  VOICE_EMPTY_REASON,
  VOICE_UNREACHABLE_REASON,
  accumulateTranscript,
  parseRecognizeResponse,
  transcriptIsEmpty,
  transcriptText,
  type Transcript,
  type VoiceStreamAudioRequest,
  type VoiceStreamStartResult,
  type VoiceStreamStopResult,
  type VoiceStreamUpdate,
  type VoiceTranscribeRequest,
  type VoiceTranscribeResult,
} from "@pi-desktop/shared";
import type { IpcRegistrar } from "./types";

/**
 * Transcription services the app was built against. They are host settings, not
 * renderer options: exposing the URL to the page would let any renderer code
 * make the main process talk to an address of its choosing.
 *
 * The streaming endpoint is preferred — it is what puts words in the draft while
 * the user is still speaking. The HTTP endpoint stays as the fallback for builds
 * where the stream cannot be reached, at the cost of waiting for the whole
 * recording.
 */
const DEFAULT_HTTP_ENDPOINT = "http://10.120.65.148:10096";
const DEFAULT_STREAM_ENDPOINT = "wss://10.120.65.148:10095";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 180_000;
const RECOGNIZE_PATH = "/api/recognize";

/** How long the socket may take to open before the stream is called dead. */
const STREAM_OPEN_TIMEOUT_MS = 8_000;
/**
 * After `is_speaking: false`, the service sends the last fragments and the final
 * sentence, then goes quiet. Measured: the last sentence arrived 0.7 s after the
 * request, and nothing followed. A second of silence is long enough to be sure
 * and short enough that "stop" feels like it stops.
 */
const STREAM_GRACE_MS = 1_000;
/** A service that never settles must not hold the button hostage. */
const STREAM_FINALIZE_TIMEOUT_MS = 12_000;

/**
 * 16 kHz 16-bit mono, 60 ms per frame — the cadence FunASR's own client uses.
 * Anything is accepted by the service, but matching it keeps latency predictable.
 */
const STREAM_FRAME_BYTES = 1_920;

export function resolveAsrEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PI_ASR_ENDPOINT?.trim();
  if (!raw) return DEFAULT_HTTP_ENDPOINT;
  return raw.replace(/\/+$/, "");
}

export function resolveAsrStreamEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PI_ASR_STREAM_ENDPOINT?.trim();
  if (!raw) return DEFAULT_STREAM_ENDPOINT;
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
 * POST a finished recording to the service and flatten its segments.
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
  // Copy into a fresh ArrayBuffer: the IPC payload may be a view with a non-zero
  // byte offset, which Blob would otherwise honour and send the wrong window.
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

/**
 * The slice of `WebContents` the stream needs. Narrowed so the session can be
 * driven by a test harness without spinning up a window.
 */
export type StreamSender = {
  isDestroyed: () => boolean;
  send: (channel: string, payload: unknown) => void;
};

type StreamSession = {
  socket: WebSocket;
  sender: StreamSender;
  transcript: Transcript;
  stopRequested: boolean;
  settled: boolean;
  resolveStop: ((result: VoiceStreamStopResult) => void) | null;
  graceTimer: NodeJS.Timeout | null;
  finalTimer: NodeJS.Timeout | null;
};

let active: StreamSession | null = null;
/**
 * The result of the last session that settled on its own. Without it, a session
 * the service closed after a pause would make the user's "stop" press report an
 * empty transcript even though words are already in the draft.
 */
let lastSettled: VoiceStreamStopResult | null = null;

function push(session: StreamSession, update: VoiceStreamUpdate): void {
  if (session.sender.isDestroyed()) return;
  session.sender.send(IPC.event.voiceStreamText, update);
}

function clearTimers(session: StreamSession): void {
  if (session.graceTimer) clearTimeout(session.graceTimer);
  if (session.finalTimer) clearTimeout(session.finalTimer);
  session.graceTimer = null;
  session.finalTimer = null;
}

function settle(session: StreamSession, result: VoiceStreamStopResult): void {
  if (session.settled) return;
  session.settled = true;
  clearTimers(session);
  if (active === session) active = null;
  lastSettled = result;
  try {
    session.socket.close();
  } catch {
    // Already closed; nothing to do.
  }
  session.resolveStop?.(result);
  session.resolveStop = null;
}

function settleWithTranscript(session: StreamSession): void {
  const text = transcriptText(session.transcript);
  settle(
    session,
    transcriptIsEmpty(session.transcript)
      ? { ok: false, error: VOICE_EMPTY_REASON }
      : { ok: true, text },
  );
}

/**
 * The service answers a `is_speaking: false` with the remaining fragments and
 * the last sentence, but never says "done". A trailing silence is the only
 * signal available, so each arriving message pushes the deadline out.
 */
function armGrace(session: StreamSession): void {
  if (session.graceTimer) clearTimeout(session.graceTimer);
  session.graceTimer = setTimeout(() => settleWithTranscript(session), STREAM_GRACE_MS);
}

function handleMessage(session: StreamSession, raw: string): void {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  if (!payload || typeof payload !== "object") return;
  const message = payload as { mode?: unknown; text?: unknown };
  if (message.mode === "error") {
    const detail = typeof message.text === "string" ? message.text : "service error";
    push(session, { type: "error", message: detail });
    return;
  }
  if (typeof message.text !== "string" || !message.text.trim()) return;

  const kind =
    message.mode === "2pass-offline" || message.mode === "offline"
      ? "offline"
      : "online";
  const { transcript, text } = accumulateTranscript(session.transcript, {
    kind,
    text: message.text,
  });
  session.transcript = transcript;
  push(session, { type: "text", text });
  if (session.stopRequested) armGrace(session);
}

export async function startStreamSession(
  sender: StreamSender,
  endpoint: string = resolveAsrStreamEndpoint(),
): Promise<VoiceStreamStartResult> {
  await cancelSession();
  lastSettled = null;
  return new Promise((resolve) => {
    let settled = false;
    const socket = new WebSocket(endpoint, {
      // The deployed service uses a self-signed certificate that has also
      // expired. This connection is pinned to one host the operator configured,
      // so certificate verification is not what protects it.
      rejectUnauthorized: false,
      handshakeTimeout: STREAM_OPEN_TIMEOUT_MS,
    });
    const session: StreamSession = {
      socket,
      sender,
      transcript: EMPTY_TRANSCRIPT,
      stopRequested: false,
      settled: false,
      resolveStop: null,
      graceTimer: null,
      finalTimer: null,
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimers(session);
      if (active === session) active = null;
      try {
        socket.terminate();
      } catch {
        // Ignore: the socket never opened.
      }
      resolve({ ok: false, error: message });
    };

    socket.on("open", () => {
      if (settled) return;
      settled = true;
      active = session;
      // `2pass` is the mode that yields both the live fragments and the
      // punctuated sentence at each pause.
      socket.send(
        JSON.stringify({
          mode: "2pass",
          chunk_size: [5, 10, 5],
          chunk_interval: 10,
          wav_name: "pi-desktop",
          wav_format: "pcm",
          audio_fs: 16_000,
          is_speaking: true,
          itn: true,
        }),
      );
      resolve({ ok: true });
    });

    socket.on("message", (data) => handleMessage(session, data.toString()));

    socket.on("error", (error) => {
      if (!settled) {
        fail(error.message);
        return;
      }
      push(session, { type: "error", message: error.message });
      settle(session, { ok: false, error: error.message });
    });

    socket.on("close", () => {
      if (!settled) {
        fail(VOICE_UNREACHABLE_REASON);
        return;
      }
      push(session, { type: "closed" });
      settleWithTranscript(session);
    });

    setTimeout(() => {
      if (!settled) fail(`${VOICE_UNREACHABLE_REASON}: timed out`);
    }, STREAM_OPEN_TIMEOUT_MS + 500);
  });
}

export function sendStreamAudio(pcm: Uint8Array): { ok: boolean } {
  const session = active;
  if (!session || session.socket.readyState !== WebSocket.OPEN) {
    return { ok: false };
  }
  if (pcm.byteLength === 0) return { ok: true };
  const buffer = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  // The service takes whatever frame size it is given, but 60 ms keeps the
  // displayed text moving at the pace the user is speaking.
  for (let offset = 0; offset < buffer.byteLength; offset += STREAM_FRAME_BYTES) {
    session.socket.send(buffer.subarray(offset, offset + STREAM_FRAME_BYTES));
  }
  return { ok: true };
}

export async function stopStreamSession(): Promise<VoiceStreamStopResult> {
  const session = active;
  if (!session) return lastSettled ?? { ok: false, error: VOICE_EMPTY_REASON };
  if (session.settled) return { ok: true, text: transcriptText(session.transcript) };

  session.stopRequested = true;
  try {
    session.socket.send(JSON.stringify({ is_speaking: false }));
  } catch (error) {
    settle(session, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: VOICE_UNREACHABLE_REASON };
  }

  return new Promise((resolve) => {
    session.resolveStop = resolve;
    // Two timers with different jobs: grace settles once the service goes
    // quiet, finalize gives up on a service that keeps talking or never does.
    armGrace(session);
    session.finalTimer = setTimeout(
      () => settleWithTranscript(session),
      STREAM_FINALIZE_TIMEOUT_MS,
    );
  });
}

async function cancelSession(): Promise<void> {
  const session = active;
  if (!session) return;
  active = null;
  session.settled = true;
  clearTimers(session);
  try {
    session.socket.close();
  } catch {
    // Already closed.
  }
  session.resolveStop?.({ ok: false, error: "cancelled" });
  session.resolveStop = null;
}

/** W-31: streaming dictation, with the HTTP upload kept as a fallback. */
export function registerVoiceIpc({ registrar }: { registrar: IpcRegistrar }): void {
  registrar.handleWithEvent(
    IPC.invoke.voiceStreamStart,
    async (event): Promise<VoiceStreamStartResult> => {
      registrar.assertMainWindowSender(event);
      return startStreamSession(event.sender, resolveAsrStreamEndpoint());
    },
  );

  registrar.handle(
    IPC.invoke.voiceStreamAudio,
    async (input?: VoiceStreamAudioRequest): Promise<{ ok: boolean }> => {
      const pcm = input?.pcm;
      if (!(pcm instanceof Uint8Array)) return { ok: false };
      return sendStreamAudio(pcm);
    },
  );

  registrar.handle(
    IPC.invoke.voiceStreamStop,
    async (): Promise<VoiceStreamStopResult> => stopStreamSession(),
  );

  registrar.handle(IPC.invoke.voiceStreamCancel, async (): Promise<{ ok: true }> => {
    await cancelSession();
    return { ok: true };
  });

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
