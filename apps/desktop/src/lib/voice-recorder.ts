/**
 * Microphone capture for dictation (W-31).
 *
 * The app records and streams; it does not ask the browser to recognise speech.
 * Audio is collected as float samples and handed out as 16-bit PCM frames, which
 * is what the streaming service consumes, and also kept whole so the HTTP
 * fallback has something to upload when the stream is unavailable.
 *
 * The processor is wired through a zero-gain node so monitoring stays silent:
 * connecting it straight to the destination would play the microphone back to
 * the user, which is both startling and a feedback risk.
 */
import {
  VOICE_SAMPLE_RATE,
  concatFloat32,
  encodeWavPcm16,
} from "@pi-desktop/shared";

/**
 * 60 ms at 16 kHz. FunASR's own client uses this frame size, and the service
 * prints text at roughly the same cadence, so smaller frames only add overhead.
 */
const FRAME_BYTES = 1_920;

export type VoiceRecording = {
  wav: Uint8Array;
  seconds: number;
};

export type VoiceRecorder = {
  /** Close the microphone and return the whole recording, or null if empty. */
  stop: () => Promise<VoiceRecording | null>;
  /** Close the microphone and discard whatever was captured. */
  cancel: () => Promise<void>;
};

export type RecordingOptions = {
  /** Called with 16 kHz 16-bit mono PCM, already grouped into whole frames. */
  onPcm?: (pcm: Uint8Array) => void;
};

function toPcm16(samples: Float32Array, target: Uint8Array, at: number): number {
  const view = new DataView(target.buffer, target.byteOffset + at);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return samples.length * 2;
}

export async function startRecording(
  options: RecordingOptions = {},
): Promise<VoiceRecorder> {
  if (!navigator.mediaDevices?.getUserMedia) {
    const error = new Error("microphone-unavailable");
    error.name = "NotSupportedError";
    throw error;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const context = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
  const source = context.createMediaStreamSource(stream);
  // 1024 samples ≈ 64 ms at 16 kHz: one frame per callback, no audible lag.
  const processor = context.createScriptProcessor(1024, 1, 1);
  const silence = context.createGain();
  silence.gain.value = 0;

  const chunks: Float32Array[] = [];
  let pending = new Uint8Array(FRAME_BYTES);
  let pendingAt = 0;
  const flush = (data: Uint8Array) => {
    options.onPcm?.(data);
  };

  processor.onaudioprocess = (event) => {
    // Copy: the input buffer is reused by the audio thread.
    const samples = new Float32Array(event.inputBuffer.getChannelData(0));
    chunks.push(samples);
    if (!options.onPcm) return;

    let offset = 0;
    while (offset < samples.length) {
      const room = FRAME_BYTES - pendingAt;
      const take = Math.min(room, samples.length - offset);
      pendingAt += toPcm16(samples.subarray(offset, offset + take), pending, pendingAt);
      offset += take;
      if (pendingAt === FRAME_BYTES) {
        flush(pending);
        pending = new Uint8Array(FRAME_BYTES);
        pendingAt = 0;
      }
    }
  };
  source.connect(processor);
  processor.connect(silence);
  silence.connect(context.destination);

  let closed = false;
  const teardown = async () => {
    if (closed) return;
    closed = true;
    processor.onaudioprocess = null;
    try {
      source.disconnect();
      processor.disconnect();
      silence.disconnect();
    } catch {
      // Already disconnected; nothing to undo.
    }
    for (const track of stream.getTracks()) track.stop();
    try {
      await context.close();
    } catch {
      // A closed context throws on the second close; the first one did the work.
    }
  };

  return {
    async stop() {
      await teardown();
      // The tail of the last frame is real audio; dropping it loses the last
      // syllable when the user stops on it.
      if (options.onPcm && pendingAt > 0) flush(pending.subarray(0, pendingAt));
      const samples = concatFloat32(chunks);
      if (samples.length === 0) return null;
      // `context.sampleRate` is what the device actually ran at; the service
      // resamples on its side.
      const rate = context.sampleRate || VOICE_SAMPLE_RATE;
      return {
        wav: encodeWavPcm16(samples, rate),
        seconds: samples.length / rate,
      };
    },
    async cancel() {
      await teardown();
    },
  };
}
