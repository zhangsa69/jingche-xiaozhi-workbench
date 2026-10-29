/**
 * WAV encoding for dictation (W-31).
 *
 * The transcription service reads audio with libsndfile, which does not open
 * the `webm/opus` blob a `MediaRecorder` would produce. PCM WAV is the one
 * format every encoder and every service agrees on, and it is small enough at
 * 16 kHz mono for a spoken paragraph.
 */

/** 16 kHz mono is what the ASR models were trained on. */
export const VOICE_SAMPLE_RATE = 16_000;

const HEADER_BYTES = 44;

/** Append captured blocks into one buffer without growing a JS array. */
export function concatFloat32(chunks: readonly Float32Array[]): Float32Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/**
 * Encode mono float samples as a 16-bit PCM WAV.
 *
 * Clamping happens before scaling: a clipped sample must not wrap around to the
 * opposite sign, which is what an unchecked `sample * 32768` does.
 */
export function encodeWavPcm16(
  samples: Float32Array,
  sampleRate: number = VOICE_SAMPLE_RATE,
): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + samples.length * 2);
  const view = new DataView(bytes.buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      bytes[offset + index] = text.charCodeAt(index);
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(
      HEADER_BYTES + index * 2,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true,
    );
  }
  return bytes;
}

/** Seconds of audio a byte count represents, header included. */
export function wavDurationSeconds(
  byteLength: number,
  sampleRate: number = VOICE_SAMPLE_RATE,
): number {
  const samples = Math.max(0, byteLength - HEADER_BYTES) / 2;
  return samples / sampleRate;
}
