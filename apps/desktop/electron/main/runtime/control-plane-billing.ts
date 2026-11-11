import { ControlPlaneError, type ControlPlaneClient } from "../control-plane-client";
import type { HostProcess } from "../host-process";

/**
 * Reports finished turns to the control-plane ledger.
 *
 * The proxy deliberately does no accounting, so the token counts collected by
 * the turn coordinator are the only usage record. The price is still decided by
 * the server: this module sends counts, never beans. `sessionId:turnId` is the
 * idempotency key, so a retry cannot double-charge.
 *
 * Every path that does not reach the ledger states why. Without that, a turn
 * that silently skipped reporting looks exactly like a turn that was never
 * meant to be billed, which is what made a real "no beans were deducted"
 * report impossible to diagnose from the logs.
 */

export type TurnUsageSnapshot = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
};

export type TurnUsageReport = {
  sessionId: string;
  turnId: string;
  usage?: TurnUsageSnapshot | null;
};

/** Why a settled turn produced no charge. */
export type UsageSkipReason =
  | "no_gateway_provider"
  | "no_host"
  | "session_not_on_gateway"
  | "no_usage"
  | "lookup_failed";

export type ControlPlaneBilling = {
  reportTurn(input: TurnUsageReport): Promise<void>;
};

type BillingSession = {
  providerId?: string | null;
  messages?: Array<{ role?: string; usage?: TurnUsageSnapshot | null }> | null;
};

type TokenCounts = { promptTokens: number; completionTokens: number };

/**
 * The closing assistant row is always one of the last few, and a content limit
 * of one character keeps the fallback read small: without a window this call
 * returns the whole transcript.
 */
const FALLBACK_MESSAGE_WINDOW = 8;
const FALLBACK_CONTENT_LIMIT = 1;

export function createControlPlaneBilling(options: {
  client: ControlPlaneClient;
  getHost: () => HostProcess | null;
  /** Provider row the client created for the company gateway, if any. */
  providerId: () => string | null;
  logger?: { app: (...args: any[]) => void };
}): ControlPlaneBilling {
  // `logger.app` reads its own receiver, so a bare method reference loses
  // `this` and throws on the first use. That turned every billing log line —
  // success, failure and skip alike — into a rejected promise, which is why a
  // turn that charged (or refused to charge) left no trace at all.
  const log = options.logger
    ? options.logger.app.bind(options.logger)
    : (...args: any[]) => console.log(...args);
  const inflight = new Set<string>();
  /**
   * A deployment without a control plane is the normal case for a local user,
   * so this reason is stated once per process, not once per turn.
   */
  let reportedMissingGateway = false;

  function tokenCounts(usage: TurnUsageSnapshot | null | undefined): TokenCounts {
    // The ledger prices prompt and completion tokens; cached and reasoning
    // tokens are billed in the bucket the provider reports them under.
    const promptTokens =
      (usage?.inputTokens ?? 0) + (usage?.cacheReadTokens ?? 0) + (usage?.cacheWriteTokens ?? 0);
    const completionTokens = (usage?.outputTokens ?? 0) + (usage?.reasoningTokens ?? 0);
    return {
      promptTokens: Math.max(0, Math.round(promptTokens)),
      completionTokens: Math.max(0, Math.round(completionTokens)),
    };
  }

  function hasTokens(counts: TokenCounts): boolean {
    return counts.promptTokens > 0 || counts.completionTokens > 0;
  }

  /**
   * Recover the turn's usage when settlement ran before the closing
   * `message_end` reached the coordinator. Only the tail is inspected, and only
   * a row that actually carries usage can answer, so an unrelated last tool row
   * does not win.
   */
  function lastAssistantCounts(messages: BillingSession["messages"]): TokenCounts | null {
    if (!Array.isArray(messages)) return null;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || message.role !== "assistant" || !message.usage) continue;
      const counts = tokenCounts(message.usage);
      if (hasTokens(counts)) return counts;
    }
    return null;
  }

  function skip(sessionId: string, turnId: string, reason: UsageSkipReason): void {
    log("runtime", "warn", "control plane usage report skipped", {
      sessionId,
      data: { turnId, reason },
    });
  }

  async function reportTurn({ sessionId, turnId, usage }: TurnUsageReport): Promise<void> {
    // The gateway row is the only thing that makes a turn billable, so it is
    // checked before anything else: a local user must not see a skip warning
    // per turn, and a gateway session must never be dropped for "no usage"
    // before we know it was on the gateway at all.
    const gatewayProviderId = options.providerId();
    if (!gatewayProviderId) {
      if (!reportedMissingGateway) {
        reportedMissingGateway = true;
        log("runtime", "info", "control plane usage report skipped", {
          data: { reason: "no_gateway_provider" },
        });
      }
      return;
    }
    const host = options.getHost();
    if (!host) {
      skip(sessionId, turnId, "no_host");
      return;
    }
    const requestId = `${sessionId}:${turnId}`;
    if (inflight.has(requestId)) {
      return;
    }
    inflight.add(requestId);
    try {
      // Only turns that ran through the company gateway are billed; a local or
      // vendor-direct provider must never touch the employee's bean balance.
      // The window keeps this read bounded even on a long transcript.
      const current = await host.call<{ session?: BillingSession | null }>("session.get", {
        id: sessionId,
        messageLimit: FALLBACK_MESSAGE_WINDOW,
        contentLimit: FALLBACK_CONTENT_LIMIT,
      });
      const session = current?.session ?? null;
      if (!session) {
        skip(sessionId, turnId, "session_not_on_gateway");
        return;
      }
      // A session created without an explicit provider inherits the global
      // default, and a managed deployment pins that default to the gateway
      // row. Reading it only when the session has no provider keeps the common
      // path at a single RPC, and stops a fresh session — the most common case
      // for a new conversation — from being treated as a local one.
      let sessionProvider = session.providerId ?? null;
      if (!sessionProvider) {
        const settings = await host.call<{ defaultProviderId?: string }>("settings.get");
        sessionProvider = settings?.defaultProviderId ?? null;
      }
      if (sessionProvider !== gatewayProviderId) {
        skip(sessionId, turnId, "session_not_on_gateway");
        return;
      }

      const reported = tokenCounts(usage);
      const counts = hasTokens(reported) ? reported : lastAssistantCounts(session.messages);
      if (!counts) {
        skip(sessionId, turnId, "no_usage");
        return;
      }

      const profile = options.client.currentProfile();
      const gatewayId = profile?.gateway?.id ?? null;
      const model = profile?.gateway?.model ?? null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const result = await options.client.chargeUsage({
            requestId,
            gatewayId,
            model,
            promptTokens: counts.promptTokens,
            completionTokens: counts.completionTokens,
          });
          if (!result.duplicate) {
            log("runtime", "info", "control plane usage charged", {
              sessionId,
              data: {
                turnId,
                promptTokens: counts.promptTokens,
                completionTokens: counts.completionTokens,
                chargedBeans: result.chargedBeans,
                balanceBeans: result.balanceBeans,
              },
            });
          }
          return;
        } catch (error) {
          const fatal =
            error instanceof ControlPlaneError && error.status >= 400 && error.status < 500;
          if (attempt === 1 || fatal) {
            log("runtime", "warn", "control plane usage report failed", {
              sessionId,
              data: {
                turnId,
                promptTokens: counts.promptTokens,
                completionTokens: counts.completionTokens,
                error: error instanceof Error ? error.message : String(error),
              },
            });
            return;
          }
        }
      }
    } catch (error) {
      log("runtime", "warn", "control plane usage report skipped", {
        sessionId,
        data: {
          turnId,
          reason: "lookup_failed",
          error: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      inflight.delete(requestId);
    }
  }

  return { reportTurn };
}
