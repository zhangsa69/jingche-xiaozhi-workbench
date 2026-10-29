import { describe, expect, it } from "vitest";
import {
  VOICE_SAMPLE_RATE,
  concatFloat32,
  encodeWavPcm16,
  wavDurationSeconds,
} from "./voice-wav.js";

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

describe("encodeWavPcm16", () => {
  it("writes a mono 16-bit header the service can parse", () => {
    const wav = encodeWavPcm16(new Float32Array(16), 16_000);
    const view = new DataView(wav.buffer);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16); // bits
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(32);
    expect(wav.byteLength).toBe(44 + 32);
  });

  it("clamps instead of wrapping a clipped sample", () => {
    // -1 and +1 are the rails; a sample beyond them must not flip sign.
    const wav = encodeWavPcm16(new Float32Array([2, -2, 0]), 16_000);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
    expect(view.getInt16(48, true)).toBe(0);
  });

  it("keeps a full-scale negative sample at the rail", () => {
    const wav = encodeWavPcm16(new Float32Array([-1]), 16_000);
    expect(new DataView(wav.buffer).getInt16(44, true)).toBe(-0x8000);
  });
});

describe("concatFloat32", () => {
  it("joins blocks in order", () => {
    const merged = concatFloat32([
      new Float32Array([1, 2]),
      new Float32Array([3]),
      new Float32Array([4, 5]),
    ]);
    expect(Array.from(merged)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns an empty buffer for no blocks", () => {
    expect(concatFloat32([]).length).toBe(0);
  });
});

describe("wavDurationSeconds", () => {
  it("counts only the sample bytes", () => {
    // 16 kHz mono: 32 000 samples per second, so 2 seconds is 64 000 bytes + header.
    expect(wavDurationSeconds(44 + 64_000)).toBeCloseTo(2, 5);
    expect(wavDurationSeconds(44)).toBe(0);
  });

  it("honours a different rate", () => {
    expect(wavDurationSeconds(44 + 64_000, 32_000)).toBeCloseTo(1, 5);
    expect(VOICE_SAMPLE_RATE).toBe(16_000);
  });
});
