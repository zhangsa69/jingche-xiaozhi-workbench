/**
 * Pinned context (W-33).
 *
 * The user ticks turns of the current conversation and those turns are carried
 * into the next prompt verbatim. Nothing is summarised and nothing is inferred:
 * a pin is a line the user pointed at, so the block quotes it and says where it
 * came from. This is what makes a long conversation workable after compaction —
 * the turns that matter can be put back without replaying everything.
 */

/** How many turns one prompt may carry. */
export const MAX_CONTEXT_PINS = 8;
/** Characters of pinned text one prompt may carry. */
export const MAX_CONTEXT_PIN_CHARS = 1_600;
/** Characters shown per row in the picker. */
export const CONTEXT_PIN_EXCERPT_CHARS = 120;

export type ContextPinRole = "user" | "assistant" | "system";

export type ContextPinMessage = {
  id: string;
  role: ContextPinRole;
  text: string;
};

export type ContextPinCandidate = ContextPinMessage & {
  /** One line for the picker row, never the whole message. */
  excerpt: string;
  chars: number;
};

export type ContextPinSelection = {
  /** In transcript order, not click order — a prompt reads forwards. */
  pins: ContextPinCandidate[];
  /** Pins that did not fit the character budget. */
  dropped: number;
};

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Rows for the picker. Empty turns are skipped: an assistant placeholder that
 * never produced text is not something anyone can meaningfully pin.
 */
export function contextPinCandidates(
  messages: readonly ContextPinMessage[],
  options: { limit?: number } = {},
): ContextPinCandidate[] {
  const limit = Math.max(0, options.limit ?? 200);
  const rows: ContextPinCandidate[] = [];
  for (const message of messages) {
    if (rows.length >= limit) break;
    const text = message.text ?? "";
    if (!text.trim()) continue;
    if (!message.id) continue;
    const excerpt = collapse(text);
    rows.push({
      id: message.id,
      role: message.role,
      text,
      excerpt:
        excerpt.length > CONTEXT_PIN_EXCERPT_CHARS
          ? `${excerpt.slice(0, CONTEXT_PIN_EXCERPT_CHARS)}…`
          : excerpt,
      chars: text.length,
    });
  }
  return rows;
}

/**
 * Resolve ticks to a sendable selection. Unknown ids are ignored rather than
 * substituted, and the budget is spent in transcript order so a pin that fits
 * early is never dropped because a later one was ticked first.
 */
export function selectContextPins(
  candidates: readonly ContextPinCandidate[],
  ids: readonly string[],
  options: { budget?: number; limit?: number } = {},
): ContextPinSelection {
  const budget = Math.max(0, options.budget ?? MAX_CONTEXT_PIN_CHARS);
  const limit = Math.max(0, options.limit ?? MAX_CONTEXT_PINS);
  const wanted = new Set(ids);
  const pins: ContextPinCandidate[] = [];
  let spent = 0;
  let dropped = 0;
  for (const candidate of candidates) {
    if (!wanted.has(candidate.id)) continue;
    if (pins.length >= limit || spent + candidate.chars > budget) {
      dropped += 1;
      continue;
    }
    spent += candidate.chars;
    pins.push(candidate);
  }
  return { pins, dropped };
}

/** Characters the selection will add to the prompt. */
export function contextPinUsage(pins: readonly ContextPinCandidate[]): number {
  return pins.reduce((total, pin) => total + pin.chars, 0);
}

/**
 * The block appended to the outgoing prompt. It says the quotes are verbatim and
 * that the live transcript may not contain them any more, because a model that
 * assumes continuity will answer the wrong question.
 */
export function buildContextPinBlock(pins: readonly ContextPinCandidate[]): string {
  if (!pins.length) return "";
  const header =
    "The user pinned these turns from earlier in this conversation. " +
    "They are quoted verbatim; the live transcript may no longer carry them. " +
    "Treat them as the user's chosen record of what was agreed.";
  const body = pins.map((pin) => `> ${pin.role}: ${collapse(pin.text)}`).join("\n");
  return `${header}\n${body}`;
}
