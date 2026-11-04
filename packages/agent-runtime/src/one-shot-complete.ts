/**
 * Host-owned one-shot completion used by prompt enhancement and plugin
 * `agent.complete`. No session history is implied: the caller supplies the
 * full Context. tools stay empty.
 */

import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { MessageUsage, ThinkingLevel } from "@pi-desktop/shared";
import { classifyAgentError } from "./agent-errors.js";
import { assistantContent, usageFromPi } from "./agent-messages.js";
import {
  buildProviderModel,
  copilotRequestHeaders,
  createProviderModels,
  type RuntimeProviderConfig,
} from "./provider-binding.js";
import {
  openCodeEndpointFromProvider,
  withOpenCodeSessionHeaders,
} from "./opencode-session-headers.js";
import { mergeProviderHeaders, withProviderHeaders } from "./provider-headers.js";
import {
  captureProviderResponse,
  createProviderRetryStream,
  PROVIDER_RATE_LIMIT_MAX_RETRIES,
  PROVIDER_TRANSIENT_MAX_RETRIES,
  isTransientProviderRetryCode,
} from "./provider-retry.js";

export type OneShotCompleteStream = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

export type OneShotCompleteOptions = {
  signal?: AbortSignal;
  stream?: OneShotCompleteStream;
  emptyErrorCode?: string;
  emptyErrorMessage?: string;
  /**
   * Deadline for the whole completion. A provider that accepts the connection
   * and then goes quiet never ends its stream, so a one-shot caller with no
   * user-facing cancel affordance would wait forever.
   */
  timeoutMs?: number;
  timeoutErrorCode?: string;
  timeoutErrorMessage?: string;
  /** Conversation id forwarded to OpenCode as `x-opencode-session`. */
  sessionId?: string;
};

export type OneShotCompleteResult = {
  text: string;
  usage?: MessageUsage;
};

function completeError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  retriable = false,
): Error & { errorCode: string; data?: Record<string, unknown> } {
  return Object.assign(new Error(message), {
    errorCode: code,
    data: { ...(details ?? {}), errorCode: code, retriable },
  });
}

/**
 * Run one independent completion with the caller's context and no tools.
 * Provider setup retries follow the same controller as the agent runtime.
 */
export async function completeOneShot(
  provider: RuntimeProviderConfig,
  context: Context,
  thinkingLevel: ThinkingLevel,
  options: OneShotCompleteOptions = {},
): Promise<OneShotCompleteResult> {
  const model = buildProviderModel(provider);
  const models = createProviderModels(provider, model);
  const streamSimple =
    options.stream ??
    ((requestModel, requestContext, streamOptions) =>
      models.streamSimple(requestModel, requestContext, streamOptions));
  let providerStatus: number | undefined;
  let providerHeaders: Record<string, string> | undefined;
  let transientRetryAttempt = 0;
  let rateLimitRetryAttempt = 0;

  /*
    Abort the socket at the deadline and, because a custom transport is free to
    ignore the signal, race the stream result against the same deadline. Either
    way the caller stops waiting; only the winner decides which error surfaces.
  */
  const deadlineMs = options.timeoutMs;
  const deadlineController = deadlineMs === undefined ? undefined : new AbortController();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let rejectOnDeadline: ((error: Error) => void) | undefined;
  let deadlineRace: Promise<never> | undefined;
  if (deadlineMs !== undefined) {
    const timeoutError = completeError(
      options.timeoutErrorCode ?? "COMPLETION_TIMEOUT",
      options.timeoutErrorMessage ?? "The completion timed out.",
      { timeoutMs: deadlineMs },
    );
    deadlineRace = new Promise<never>((_, reject) => {
      rejectOnDeadline = reject;
    });
    // The race may settle first; an unobserved rejection here would be noise.
    deadlineRace.catch(() => undefined);
    deadlineTimer = setTimeout(() => {
      timedOut = true;
      deadlineController?.abort();
      rejectOnDeadline?.(timeoutError);
    }, deadlineMs);
    if (options.signal?.aborted) deadlineController?.abort();
    else {
      options.signal?.addEventListener("abort", () => deadlineController?.abort(), {
        once: true,
      });
    }
  }
  const requestSignal = deadlineController?.signal ?? options.signal;

  const requestOptions: SimpleStreamOptions = withProviderHeaders(
    withOpenCodeSessionHeaders(
      {
        ...(requestSignal ? { signal: requestSignal } : {}),
        maxRetries: 0,
        ...(thinkingLevel !== "off" ? { reasoning: thinkingLevel } : {}),
        fetch: captureProviderResponse(undefined, (response) => {
          providerStatus = response?.status;
          providerHeaders = response?.headers;
        }),
      },
      {
        ...openCodeEndpointFromProvider(provider, model),
        sessionId: options.sessionId,
      },
    ),
    mergeProviderHeaders(
      copilotRequestHeaders(provider, context),
      provider.headers,
    ),
  );
  const stream = createProviderRetryStream(
    model,
    context,
    requestOptions,
    (retryOptions) => streamSimple(model, context, retryOptions),
    {
      claim: (error, phase) => {
        if (phase !== "request" || !error.retriable) return undefined;
        if (error.code === "PROVIDER_RATE_LIMITED") {
          if (rateLimitRetryAttempt >= PROVIDER_RATE_LIMIT_MAX_RETRIES) {
            return undefined;
          }
          rateLimitRetryAttempt += 1;
          return rateLimitRetryAttempt;
        }
        if (!isTransientProviderRetryCode(error.code)) return undefined;
        if (transientRetryAttempt >= PROVIDER_TRANSIENT_MAX_RETRIES) {
          return undefined;
        }
        transientRetryAttempt += 1;
        return transientRetryAttempt;
      },
      headers: () => providerHeaders,
      status: () => providerStatus,
    },
  );
  const result = await (deadlineRace
    ? Promise.race([stream.result(), deadlineRace])
    : stream.result()
  ).finally(() => {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  });

  if (result.stopReason === "aborted") {
    if (timedOut) {
      throw completeError(
        options.timeoutErrorCode ?? "COMPLETION_TIMEOUT",
        options.timeoutErrorMessage ?? "The completion timed out.",
        { timeoutMs: deadlineMs },
      );
    }
    throw completeError("TURN_ABORTED", "The completion was aborted.");
  }
  if (result.stopReason === "error") {
    const classified = classifyAgentError(result.errorMessage || "Completion failed.");
    throw completeError(
      classified.code,
      classified.message,
      classified.details,
      classified.retriable,
    );
  }

  const text = assistantContent(result.content).text.trim();
  if (!text) {
    throw completeError(
      options.emptyErrorCode ?? "EMPTY_COMPLETION",
      options.emptyErrorMessage ?? "The model returned no text.",
    );
  }
  return { text, usage: usageFromPi(result.usage) };
}
