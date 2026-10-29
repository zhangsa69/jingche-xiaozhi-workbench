import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(here, relative), "utf8");

const shared = read("../../../packages/shared/src/voice-input.ts");
const stream = read("../../../packages/shared/src/voice-stream.ts");
const hook = read("../src/hooks/use-voice-dictation.ts");
const recorder = read("../src/lib/voice-recorder.ts");
const dictation = read("../src/lib/voice-dictation.ts");
const api = read("../src/lib/api.ts");
const protocol = read("../../../packages/shared/src/protocol.ts");
const ipc = read("../electron/main/ipc/voice-ipc.ts");
const register = read("../electron/main/ipc/register.ts");
const composer = read("../src/components/Composer.tsx");
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
});

test("audio streams to the host while the user is still speaking", () => {
  assert.match(hook, /api\.onVoiceStream\(\(update\) => \{/);
  assert.match(hook, /apply\(\{ type: "transcribed", text: result\.text \}\);/);
  assert.match(hook, /void api\.voiceStreamAudio\(\{ pcm \}\);/);
  assert.match(hook, /const started = await api\s*\.voiceStreamStart\(\)/);
  assert.match(hook, /const result = await api\.voiceStreamStop\(\);/);
});

test("pcm frames are 60 ms and never split a sample", () => {
  // The service consumes 16-bit mono frames; FunASR's own client uses 60 ms, and
  // grouping in the recorder means the host never forwards half frames.
  assert.match(recorder, /const FRAME_BYTES = 1_920;/);
  assert.match(recorder, /view\.setInt16\(index \* 2, clamped < 0 \? clamped \* 0x8000 : clamped \* 0x7fff, true\);/);
  // The tail of the last frame holds real audio and must be flushed on stop.
  assert.match(recorder, /if \(options\.onPcm && pendingAt > 0\) flush\(pending\.subarray\(0, pendingAt\)\);/);
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
  assert.match(hook, /if \(next\.status !== "listening"\) \{[\s\S]*?await recorder\.cancel\(\);/);
});

test("a long recording ends on its own instead of growing without bound", () => {
  assert.match(hook, /const MAX_RECORDING_MS = \d+_?\d*;/);
  assert.match(hook, /apply\(\{ type: "stop" \}\);\s*void finish\(\);/);
});

test("live text replaces itself in the draft instead of piling up", () => {
  // The service keeps revising the sentence it is listening to. Appending each
  // update would leave every earlier version in the box, so the draft is rebuilt
  // from the anchor captured when dictation started.
  assert.match(composer, /const voiceAnchor = useRef<\{ value: string; cursor: number \} \| null>\(null\);/);
  assert.match(composer, /onInterim: \(text: string\) => \{/);
  assert.match(composer, /const anchor = voiceAnchor\.current \?\? \{ value, cursor \};/);
  assert.match(composer, /const inserted = insertDictation\(anchor\.value, anchor\.cursor, text\);/);
  // The last rebuild stays as ordinary draft text once the session ends.
  assert.match(composer, /const anchor = voiceAnchor\.current \?\? \{ value, cursor \};\s*voiceAnchor\.current = null;/);
});

test("the transcript is assembled on one side only", () => {
  // Two accumulators would splice two half-transcripts on a reconnect.
  assert.match(stream, /export function accumulateTranscript/);
  assert.match(ipc, /accumulateTranscript\(session\.transcript, \{/);
  assert.match(ipc, /if \(message\.mode === "error"\)/);
  assert.match(ipc, /const kind =\s*message\.mode === "2pass-offline" \|\| message\.mode === "offline"\s*\? "offline"\s*: "online";/);
  assert.doesNotMatch(hook, /accumulateTranscript/);
});

test("the session ends on silence, with a hard ceiling behind it", () => {
  assert.match(ipc, /const STREAM_GRACE_MS = 1_000;/);
  assert.match(ipc, /const STREAM_FINALIZE_TIMEOUT_MS = 12_000;/);
  assert.match(ipc, /socket\.send\(JSON\.stringify\(\{ is_speaking: false \}\)\)/);
  // A session the service closes after a pause still has text to keep.
  assert.match(ipc, /if \(!session\) return lastSettled \?\? \{ ok: false, error: VOICE_EMPTY_REASON \};/);
});

test("the endpoints belong to the host, not the page", () => {
  // A renderer-supplied URL would turn these channels into a request forger.
  assert.match(protocol, /voiceStreamStart: "pi-desktop\/voice\/stream\/start"/);
  assert.match(protocol, /voiceStreamText: "pi-desktop\/voice\/event\/stream"/);
  assert.match(ipc, /const DEFAULT_STREAM_ENDPOINT = "wss:\/\/10\.120\.65\.148:10095";/);
  assert.match(ipc, /const DEFAULT_HTTP_ENDPOINT = "http:\/\/10\.120\.65\.148:10096";/);
  assert.match(ipc, /return startStreamSession\(event\.sender, resolveAsrStreamEndpoint\(\)\);/);
  assert.match(register, /registerVoiceIpc\(\{ registrar \}\);/);
  assert.match(api, /voiceStreamStart: \(\) =>/);
});

test("the failed stream still has a way to transcribe", () => {
  // The stream is one socket on a service that allows one client at a time; when
  // it cannot be opened the recording is uploaded whole instead.
  assert.match(hook, /streamRef\.current = started\.ok;/);
  assert.match(hook, /const result = await transcribeRecording\(recording\.wav\);/);
  assert.match(ipc, /form\.append\("audio", new Blob\(\[body\], \{ type: mimeType \}\), "dictation\.wav"\);/);
});

test("a cancelled press never sends audio into the next session", () => {
  assert.match(hook, /bufferedRef\.current = \[\];/);
  assert.match(hook, /void api\.voiceStreamCancel\(\);/);
  // Frames captured before the socket opened are sent once it does, not dropped.
  assert.match(hook, /for \(const pcm of buffered\) void api\.voiceStreamAudio\(\{ pcm \}\);/);
});

test("the button distinguishes listening, transcribing and failure", () => {
  assert.match(toolbar, /voice\.live \? " is-live" : ""/);
  assert.match(toolbar, /voice\.busy \? " is-busy" : ""/);
  assert.match(toolbar, /aria-busy=\{voice\.busy\}/);
  assert.match(css, /\.composer-voice-btn\.is-busy svg \{[\s\S]*?animation: composer-voice-spin/);
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

test("the state machine still gates what reaches the draft", () => {
  assert.match(shared, /export function normalizeTranscript/);
  assert.match(shared, /case "transcribed": \{[\s\S]*?const text = normalizeTranscript\(event\.text\);/);
  assert.match(dictation, /errorIsPermissionDenial/);
  assert.match(dictation, /errorIsMissingDevice/);
});
