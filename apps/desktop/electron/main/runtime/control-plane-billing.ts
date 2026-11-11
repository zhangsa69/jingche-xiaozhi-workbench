import { ControlPlaneError, type ControlPlaneClient } from "../control-plane-client";
import type { HostProcess } from "../host-process";

/**
 * Reports finished turns to the control-plane ledger.
 *
 * The proxy deliberately does no accounting, so the token counts collected by
 * the turn coordinator are the only usage record. The price is still decided by
 * the server: this module sends counts, never beans. `sessionId:turnId` is the
 * idempotency key, so a retry cannot double-charge.
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

export type ControlPlaneBilling = {
  reportTurn(input: TurnUsageReport): Promise<void>;
};

export function createControlPlaneBilling(options: {
  client: ControlPlaneClient;
  getHost: () => HostProcess | null;
  /** Provider row the client created for the company gateway, if any. */
  providerId: () => string | null;
  logger?: { app: (...args: any[]) => void };
}): ControlPlaneBilling {
  const log = options.logger?.app ?? ((...args: any[]) => console.log(...args));
  const inflight = new Set<string>();

  function tokenCounts(usage: TurnUsageSnapshot | null | undefined): {
    promptTokens: number;
    completionTokens: number;
  } {
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

  async function reportTurn({ sessionId, turnId, usage }: TurnUsageReport): Promise<void> {
    const { promptTokens, completionTokens } = tokenCounts(usage);
    if (promptTokens === 0 && completionTokens === 0) {
      return;
    }
    const gatewayProviderId = options.providerId();
    if (!gatewayProviderId) {
      return;
    }
    const host = options.getHost();
    if (!host) {
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
      const current = await host.call<{ session?: { providerId?: string | null } | null }>(
        "session.get",
        { id: sessionId },
      );
      if (current?.session?.providerId !== gatewayProviderId) {
        return;
      }

      const gatewayId = options.client.currentProfile()?.gateway?.id ?? null;
      const model = options.client.currentProfile()?.gateway?.model ?? null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const result = await options.client.chargeUsage({
            requestId,
            gatewayId,
            model,
            promptTokens,
            completionTokens,
          });
          if (!result.duplicate) {
            log("runtime", "info", "control plane usage charged", {
              sessionId,
              data: {
                turnId,
                promptTokens,
                completionTokens,
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
                promptTokens,
                completionTokens,
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
        data: { turnId, error: error instanceof Error ? error.message : String(error) },
      });
    } finally {
      inflight.delete(requestId);
    }
  }

  return { reportTurn };
}
