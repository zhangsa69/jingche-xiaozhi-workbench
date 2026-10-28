import type { UiMessage } from "@pi-desktop/shared";
import type { AppState, AutoRetryPlan } from "../app-state";
import type { StoreAccess } from "./types";
import {
  autoRetryDelayMs,
  nextAutoRetryBudget,
  shouldRunScheduledRetry,
  type AutoRetryBudget,
} from "../../lib/auto-retry";

/**
 * Spent rounds per session, kept in module scope on purpose: the store entry is
 * cleared as soon as a round starts (the error row goes away with the new
 * request), so the next failure has to keep counting instead of restarting the
 * schedule at round one. Clearing it on the next failure would turn three
 * rounds into an endless loop.
 */
const budgets = new Map<string, AutoRetryBudget>();
let timer: ReturnType<typeof setTimeout> | null = null;
/** Guards against a stale timer firing after the plan was replaced. */
let generation = 0;

function clearTimer(): void {
  generation += 1;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/** The error a scheduled round is meant to recover from, if it is still last. */
function lastErrorCode(messages: readonly UiMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") return null;
    if (message.role === "assistant") return message.error?.code ?? null;
  }
  return null;
}

/** Test hook: forget every budget and pending timer. */
export function resetAutoRetryState(): void {
  budgets.clear();
  clearTimer();
}

export function createAutoRetrySlice({ get, set }: StoreAccess): Pick<
  AppState,
  "autoRetry" | "scheduleAutoRetry" | "cancelAutoRetry" | "retryAutoNow"
> {
  const arm = (plan: AutoRetryPlan): void => {
    clearTimer();
    const token = generation;
    set({ autoRetry: plan });
    timer = setTimeout(() => {
      timer = null;
      // A newer plan (or a cancel) bumped the generation; this timer is stale.
      if (token !== generation) return;
      get().retryAutoNow();
    }, Math.max(0, plan.dueAt - Date.now()));
  };

  return {
    autoRetry: null,

    scheduleAutoRetry: ({ code, sessionId }) => {
      // Only the session on screen is re-sent automatically. A background
      // session that fails must not start a request the user cannot see.
      if (get().activeSessionId !== sessionId) {
        clearTimer();
        set({ autoRetry: null });
        return;
      }
      const now = Date.now();
      const next = nextAutoRetryBudget(budgets.get(sessionId), code, now);
      if (!next) {
        budgets.delete(sessionId);
        clearTimer();
        set({ autoRetry: null });
        return;
      }
      const delayMs = autoRetryDelayMs(next.rounds);
      if (delayMs === null) {
        budgets.delete(sessionId);
        clearTimer();
        set({ autoRetry: null });
        return;
      }
      budgets.set(sessionId, next);
      arm({
        round: next.rounds,
        delayMs,
        dueAt: now + delayMs,
        sessionId,
        errorCode: code,
      });
    },

    cancelAutoRetry: () => {
      const plan = get().autoRetry;
      if (plan) budgets.delete(plan.sessionId);
      clearTimer();
      set({ autoRetry: null });
    },

    retryAutoNow: () => {
      const plan = get().autoRetry;
      if (!plan) return;
      clearTimer();
      const state = get();
      const allowed = shouldRunScheduledRetry({
        scheduledSessionId: plan.sessionId,
        activeSessionId: state.activeSessionId,
        isRunning: state.isRunning,
        expectedCode: plan.errorCode,
        lastErrorCode: lastErrorCode(state.messages),
      });
      // Whatever changed, the plan is spent: the user moved on, stopped, or the
      // transcript no longer ends in the error this round was meant to fix.
      set({ autoRetry: null });
      if (!allowed) {
        budgets.delete(plan.sessionId);
        return;
      }
      void get().retryLastPrompt();
    },
  };
}
