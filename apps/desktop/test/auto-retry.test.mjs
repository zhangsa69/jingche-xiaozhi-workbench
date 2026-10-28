import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AUTO_RETRY_BUDGET_TTL_MS,
  AUTO_RETRY_MAX_ROUNDS,
  autoRetryDelayMs,
  autoRetrySecondsLeft,
  isAutoRetryableCode,
  nextAutoRetryBudget,
  shouldRunScheduledRetry,
} from "../src/lib/auto-retry.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("only codes that a resend can fix are retried automatically", () => {
  for (const code of [
    "PROVIDER_RATE_LIMITED",
    "PROVIDER_ERROR",
    "NETWORK_ERROR",
    "TIMEOUT",
    "STREAM_FAILED",
  ]) {
    assert.equal(isAutoRetryableCode(code), true, code);
  }
  for (const code of [
    "PROVIDER_UNAUTHORIZED",
    "PROVIDER_SECRET_MISSING",
    "MODEL_NOT_CONFIGURED",
    "CONTEXT_TOO_LARGE",
    "TURN_ABORTED",
    "",
    null,
    undefined,
  ]) {
    assert.equal(isAutoRetryableCode(code), false, String(code));
  }
});

test("the schedule grows and then stops instead of clamping", () => {
  assert.equal(autoRetryDelayMs(1), 30_000);
  assert.equal(autoRetryDelayMs(2), 90_000);
  assert.equal(autoRetryDelayMs(3), 180_000);
  // A fourth round would mean "retry forever" if the last gap repeated.
  assert.equal(autoRetryDelayMs(4), null);
  assert.equal(autoRetryDelayMs(0), null);
  assert.equal(autoRetryDelayMs(-1), null);
  assert.equal(autoRetryDelayMs(Number.NaN), null);
});

test("the countdown rounds up and never goes negative", () => {
  assert.equal(autoRetrySecondsLeft(1_000, 0), 1);
  assert.equal(autoRetrySecondsLeft(1_500, 0), 2);
  assert.equal(autoRetrySecondsLeft(30_000, 29_500), 1);
  assert.equal(autoRetrySecondsLeft(30_000, 30_000), 0);
  assert.equal(autoRetrySecondsLeft(30_000, 99_000), 0);
});

test("a scheduled round stays silent once the user moved on", () => {
  const base = {
    scheduledSessionId: "s1",
    activeSessionId: "s1",
    isRunning: false,
    expectedCode: "PROVIDER_RATE_LIMITED",
    lastErrorCode: "PROVIDER_RATE_LIMITED",
  };
  assert.equal(shouldRunScheduledRetry(base), true);

  // A turn already running (the user typed, or a manual retry landed) wins.
  assert.equal(shouldRunScheduledRetry({ ...base, isRunning: true }), false);
  // Another session on screen: never send a request the user cannot see.
  assert.equal(shouldRunScheduledRetry({ ...base, activeSessionId: "s2" }), false);
  assert.equal(shouldRunScheduledRetry({ ...base, activeSessionId: null }), false);
  // The transcript no longer ends in the error this round was armed for.
  assert.equal(shouldRunScheduledRetry({ ...base, lastErrorCode: "TIMEOUT" }), false);
  assert.equal(shouldRunScheduledRetry({ ...base, lastErrorCode: null }), false);
});

test("the round budget continues across attempts but not across a new incident", () => {
  const now = 1_000_000;
  const first = nextAutoRetryBudget(undefined, "PROVIDER_RATE_LIMITED", now);
  assert.deepEqual(first, {
    code: "PROVIDER_RATE_LIMITED",
    rounds: 1,
    at: now,
  });

  const second = nextAutoRetryBudget(first, "PROVIDER_RATE_LIMITED", now + 5_000);
  assert.equal(second.rounds, 2);
  const third = nextAutoRetryBudget(second, "PROVIDER_RATE_LIMITED", now + 10_000);
  assert.equal(third.rounds, 3);
  // The fourth failure is the end of the schedule, not round one again.
  assert.equal(
    nextAutoRetryBudget(third, "PROVIDER_RATE_LIMITED", now + 20_000),
    null,
  );

  // A different code is a different incident.
  assert.equal(
    nextAutoRetryBudget(third, "TIMEOUT", now + 20_000).rounds,
    1,
  );
  // So is the same code an hour after the last round was armed.
  assert.equal(
    nextAutoRetryBudget(
      third,
      "PROVIDER_RATE_LIMITED",
      third.at + AUTO_RETRY_BUDGET_TTL_MS + 1,
    ).rounds,
    1,
  );
  // A terminal code never gets a budget at all.
  assert.equal(
    nextAutoRetryBudget(undefined, "PROVIDER_UNAUTHORIZED", now),
    null,
  );
  assert.ok(AUTO_RETRY_MAX_ROUNDS === 3);
});

test("the error event arms the schedule, and a stop does not", () => {
  const events = read("../src/stores/slices/events-slice.ts");
  assert.match(events, /if \(!aborted\) \{\s*get\(\)\.scheduleAutoRetry\(/);
  // The arming call has to carry the failing session, not the active one.
  assert.match(events, /sessionId: envelope\.sessionId/);

  const slice = read("../src/stores/slices/auto-retry-slice.ts");
  assert.match(slice, /get\(\)\.activeSessionId !== sessionId/);
  assert.match(slice, /void get\(\)\.retryLastPrompt\(\)/);
  // Budgets live outside the store so a started round cannot reset them.
  assert.match(slice, /const budgets = new Map/);
});

test("the error card shows the countdown and a manual retry", () => {
  const shared = read("../src/features/chat/transcript/shared.tsx");
  assert.match(shared, /function AutoRetryNotice/);
  assert.match(shared, /t\("chat\.autoRetryPending"/);
  assert.match(shared, /t\("chat\.autoRetryNow"\)/);
  assert.match(shared, /t\("chat\.autoRetryCancel"\)/);
  assert.match(shared, /t\("chat\.retryResponse"\)/);
  // A manual retry starts a fresh budget instead of resuming the old one.
  assert.match(shared, /cancelAutoRetry\(\);\s*void useAppStore\.getState\(\)\.retryAssistantMessage/);
});
