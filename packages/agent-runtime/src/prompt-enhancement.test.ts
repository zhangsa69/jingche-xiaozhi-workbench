import { describe, expect, it } from "vitest";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import {
  enhancePromptDraft,
  promptEnhancementContext,
} from "./prompt-enhancement.js";
import type { RuntimeProviderConfig } from "./provider-binding.js";

const provider: RuntimeProviderConfig = {
  id: "provider",
  name: "Provider",
  modelId: "model",
  apiKey: "test-key",
  apiStyle: "chat_completions",
  supportsReasoning: true,
  supportedThinkingLevels: ["off", "high"],
};

function assistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "provider",
    model: "model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function streamFor(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      stream.push({
        type: "error",
        reason: message.stopReason,
        error: message,
      });
    } else {
      stream.push({ type: "start", partial: message });
      stream.push({
        type: "done",
        reason: message.stopReason as "stop" | "length" | "toolUse" | "deferred",
        message,
      });
    }
    stream.end(message);
  });
  return stream;
}

describe("prompt enhancement", () => {
  it("builds a single system-plus-user context without history or tools", () => {
    const context = promptEnhancementContext("  Make this clearer.  ");
    expect(context.systemPrompt).toContain("Output only the");
    // D430: the ask is a prompt-engineering rewrite, not proofreading. The old
    // wording ("more concise", "at most minor polish") licensed a comma-level
    // edit and must not come back.
    expect(context.systemPrompt).toContain("prompt engineer");
    expect(context.systemPrompt).toContain("1.5 to 3 times");
    expect(context.systemPrompt).toMatch(/punctuation change is a failure/);
    expect(context.systemPrompt).not.toMatch(/minor polish|more concise/);
    expect(context.messages).toHaveLength(1);
    expect(context.messages[0]).toMatchObject({
      role: "user",
      content: "Draft:\n  Make this clearer.  ",
    });
    expect(context.tools).toBeUndefined();
  });

  it("uses the mocked provider stream, passes reasoning, and trims text output", async () => {
    let seenContext: ReturnType<typeof promptEnhancementContext> | undefined;
    let seenReasoning: unknown;
    const enhanced = await enhancePromptDraft(
      provider,
      "Rewrite this",
      "high",
      {
        stream: (_model, context, options) => {
          seenContext = context;
          seenReasoning = options?.reasoning;
          return streamFor(
            assistantMessage([{ type: "text", text: "  Rewritten draft  " }]),
          );
        },
      },
    );
    expect(enhanced).toBe("Rewritten draft");
    expect(seenContext?.messages).toHaveLength(1);
    expect(seenReasoning).toBe("high");
  });

  it("rejects an empty model response without changing the caller's draft", async () => {
    await expect(
      enhancePromptDraft(provider, "Keep this", "off", {
        stream: () => streamFor(assistantMessage([{ type: "text", text: "  " }])),
      }),
    ).rejects.toMatchObject({ errorCode: "PROMPT_ENHANCEMENT_EMPTY" });
  });

  it("stops waiting when the provider accepts the request and never answers", async () => {
    // The composer exposes no cancel affordance while enhancing, so a stream
    // that starts and then goes quiet used to hold the toolbar forever.
    const stalled = createAssistantMessageEventStream();
    queueMicrotask(() => {
      stalled.push({ type: "start", partial: assistantMessage([]) });
    });
    await expect(
      enhancePromptDraft(provider, "Keep this", "off", {
        stream: () => stalled,
        timeoutMs: 25,
      }),
    ).rejects.toMatchObject({ errorCode: "PROMPT_ENHANCEMENT_TIMEOUT" });
  });

  it("keeps a caller abort distinct from the deadline", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      enhancePromptDraft(provider, "Keep this", "off", {
        stream: () => streamFor(assistantMessage([{ type: "text", text: "x" }])),
        signal: controller.signal,
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({ errorCode: "TURN_ABORTED" });
  });

  it("still resolves a fast answer under the deadline", async () => {
    const enhanced = await enhancePromptDraft(provider, "Keep this", "off", {
      stream: () => streamFor(assistantMessage([{ type: "text", text: "  kept  " }])),
      timeoutMs: 5_000,
    });
    expect(enhanced).toBe("kept");
  });

  it("classifies provider failures with the existing error code", async () => {
    await expect(
      enhancePromptDraft(provider, "Keep this", "off", {
        stream: () =>
          streamFor(
            Object.assign(assistantMessage([], "error"), {
              errorMessage: "401: invalid api key",
            }),
          ),
      }),
    ).rejects.toMatchObject({ errorCode: "PROVIDER_UNAUTHORIZED" });
  });
});
