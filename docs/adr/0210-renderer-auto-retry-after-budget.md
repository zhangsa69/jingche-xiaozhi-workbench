# ADR 0210: Continue a rate-limited turn in the renderer after the budget ends

- Status: Accepted
- Date: 2026-10-28
- Deciders: PI-Desktop core
- Related: ADR 0206, ADR 0091, ADR 0128

## Context

ADR 0206 gave the runtime ten retries per provider class inside one logical
turn. That covers a burst, but the window behind a quota error is often longer
than the resulting wait: a 429 schedule with a 30-second cap runs out after about
three and a half minutes, and a non-429 "limit exceeded" body runs out after
about seventy seconds. When that happened the turn ended in a terminal error row
that offered "continue" and "open settings" but no retry, so the only recovery
was to send the same prompt by hand.

Users report that one manual retry after the failure almost always succeeds:
the provider window had reopened, the turn was not broken. The product should
do that click itself, as long as every attempt stays visible and cancellable.

## Decision

1. The renderer may start at most three further rounds after the runtime budget
   is exhausted, waiting 30 s, 90 s and 180 s. The gaps grow because a constant
   30 s would give up inside the same window that produced the failure.
2. Only `PROVIDER_RATE_LIMITED`, `PROVIDER_ERROR`, `NETWORK_ERROR`, `TIMEOUT`
   and `STREAM_FAILED` qualify. `PROVIDER_UNAUTHORIZED`,
   `PROVIDER_SECRET_MISSING`, `MODEL_NOT_CONFIGURED`, `CONTEXT_TOO_LARGE` and
   `TURN_ABORTED` never do: re-sending cannot fix them, and retrying a user's
   Stop is wrong.
3. A round is armed only for the session on screen. Before re-sending, the
   renderer re-checks that no turn is running, that the active session is still
   the one that failed, and that the transcript still ends in that same error
   code. Any change means the user moved on and the timer stays silent.
4. Spent rounds are counted per session in module scope, not in the store. The
   store entry is cleared when a round starts (the error row goes away with the
   new request), so keeping the count in the store would restart the schedule at
   round one on every failure and turn three rounds into a loop. A different
   error code, or the same one an hour later, starts a fresh budget.
5. The error card shows the countdown, "retry now", and "cancel auto retry"; a
   hand-driven retry clears the budget first and starts over.
6. Quota wording outranks an auth-looking status. 402, and 403 whose body talks
   about quota, limit or capacity, classify as `PROVIDER_RATE_LIMITED`; 401 and a
   403 without that wording stay terminal so a bad key is not hammered. The
   context pattern is checked before the quota pattern so "token limit exceeded"
   keeps `CONTEXT_TOO_LARGE`.
7. The error card gains a plain "retry" action, because a retryable failure
   previously had no one-click recovery at all.

## Consequences

- An unattended turn can recover from a window that outlives the runtime budget,
  at the cost of up to about five extra minutes of waiting before the error row
  becomes final.
- Each round is a new provider request and therefore a new token charge; only
  the failed request is re-sent, never the successful messages before it.
- The schedule is bounded in both directions (three rounds, growing gaps), so a
  provider that is out of credit or misconfigured still ends in an error instead
  of retrying all night.
- Aborting, switching sessions, or sending a new prompt always wins over a
  pending round, because those conditions are re-checked at fire time rather
  than only when the timer is armed.
