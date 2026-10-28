import test from "node:test";
import assert from "node:assert/strict";

import {
  LOCAL_RUNTIMES,
  buildLocalProviderInput,
  chatModelIds,
  hasRuntimeProvider,
  isChatModelId,
  localRuntime,
  probeState,
} from "../src/lib/local-model-probe.ts";

const info = (modelId, extra = {}) => ({ modelId, ...extra });

test("the two runtimes probe their default loopback ports", () => {
  assert.deepEqual(
    LOCAL_RUNTIMES.map((runtime) => runtime.id),
    ["ollama", "lmstudio"],
  );
  assert.equal(
    localRuntime("ollama")?.probeUrl,
    "http://127.0.0.1:11434/v1/models",
  );
  assert.equal(
    localRuntime("lmstudio")?.probeUrl,
    "http://127.0.0.1:1234/v1/models",
  );
  assert.equal(localRuntime("openai"), undefined);
});

test("embedding and speech models are not offered as chat models", () => {
  assert.equal(isChatModelId("llama3.2:latest"), true);
  assert.equal(isChatModelId("qwen2.5-coder:7b"), true);
  assert.equal(isChatModelId("nomic-embed-text"), false);
  assert.equal(isChatModelId("bge-m3"), false);
  assert.equal(isChatModelId("mxbai-embed-large"), false);
  assert.equal(isChatModelId("whisper-large-v3"), false);
  assert.equal(isChatModelId(""), false);
});

test("chat ids keep runtime order and drop case-insensitive duplicates", () => {
  const ids = chatModelIds([
    info("Llama3.2"),
    info("nomic-embed-text"),
    info("llama3.2"),
    info("  qwen2.5-coder:7b  "),
  ]);
  assert.deepEqual(ids, ["Llama3.2", "qwen2.5-coder:7b"]);
});

test("a probe with only embedding models reads as empty, not ready", () => {
  assert.equal(probeState([info("nomic-embed-text")]), "empty");
  assert.equal(probeState([]), "empty");
  assert.equal(probeState(undefined, "ECONNREFUSED"), "offline");
  assert.equal(probeState([info("llama3.2")]), "ready");
});

test("the added row is keyless and keeps the published limits", () => {
  const runtime = localRuntime("ollama");
  const input = buildLocalProviderInput(runtime, [
    info("llama3.2", { contextWindow: 131072, maxTokens: 8192 }),
    info("nomic-embed-text"),
    info("qwen2.5-coder:7b"),
  ]);

  assert.ok(input);
  assert.equal(input.authKind, "none");
  assert.equal(input.secretValue, undefined);
  assert.equal(input.apiStyle, "chat_completions");
  assert.equal(input.baseUrl, "http://127.0.0.1:11434/v1");
  assert.equal(input.vendorKey, "ollama");
  assert.equal(input.defaultModelId, "llama3.2");
  assert.deepEqual(
    input.models.map((model) => model.id),
    ["llama3.2", "qwen2.5-coder:7b"],
  );
  assert.equal(input.models[0].contextWindow, 131072);
  assert.equal(input.models[0].maxTokens, 8192);
});

test("an unpublished local limit falls back to a conservative window", () => {
  const input = buildLocalProviderInput(localRuntime("lmstudio"), [info("local-model")]);

  assert.ok(input);
  assert.equal(input.models[0].contextWindow, 32768);
  assert.equal(input.models[0].maxTokens, 4096);
});

test("nothing chattable means no row is written", () => {
  assert.equal(buildLocalProviderInput(localRuntime("ollama"), []), null);
  assert.equal(
    buildLocalProviderInput(localRuntime("ollama"), [info("nomic-embed-text")]),
    null,
  );
});

test("an existing row stops the add button from offering a duplicate", () => {
  const runtime = localRuntime("ollama");
  assert.equal(
    hasRuntimeProvider([{ baseUrl: "http://127.0.0.1:11434/v1/" }], runtime),
    true,
  );
  assert.equal(hasRuntimeProvider([{ baseUrl: "HTTP://127.0.0.1:11434/v1" }], runtime), true);
  assert.equal(
    hasRuntimeProvider([{ baseUrl: "http://127.0.0.1:1234/v1" }], runtime),
    false,
  );
  assert.equal(hasRuntimeProvider([], undefined), false);
});
