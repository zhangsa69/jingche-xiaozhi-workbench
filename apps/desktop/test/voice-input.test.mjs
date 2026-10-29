import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(here, relative), "utf8");

const shared = read("../../../packages/shared/src/voice-input.ts");
const wav = read("../../../packages/shared/src/voice-wav.ts");
const hook = read("../src/hooks/use-voice-dictation.ts");
const recorder = read("../src/lib/voice-recorder.ts");
const dictation = read("../src/lib/voice-dictation.ts");
const api = read("../src/lib/api.ts");
const protocol = read("../../../packages/shared/src/protocol.ts");
const ipc = read("../electron/main/ipc/voice-ipc.ts");
const register = read("../electron/main/ipc/register.ts");
const toolbar = read("../src/features/chat/composer/ComposerToolbar.tsx");
const css = read("../src/styles/composer.css");

const LOCALES = ["en", "de", "es", "fr", "ko", "tr", "zh-CN", "zh-TW"];
const KEYS = [
  "start",
  "listening",
  "transcribing",
  "requesting",
  "denied",
  "error",
  "unreachable",
  "empty",
  "unsupported",
];

test("dictation records locally instead of asking the browser to recognise", () => {
  // The browser recogniser uploads to a service that is unreachable from some
  // networks and then neither answers nor fails; measurement showed 20 s of
  // silence after start(). Nothing in the dictation path may depend on it.
  assert.doesNotMatch(hook, /SpeechRecognition|webkitSpeechRecognition/);
  assert.doesNotMatch(dictation, /SpeechRecognition|webkitSpeechRecognition/);
  assert.match(recorder, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(recorder, /createScriptProcessor/);
  assert.match(recorder, /encodeWavPcm16/);
});

test("the recording is silent to the user", () => {
  // Connecting the processor straight to the destination would play the
  // microphone back — startling, and a feedback loop on speakers.
  assert.match(recorder, /const silence = context\.createGain\(\);/);
  assert.match(recorder, /silence\.gain\.value = 0;/);
  assert.match(recorder, /processor\.connect\(silence\);/);
});

test("the microphone is always closed again", () => {
  assert.match(recorder, /for \(const track of stream\.getTracks\(\)\) track\.stop\(\);/);
  assert.match(recorder, /await context\.close\(\)/);
  assert.match(hook, /useEffect\(\s*\(\) => \(\) => \{[\s\S]*?void recorder\?\.cancel\(\);/);
  // A cancelled open (device dialog still up) must not leave the mic running.
  assert.match(hook, /if \(next\.status !== "listening"\) \{[\s\S]*?await recorder\.cancel\(\);/);
});

test("a long recording ends on its own instead of growing without bound", () => {
  assert.match(hook, /const MAX_RECORDING_MS = \d+_?\d*;/);
  assert.match(hook, /apply\(\{ type: "stop" \}\);\s*void finishRecording\(\);/);
});

test("the transcript reaches the draft through the state machine only", () => {
  assert.match(hook, /if \(committed\) onCommittedRef\.current\(committed\);/);
  assert.match(shared, /export function normalizeTranscript/);
  assert.match(shared, /export function parseRecognizeResponse/);
  // Token spaces from FunASR must be removed before the text is committed.
  assert.match(shared, /case "transcribed": \{[\s\S]*?const text = normalizeTranscript\(event\.text\);/);
});

test("the service endpoint belongs to the host, not the page", () => {
  // A renderer-supplied URL would turn this channel into a request forger.
  assert.match(protocol, /voiceTranscribe: "pi-desktop\/voice\/transcribe"/);
  assert.match(ipc, /const DEFAULT_ENDPOINT = "http:\/\/10\.120\.65\.148:10096";/);
  // The renderer's request carries bytes and a mime type — never a URL.
  assert.match(
    shared,
    /export type VoiceTranscribeRequest = \{\s*audio: Uint8Array;\s*mimeType\?: string;\s*\};/,
  );
  assert.match(ipc, /type TranscribeOptions = \{[\s\S]*?endpoint: string;/);
  assert.match(register, /registerVoiceIpc\(\{ registrar \}\);/);
  assert.match(api, /voiceTranscribe: \(request: VoiceTranscribeRequest\) =>/);
});

test("the upload posts a wav file to the recognise endpoint", () => {
  assert.match(ipc, /const RECOGNIZE_PATH = "\/api\/recognize";/);
  assert.match(ipc, /form\.append\("audio", new Blob\(\[body\], \{ type: mimeType \}\), "dictation\.wav"\);/);
  // A Uint8Array view can carry a byte offset; copying keeps the sent window right.
  assert.match(ipc, /const body = new Uint8Array\(audio\.byteLength\);\s*body\.set\(audio\);/);
  assert.match(ipc, /const MAX_AUDIO_BYTES = \d+ \* 1024 \* 1024;/);
  assert.match(ipc, /const controller = new AbortController\(\);/);
});

test("failures come back as data so the button can explain itself", () => {
  assert.match(ipc, /return \{ ok: false, error: VOICE_EMPTY_REASON \};/);
  assert.match(ipc, /return \{ ok: false, error: `HTTP \$\{response\.status\}` \};/);
  assert.match(ipc, /error\.name === "AbortError"\s*\?\s*"timed out"/);
  assert.match(dictation, /errorIsPermissionDenial/);
  assert.match(dictation, /errorIsMissingDevice/);
});

test("the button distinguishes listening, transcribing and failure", () => {
  assert.match(toolbar, /voice\.live \? " is-live" : ""/);
  assert.match(toolbar, /voice\.busy \? " is-busy" : ""/);
  assert.match(toolbar, /aria-busy=\{voice\.busy\}/);
  assert.match(css, /\.composer-voice-btn\.is-busy svg \{[\s\S]*?animation: composer-voice-spin/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.composer-voice-btn\.is-busy svg \{\s*animation: none;/);
});

test("every locale carries the dictation labels", () => {
  for (const locale of LOCALES) {
    const source = read(`../../../packages/i18n/src/locales/${locale}/index.ts`);
    for (const key of KEYS) {
      assert.match(
        source,
        new RegExp(`^\\s+"?${key}"?:\\s*"`, "m"),
        `${locale} is missing voice.${key}`,
      );
    }
  }
});

test("the wav encoder is the one the service expects", () => {
  assert.match(wav, /export const VOICE_SAMPLE_RATE = 16_000;/);
  assert.match(wav, /view\.setUint16\(22, 1, true\); \/\/ mono/);
  assert.match(wav, /view\.setUint16\(34, 16, true\); \/\/ bits per sample/);
});
