import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@pi-desktop/shared";
import { completeOneShot } from "./one-shot-complete.js";
import {
  PROMPT_ENHANCEMENT_SYSTEM_PROMPT,
  PROMPT_ENHANCEMENT_USER_PREFIX,
} from "./prompt-templates.js";
import type { RuntimeProviderConfig } from "./provider-binding.js";

export type PromptEnhancementStream = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

/**
 * A rewrite is a short answer, so the composer waits at most this long. The
 * button disables while the request runs and offers no cancel, so an unbounded
 * wait is indistinguishable from a broken feature.
 */
export const PROMPT_ENHANCEMENT_TIMEOUT_MS = 60_000;

export type PromptEnhancementOptions = {
  signal?: AbortSignal;
  /** Test seam for a provider stream; production uses the resolved model registry. */
  stream?: PromptEnhancementStream;
  /** Deadline override; production uses `PROMPT_ENHANCEMENT_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Conversation id forwarded to OpenCode as `x-opencode-session`. */
  sessionId?: string;
};

export function promptEnhancementContext(draft: string): Context {
  return {
    systemPrompt: PROMPT_ENHANCEMENT_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `${PROMPT_ENHANCEMENT_USER_PREFIX}${draft}`,
        timestamp: Date.now(),
      },
    ],
  };
}

/**
 * Run one independent completion with no session history or tools.
 * Provider setup retries follow the same controller as the agent runtime.
 */
export async function enhancePromptDraft(
  provider: RuntimeProviderConfig,
  draft: string,
  thinkingLevel: ThinkingLevel,
  options: PromptEnhancementOptions = {},
): Promise<string> {
  const result = await completeOneShot(
    provider,
    promptEnhancementContext(draft),
    thinkingLevel,
    {
      signal: options.signal,
      stream: options.stream,
      sessionId: options.sessionId,
      emptyErrorCode: "PROMPT_ENHANCEMENT_EMPTY",
      emptyErrorMessage: "The model returned an empty enhanced draft.",
      timeoutMs: options.timeoutMs ?? PROMPT_ENHANCEMENT_TIMEOUT_MS,
      timeoutErrorCode: "PROMPT_ENHANCEMENT_TIMEOUT",
      timeoutErrorMessage:
        "The model did not return an enhanced draft before the deadline.",
    },
  );
  return result.text;
}
