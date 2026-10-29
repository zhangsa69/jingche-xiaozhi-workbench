import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(here, relative), "utf8");

const shared = read("../../../packages/shared/src/voice-input.ts");
const hook = read("../src/hooks/use-voice-dictation.ts");
const engine = read("../src/lib/voice-dictation.ts");
const composer = read("../src/components/Composer.tsx");
const toolbar = read("../src/features/chat/composer/ComposerToolbar.tsx");
const submit = read("../src/features/chat/composer/hooks/useComposerSubmit.ts");
const css = read("../src/styles/composer.css");

const LOCALES = ["en", "de", "es", "fr", "ko", "tr", "zh-CN", "zh-TW"];
const KEYS = [
  "start",
  "listening",
  "requesting",
  "denied",
  "error",
  "unreachable",
  "unsupported",
];

test("a partial transcript never reaches the draft", () => {
  // The recogniser revises as it listens; committing twice would leave both
  // versions of a sentence in the box.
  assert.match(shared, /case "partial": \{[\s\S]*?committed: ""/);
  assert.match(shared, /case "final": \{[\s\S]*?committed: text/);
  assert.match(hook, /apply\(\{ type: "final", text: final \}\);\s*return;/);
  assert.match(hook, /apply\(\{ type: "partial", text: interimTranscript\(event\) \}\)/);
});

test("a final transcript only commits while listening", () => {
  assert.match(shared, /case "final": \{\s*if \(state\.status !== "listening"\)/);
});

test("the caret decides where dictation lands", () => {
  assert.match(composer, /const inserted = insertDictation\(value, cursor, text\);/);
  assert.match(composer, /setValue\(inserted\.value\);\s*setCursor\(inserted\.cursor\);/);
  // Sending is untouched by dictation: the transcript is just draft text.
  assert.doesNotMatch(submit, /voice|dictation|insertDictation/);
});

test("a build without a speech engine cannot pretend to listen", () => {
  assert.match(shared, /if \(state\.status === "unsupported"\) return \{ state, committed: "" \};/);
  assert.doesNotMatch(shared, /return state\.status === "unsupported"/);
  assert.match(hook, /initialVoiceState\(engine\.available\)/);
  assert.match(toolbar, /disabled=\{voice\.disabled\}/);
  // Every state except unsupported is pressable: a press that started a
  // request must stay undoable even when the engine never answers.
  assert.match(shared, /state\.status === "idle" \|\|\s*state\.status === "requesting"/);
});

test("an engine that accepts start and then goes silent is reported, not spun forever", () => {
  // Chromium's recogniser uploads audio to a remote service. With that service
  // blocked, `start()` succeeds and no event ever arrives — the button used to
  // pulse indefinitely with no way out.
  assert.match(hook, /const FIRST_RESULT_TIMEOUT_MS = \d+_?\d*;/);
  assert.match(hook, /apply\(\{ type: "timeout" \}\)/);
  // The microphone is closed before the error lands, so the OS recording
  // indicator does not stay lit behind a dead feature.
  assert.match(hook, /releaseRecognizer\(\);\s*apply\(\{ type: "timeout" \}\)/);
  // Any transcript proves reachability and re-arms the timer.
  assert.match(hook, /clearWatchdog\(\);\s*const final = finalTranscript\(event\);/);
  assert.match(hook, /armWatchdog\(\);/);
  assert.match(shared, /case "timeout": \{[\s\S]*?VOICE_TIMEOUT_REASON/);
});

test("a throwing start() cannot leave the button stuck on requesting", () => {
  assert.match(hook, /try \{\s*recognizer\.start\(\);\s*\} catch \(error\) \{/);
  assert.match(hook, /releaseRecognizer\(\);\s*apply\(\{\s*type: "error"/);
  // Leaving the page must not keep the microphone open.
  assert.match(hook, /useEffect\(\s*\(\) => \(\) => \{\s*clearWatchdog\(\);\s*releaseRecognizer\(\);/);
});

test("a denied permission is a state, not a crash", () => {
  assert.match(engine, /errorIsPermissionDenial/);
  assert.match(hook, /if \(errorIsPermissionDenial\(event\.error\)\) \{\s*apply\(\{ type: "permission-denied" \}\)/);
  assert.match(shared, /case "permission-denied": \{/);
});

test("the microphone button is a button with a live affordance", () => {
  assert.match(toolbar, /composer-voice-btn\$\{voice\.live \? " is-live" : ""\}/);
  assert.match(toolbar, /aria-pressed=\{voice\.live\}/);
  assert.match(toolbar, /tooltip=\{t\(voice\.labelKey\)\}/);
  assert.match(css, /\.composer-voice-btn\.is-live/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
});

test("dictation speaks all eight locales", () => {
  for (const locale of LOCALES) {
    const source = read(`../../../packages/i18n/src/locales/${locale}/index.ts`);
    assert.ok(/"?voice"?:/.test(source), `${locale} has no voice section`);
    for (const key of KEYS) {
      assert.ok(new RegExp(`"?${key}"?:`).test(source), `${locale} is missing voice.${key}`);
    }
  }
});
