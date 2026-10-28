/**
 * W-04: an identical call that keeps returning the same thing is a loop, not
 * work.
 *
 * The runtime pauses the third attempt and asks through the existing asktool
 * channel instead of adding a second round trip. That channel carries text
 * meant for humans, and the words have to be localized — so the question
 * travels as a stable token and the renderer supplies the sentence. Both sides
 * read the token from here, which is what keeps them from drifting.
 */

export const REPEAT_GUARD_PREFIX = "@@repeat-guard@@";

export const REPEAT_GUARD_DECISIONS = ["continue", "stop"] as const;
export type RepeatGuardDecision = (typeof REPEAT_GUARD_DECISIONS)[number];

export type RepeatGuardPrompt = {
  toolName: string;
  attempts: number;
};

/** The wire form of the question: prefix, tool name, attempt count. */
export function repeatGuardQuestion(prompt: RepeatGuardPrompt): string {
  return `${REPEAT_GUARD_PREFIX}${prompt.toolName}|${prompt.attempts}`;
}

/**
 * Recognizes our own question and nothing else: a model that happens to write
 * the prefix without the shape still reads as an ordinary question.
 */
export function parseRepeatGuardQuestion(
  question: string,
): RepeatGuardPrompt | null {
  if (!question.startsWith(REPEAT_GUARD_PREFIX)) return null;
  const body = question.slice(REPEAT_GUARD_PREFIX.length);
  const separator = body.lastIndexOf("|");
  if (separator <= 0) return null;
  const toolName = body.slice(0, separator).trim();
  const attempts = Number.parseInt(body.slice(separator + 1), 10);
  if (toolName.length === 0 || !Number.isInteger(attempts) || attempts < 2) {
    return null;
  }
  return { toolName, attempts };
}

/**
 * Anything that is not an explicit `continue` stops: a dismissed card, a closed
 * window, and an aborted turn all mean "do not keep looping".
 */
export function resolveRepeatGuardDecision(
  answers: readonly (readonly string[] | null)[] | null | undefined,
): RepeatGuardDecision {
  const first = answers?.[0]?.[0];
  return first === "continue" ? "continue" : "stop";
}
