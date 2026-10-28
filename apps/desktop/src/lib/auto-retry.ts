/**
 * Renderer-side continuation of a failed turn.
 *
 * The runtime already retries a limited number of times inside one logical turn
 * (`PROVIDER_RETRY_MAX_RETRIES`), which covers a short burst. A provider window
 * that is still exhausted when that budget runs out used to surface an error row
 * and wait for a click, even though the user's next click normally went through.
 * This module decides when the renderer may re-send the same prompt on its own,
 * so a rate-limited turn recovers without a click while every attempt stays
 * visible and cancellable.
 *
 * The schedule is deliberately short (three rounds, growing gaps): a provider
 * that needs longer than this is not rate limiting any more, it is out of
 * credit, misconfigured or down, and the error row should say so.
 */

/** Extra rounds the renderer may start after the runtime budget is exhausted. */
export const AUTO_RETRY_MAX_ROUNDS = 3;

/**
 * Gap before each extra round. Growing instead of constant: a fixed 30s times
 * three would give up inside the same window that produced the failure.
 */
export const AUTO_RETRY_SCHEDULE_MS: readonly number[] = [30_000, 90_000, 180_000];

/**
 * Codes worth re-sending unchanged. `PROVIDER_RATE_LIMITED` is the target case;
 * the transient transport codes are included because the same "try again in a
 * moment" failure that exhausts a 70s budget usually clears later too.
 *
 * Deliberately excluded: `PROVIDER_UNAUTHORIZED`, `PROVIDER_SECRET_MISSING`,
 * `MODEL_NOT_CONFIGURED`, `CONTEXT_TOO_LARGE`, `TURN_ABORTED` — re-sending the
 * same request cannot fix any of them, and retrying a user's Stop is wrong.
 */
const AUTO_RETRYABLE_CODES: ReadonlySet<string> = new Set([
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_ERROR",
  "NETWORK_ERROR",
  "TIMEOUT",
  "STREAM_FAILED",
]);

/** Whether the renderer may schedule another round for this error code. */
export function isAutoRetryableCode(code: string | null | undefined): boolean {
  return typeof code === "string" && AUTO_RETRYABLE_CODES.has(code);
}

/**
 * Gap before round `round` (1-based), or `null` once the schedule is spent.
 * Rounds past the end are exhausted, not clamped: silently repeating the last
 * gap would make "three rounds" mean "forever".
 */
export function autoRetryDelayMs(round: number): number | null {
  if (!Number.isFinite(round)) return null;
  const index = Math.floor(round) - 1;
  if (index < 0 || index >= AUTO_RETRY_SCHEDULE_MS.length) return null;
  return AUTO_RETRY_SCHEDULE_MS[index];
}

/**
 * Whole seconds until `dueAt`, rounded up so the notice never shows "0s" while
 * the timer still has work to do.
 */
export function autoRetrySecondsLeft(dueAt: number, now: number): number {
  return Math.max(0, Math.ceil((dueAt - now) / 1_000));
}

/**
 * The last gates before a scheduled round actually re-sends: the turn must have
 * stopped, the user must still be looking at the session that failed, and the
 * visible transcript must still end in the same error. Any of these changing
 * means the user moved on, so the timer must stay silent.
 */
export function shouldRunScheduledRetry(input: {
  scheduledSessionId: string;
  activeSessionId: string | null | undefined;
  isRunning: boolean;
  expectedCode: string;
  lastErrorCode?: string | null;
}): boolean {
  if (input.isRunning) return false;
  if (!input.activeSessionId) return false;
  if (input.activeSessionId !== input.scheduledSessionId) return false;
  return input.lastErrorCode === input.expectedCode;
}

/**
 * Per-session budget of extra rounds. Kept outside the store because it has to
 * survive the attempt itself: the store entry is cleared when a round starts
 * (the error row disappears), and the next failure has to continue counting
 * instead of restarting at round one.
 */
export type AutoRetryBudget = {
  code: string;
  rounds: number;
  at: number;
};

/**
 * A failure of a different code, or one separated by more than an hour, starts
 * a fresh budget: it is a new incident, not the tail of the old one.
 */
export const AUTO_RETRY_BUDGET_TTL_MS = 60 * 60 * 1_000;

/** Next budget for a failure, or `null` when the schedule is spent. */
export function nextAutoRetryBudget(
  previous: AutoRetryBudget | undefined,
  code: string,
  now: number,
): AutoRetryBudget | null {
  if (!isAutoRetryableCode(code)) return null;
  const continuing =
    previous !== undefined &&
    previous.code === code &&
    now - previous.at <= AUTO_RETRY_BUDGET_TTL_MS;
  const rounds = continuing ? previous.rounds + 1 : 1;
  if (rounds > AUTO_RETRY_MAX_ROUNDS) return null;
  return { code, rounds, at: now };
}
