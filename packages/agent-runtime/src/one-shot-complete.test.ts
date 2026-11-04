/**
 * One-shot completions run against a real local HTTP endpoint here: the point
 * is the wire behavior, not the stream adapter. A provider that accepts the
 * request and then goes quiet used to hold prompt enhancement forever, because
 * nothing in the one-shot path had a deadline and the composer button it feeds
 * has no cancel affordance.
 */
import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import { completeOneShot } from "./one-shot-complete.js";
import { enhancePromptDraft } from "./prompt-enhancement.js";
import type { RuntimeProviderConfig } from "./provider-binding.js";

const context: Context = {
  systemPrompt: "Rewrite the draft.",
  messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
};

function providerFor(baseUrl: string): RuntimeProviderConfig {
  return {
    id: "provider",
    name: "Provider",
    baseUrl,
    modelId: "test-model",
    apiKey: "test-key",
    apiStyle: "chat_completions",
    supportsReasoning: false,
    supportedThinkingLevels: ["off"],
  };
}

const sse = [
  `data: ${JSON.stringify({
    id: "1",
    object: "chat.completion.chunk",
    created: 0,
    model: "test-model",
    choices: [
      { index: 0, delta: { role: "assistant", content: "hello back" }, finish_reason: null },
    ],
  })}`,
  "",
  `data: ${JSON.stringify({
    id: "1",
    object: "chat.completion.chunk",
    created: 0,
    model: "test-model",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  })}`,
  "",
  "data: [DONE]",
  "",
  "",
].join("\n");

async function withServer(
  handler: Parameters<typeof createServer>[1],
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await run(`http://127.0.0.1:${port}/v1`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("one-shot completion over real HTTP", () => {
  it("returns the streamed answer", async () => {
    let seenPath = "";
    await withServer(
      (req, res) => {
        seenPath = req.url ?? "";
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(sse);
      },
      async (baseUrl) => {
        const result = await completeOneShot(providerFor(baseUrl), context, "off", {
          timeoutMs: 5_000,
        });
        expect(result.text).toBe("hello back");
        expect(seenPath).toBe("/v1/chat/completions");
      },
    );
  });

  it("gives up when the provider accepts and never answers", async () => {
    let socketClosed = false;
    await withServer(
      (req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(": keep-alive\n\n");
        req.on("close", () => {
          socketClosed = true;
        });
      },
      async (baseUrl) => {
        const started = Date.now();
        await expect(
          completeOneShot(providerFor(baseUrl), context, "off", { timeoutMs: 300 }),
        ).rejects.toMatchObject({ errorCode: "COMPLETION_TIMEOUT" });
        // The deadline rejects the caller; it must not sit out the abort.
        expect(Date.now() - started).toBeLessThan(5_000);
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(socketClosed).toBe(true);
  });

  it("hands the enhancement its own deadline and error code", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(": keep-alive\n\n");
      },
      async (baseUrl) => {
        await expect(
          enhancePromptDraft(providerFor(baseUrl), "Keep this", "off", { timeoutMs: 250 }),
        ).rejects.toMatchObject({ errorCode: "PROMPT_ENHANCEMENT_TIMEOUT" });
      },
    );
  });
});
