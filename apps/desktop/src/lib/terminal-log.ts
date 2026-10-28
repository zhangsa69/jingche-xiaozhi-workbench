import { getToolAction, getToolSummaryValue } from "./tool-display.ts";
import {
  buildToolPresentation,
  runOutcome,
  toolResultPayload,
  type ToolBlock,
} from "./tool-presentation.ts";

/*
 * W-15: the session's commands, in one scrolling stream.
 *
 * This is a projection of the transcript, not a terminal. The renderer already
 * receives every call and its output as events (`tool_start`, `tool_update`,
 * `tool_end`), so a shell view needs no channel, no process, and nothing
 * persisted of its own — the panel draws what the conversation already holds.
 *
 * Extraction is delegated to `buildToolPresentation`, which already knows the
 * one rule this panel would otherwise re-derive and get subtly wrong: a running
 * call reports `details.output`, a finished one reports `details.stdout`, and a
 * present-but-empty stdout has to win over a stale progress snapshot.
 *
 * What it deliberately is not is interactive. stdin, a tty, and window resizing
 * need a pty plus a permission model for arbitrary input; that is a different
 * feature with a different threat model, not a bigger version of this one.
 */

/**
 * Output kept per command, taken from the tail.
 *
 * A command worth watching ends at its error, not at the banner it printed
 * first, so the cut is from the front — and it is stated in the row rather than
 * performed silently. The transcript still holds the whole output, because this
 * is a view: clipping here cannot lose anything.
 */
export const TERMINAL_ENTRY_CHARS = 8_000;

export type TerminalMessage = {
  id?: string;
  content?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  toolStatus?: string;
  toolDurationMs?: number;
  toolCallId?: string;
};

export type TerminalOutcome = ReturnType<typeof runOutcome>;

export type TerminalEntry = {
  /** The message id, so a row can hand the reader back to the transcript. */
  id: string;
  command: string;
  stdout: string;
  stderr: string;
  /** Host notes about the result itself, e.g. that the runtime cut the output. */
  notices: string[];
  outcome: TerminalOutcome;
  exitCode: number | null;
  durationMs: number | null;
  /** Characters dropped from the front of this row's output. */
  omittedChars: number;
};



function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function blockText(blocks: readonly ToolBlock[], role: "stdout" | "stderr"): string {
  return blocks
    .filter(
      (block): block is Extract<ToolBlock, { kind: "code" }> =>
        block.kind === "code" && block.role === role,
    )
    .map((block) => block.text)
    .join("\n");
}

/**
 * An unshaped result — an imported session, or a run tool returning a bare
 * string — has no `details` to read, so its text is all there is.
 *
 * Only these two shapes qualify. A structured result whose stdout is empty must
 * not fall back to the message body: that body is the pretty-printed JSON of the
 * very result that said nothing, and printing it would invent output.
 */
function unstructuredText(message: TerminalMessage): string {
  if (typeof message.toolResult === "string") return message.toolResult;
  if (message.toolResult === undefined || message.toolResult === null) {
    return message.content ?? "";
  }
  return "";
}

function clipTail(text: string, limit: number): { text: string; omitted: number } {
  if (text.length <= limit) return { text, omitted: 0 };
  const start = text.length - limit;
  // Start on a line boundary when one is near: half a line at the top reads as
  // corrupted output rather than as a cut.
  const newline = text.indexOf("\n", start);
  const cut = newline === -1 || newline - start > 200 ? start : newline + 1;
  return { text: text.slice(cut), omitted: cut };
}

function exitCodeOf(message: TerminalMessage): number | null {
  const details = asRecord(toolResultPayload(message));
  const value = details?.exitCode;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * One command, or null when the call is not a command at all.
 *
 * A run call whose arguments carry no command is skipped: the panel's premise is
 * "this is what ran", and a row that cannot say that is noise. The transcript
 * still lists the call, so skipping it here hides nothing.
 */
export function terminalEntry(message: TerminalMessage): TerminalEntry | null {
  if (getToolAction(message.toolName) !== "run") return null;
  const command = getToolSummaryValue(message.toolName, message.toolArgs).trim();
  if (!command) return null;

  const blocks = buildToolPresentation(message, { hideSummaryArg: true });
  const stdout = blockText(blocks, "stdout");
  const stderr = blockText(blocks, "stderr");
  const shaped = stdout !== "" || stderr !== "";
  const notices = blocks
    .filter(
      (block): block is Extract<ToolBlock, { kind: "note" }> =>
        block.kind === "note" &&
        (block.role === "notice" || block.role === "error"),
    )
    .map((block) => block.text);

  const clipped = clipTail(
    shaped ? stdout : unstructuredText(message),
    TERMINAL_ENTRY_CHARS,
  );
  const clippedError = clipTail(stderr, TERMINAL_ENTRY_CHARS);
  const durationMs =
    typeof message.toolDurationMs === "number" && message.toolDurationMs > 0
      ? message.toolDurationMs
      : null;

  return {
    id: message.toolCallId ?? message.id ?? "",
    command,
    stdout: clipped.text,
    stderr: clippedError.text,
    notices,
    outcome: runOutcome(message),
    exitCode: exitCodeOf(message),
    durationMs,
    omittedChars: clipped.omitted + clippedError.omitted,
  };
}

/**
 * The session's commands in the order they ran.
 *
 * No paging: a scroll container driven by pinned-follow sets `overflow-anchor:
 * none` (D302), so prepending an older page would shove the viewport down
 * rather than keep the reader where they were. Every command is mounted, and
 * the per-entry clip is what bounds the text.
 */
export function terminalEntries(
  messages: readonly TerminalMessage[],
): TerminalEntry[] {
  const entries: TerminalEntry[] = [];
  for (const message of messages) {
    const entry = terminalEntry(message);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** The states a row has to say out loud. Success, once done, is silence. */
export function terminalState(
  outcome: TerminalOutcome,
): "running" | "failed" | "denied" | null {
  if (outcome === "running" || outcome === "failed" || outcome === "denied") {
    return outcome;
  }
  return null;
}

/**
 * Everything the panel shows, as text, for the copy action.
 *
 * stdout then stderr, in that order: the host returns two strings rather than
 * one interleaved stream, so the real order is not recoverable — the same
 * limitation the transcript's expanded body has.
 */
export function terminalText(entries: readonly TerminalEntry[]): string {
  return entries
    .map((entry) => {
      const body = [entry.stdout, entry.stderr]
        .filter((part) => part !== "")
        .join("\n");
      return `$ ${entry.command}${body ? `\n${body}` : ""}`;
    })
    .join("\n\n");
}
