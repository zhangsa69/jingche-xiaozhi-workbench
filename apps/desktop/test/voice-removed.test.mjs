import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(here, relative), "utf8");
const missing = (relative) => assert.equal(existsSync(resolve(here, relative)), false, `${relative} is back`);

const LOCALES = ["en", "de", "es", "fr", "ko", "tr", "zh-CN", "zh-TW"];

test("the dictation module is gone from every layer", () => {
  // Removed at the user's request on 2026-10-29. A half-deleted feature breaks
  // the bundle at runtime, so the files, the channels and the wiring all go.
  missing("../src/lib/voice-recorder.ts");
  missing("../src/lib/voice-dictation.ts");
  missing("../src/hooks/use-voice-dictation.ts");
  missing("../electron/main/ipc/voice-ipc.ts");
  missing("../../../packages/shared/src/voice-input.ts");
  missing("../../../packages/shared/src/voice-stream.ts");
  missing("../../../packages/shared/src/voice-wav.ts");
});

test("no channel, method or registration survives", () => {
  const protocol = read("../../../packages/shared/src/protocol.ts");
  const api = read("../src/lib/api.ts");
  const register = read("../electron/main/ipc/register.ts");
  const index = read("../../../packages/shared/src/index.ts");

  assert.doesNotMatch(protocol, /voiceTranscribe|voiceStream|voice\/stream|voice\/event/);
  assert.doesNotMatch(api, /voiceStream|voiceTranscribe|onVoiceStream/);
  assert.doesNotMatch(register, /registerVoiceIpc|voice-ipc/);
  assert.doesNotMatch(index, /voice-input|voice-stream|voice-wav/);
});

test("the composer no longer offers the microphone", () => {
  const toolbar = read("../src/features/chat/composer/ComposerToolbar.tsx");
  const composer = read("../src/components/Composer.tsx");
  const icons = read("../src/components/icons.tsx");
  const css = read("../src/styles/composer.css");

  assert.doesNotMatch(toolbar, /composer-voice-btn|IconMic|voice\.live|VoiceDictation/);
  assert.doesNotMatch(composer, /useVoiceDictation|insertDictation|voiceAnchor/);
  assert.doesNotMatch(icons, /IconMic/);
  assert.doesNotMatch(css, /composer-voice|voice-pulse/);
});

test("no locale still ships the dictation strings", () => {
  for (const locale of LOCALES) {
    const source = read(`../../../packages/i18n/src/locales/${locale}/index.ts`);
    assert.doesNotMatch(source, /^\s+"?voice"?: \{/m, `${locale} keeps the voice block`);
  }
});
