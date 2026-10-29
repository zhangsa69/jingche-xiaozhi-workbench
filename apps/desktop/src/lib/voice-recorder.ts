/**
 * Microphone capture for dictation (W-31).
 *
 * The app records and uploads; it does not ask the browser to recognise speech.
 * Audio is collected as float samples through a script processor and encoded as
 * PCM WAV, because the transcription service reads files with libsndfile and
 * cannot open the `webm/opus` container a `MediaRecorder` produces.
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

export type VoiceRecording = {
  wav: Uint8Array;
  seconds: number;
};

export type VoiceRecorder = {
  /** Close the microphone and return the recording, or null when it was empty. */
  stop: () => Promise<VoiceRecording | null>;
  /** Close the microphone and discard whatever was captured. */
  cancel: () => Promise<void>;
};

export async function startRecording(): Promise<VoiceRecorder> {
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
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silence = context.createGain();
  silence.gain.value = 0;

  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => {
    // Copy: the input buffer is reused by the audio thread.
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
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
      const samples = concatFloat32(chunks);
      if (samples.length === 0) return null;
      // `context.sampleRate` is what the device actually ran at; the service
      // resamples to 16 kHz on its side.
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
