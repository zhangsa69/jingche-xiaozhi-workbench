/**
 * Local model runtimes as a one-click add path.
 *
 * Ollama and LM Studio both expose an OpenAI-compatible `/v1/models` on
 * loopback, so "add a local model" is: probe that URL, keep the chat models,
 * and persist a provider row with `authKind: "none"`. Nothing here talks to the
 * network — the renderer cannot — but every decision the button makes (what to
 * probe, which ids are chattable, what the row looks like) is a pure function,
 * so the shape of the saved row is testable without starting a runtime.
 */
import {
  LOCAL_ENDPOINT_PRESETS,
  bindingFromModelInfo,
  type ModelBinding,
  type ModelInfo,
  type ProviderCreateInput,
} from "@pi-desktop/shared";

export type LocalRuntimeId = "ollama" | "lmstudio";

export type LocalRuntime = {
  id: LocalRuntimeId;
  /** Display name; the label itself is translated from `labelKey`. */
  name: string;
  labelKey: string;
  baseUrl: string;
  apiStyle: string;
  /** Where the runtime answers a model list, without the trailing slash. */
  probeUrl: string;
};

function probeUrlFor(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

/**
 * The runtimes offered in the model tab, in display order.
 *
 * Derived from the shared presets so the picker, the probe, and the saved row
 * cannot disagree about a port or an API style.
 */
export const LOCAL_RUNTIMES: readonly LocalRuntime[] = LOCAL_ENDPOINT_PRESETS.map(
  (preset) => ({
    id: preset.id as LocalRuntimeId,
    name: preset.name,
    labelKey: preset.labelKey,
    baseUrl: preset.baseUrl,
    apiStyle: preset.apiStyle,
    probeUrl: probeUrlFor(preset.baseUrl),
  }),
);

export function localRuntime(id: string): LocalRuntime | undefined {
  return LOCAL_RUNTIMES.find((runtime) => runtime.id === id);
}

/**
 * Ids that cannot hold a conversation.
 *
 * A local `/v1/models` lists everything the runtime has pulled, embeddings and
 * speech models included. Adding those as chat models would put rows in the
 * default-model picker that fail on the first send, so they are dropped at
 * probe time instead of being added and then cleaned up by the user.
 */
const NON_CHAT_ID =
  /(^|[-_/])(embed|embedding|embeddings|rerank|reranker|whisper|tts|stable-diffusion|clip|bge|gte)([-_/]|$)/i;

export function isChatModelId(id: string): boolean {
  const trimmed = id.trim();
  if (!trimmed) return false;
  return !NON_CHAT_ID.test(trimmed);
}

/** Chat models from a probe reply, de-duplicated case-insensitively. */
export function chatModelIds(models: readonly ModelInfo[] | undefined): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const model of models ?? []) {
    const id = model.modelId?.trim();
    if (!id || !isChatModelId(id)) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
  }
  return ids;
}

export type LocalProbeState = "ready" | "empty" | "offline";

/**
 * What the row should say after a probe.
 *
 * `offline` covers every failure the transport can raise (connection refused,
 * timeout, 404 from a runtime that is not on that port) because the user action
 * is the same in all of them: start the runtime, or fix the port.
 */
export function probeState(
  models: readonly ModelInfo[] | undefined,
  error?: string,
): LocalProbeState {
  const ids = chatModelIds(models);
  if (ids.length > 0) return "ready";
  return error ? "offline" : "empty";
}

/** Baselines a local binding when the runtime does not publish limits. */
const LOCAL_FALLBACK_CONTEXT_WINDOW = 32_768;
const LOCAL_FALLBACK_MAX_TOKENS = 4_096;

function localBinding(model: ModelInfo): ModelBinding {
  const binding = bindingFromModelInfo(model);
  // `bindingFromModelInfo` falls back to the cloud default (128k) when the
  // endpoint stays silent. Local runtimes are usually far below that, and a
  // context window that is too large makes the agent overrun the model instead
  // of compacting, so an unpublished limit gets a conservative baseline.
  const published = model.contextWindow || model.limit?.context;
  if (!published) {
    binding.contextWindow = LOCAL_FALLBACK_CONTEXT_WINDOW;
    binding.maxTokens = LOCAL_FALLBACK_MAX_TOKENS;
  }
  return binding;
}

/**
 * The provider row a local add writes, or `null` when nothing is chattable.
 *
 * No `secretValue`: these runtimes have no key, and the host accepts an empty
 * secret for `authKind: "none"` rows.
 */
export function buildLocalProviderInput(
  runtime: LocalRuntime,
  models: readonly ModelInfo[] | undefined,
): ProviderCreateInput | null {
  const usable = (models ?? []).filter((model) => isChatModelId(model.modelId ?? ""));
  if (chatModelIds(usable).length === 0) return null;

  const seen = new Set<string>();
  const bindings: ModelBinding[] = [];
  for (const model of usable) {
    const key = model.modelId.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    bindings.push(localBinding(model));
  }

  return {
    name: runtime.name,
    vendorKey: runtime.id,
    type: "openai_compatible",
    protocol: "openai_compatible",
    baseUrl: runtime.baseUrl,
    authKind: "none",
    apiStyle: runtime.apiStyle,
    models: bindings,
    defaultModelId: bindings[0]?.id,
  };
}

/** True when this runtime's row is already configured. */
export function hasRuntimeProvider(
  providers: readonly { baseUrl?: string | null }[],
  runtime: LocalRuntime | undefined,
): boolean {
  if (!runtime) return false;
  const target = runtime.baseUrl.replace(/\/+$/, "").toLowerCase();
  return providers.some(
    (provider) => (provider.baseUrl ?? "").replace(/\/+$/, "").toLowerCase() === target,
  );
}


