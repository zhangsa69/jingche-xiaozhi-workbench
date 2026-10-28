/**
 * Task history: the read-only view over sessions that already have output,
 * plus the three ways to start over from one.
 *
 * Everything the page decides — which sessions count as tasks, how they are
 * grouped by day, what an action will do before it touches the store — is a
 * pure function here, so the page stays a render and the rules stay testable.
 */
import type { SessionSummary, UiMessage } from "@pi-desktop/shared";

export type TaskHistoryRow = {
  id: string;
  /** Empty string when the session was never named; the page supplies a label. */
  title: string;
  projectPath: string | null;
  modelId: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  /** Native (Pi) transcripts cannot be continued from the desktop surface. */
  readOnly: boolean;
};

/** Newest-first cap: history is a working list, not an archive. */
export const TASK_HISTORY_LIMIT = 200;

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Sessions that produced something.
 *
 * A session with zero messages is a draft the user never sent, so listing it as
 * a task invites a rerun of nothing.
 */
export function deriveTaskHistory(
  sessions: readonly SessionSummary[],
  limit: number = TASK_HISTORY_LIMIT,
): TaskHistoryRow[] {
  return sessions
    .filter((session) => (session.messageCount ?? 0) > 0)
    .map((session) => ({
      id: session.id,
      title: (session.title ?? "").trim(),
      projectPath: session.projectPath ?? null,
      modelId: session.modelId ?? null,
      messageCount: session.messageCount ?? 0,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      readOnly: session.source === "pi-native",
    }))
    .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))
    .slice(0, limit);
}

export type TaskHistoryGroup = {
  /** `today` / `yesterday` are labels; anything older is a `YYYY-MM-DD` date. */
  key: string;
  rows: TaskHistoryRow[];
};

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function dateKey(value: Date): string {
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

/** `today`, `yesterday`, or the local calendar date of `updatedAt`. */
export function taskDayKey(updatedAt: string, now: Date): string {
  const at = timestamp(updatedAt);
  if (!at) return "unknown";
  const today = startOfDay(now);
  const day = startOfDay(new Date(at));
  const dayMs = 24 * 60 * 60 * 1000;
  if (day === today) return "today";
  if (day === today - dayMs) return "yesterday";
  return dateKey(new Date(at));
}

/** Groups rows in the order already sorted, keeping day order stable. */
export function groupTaskHistory(
  rows: readonly TaskHistoryRow[],
  now: Date,
): TaskHistoryGroup[] {
  const groups: TaskHistoryGroup[] = [];
  for (const row of rows) {
    const key = taskDayKey(row.updatedAt, now);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else groups.push({ key, rows: [row] });
  }
  return groups;
}

/**
 * The prompt a rerun should send: the first thing the user actually asked.
 *
 * Later user turns are steering or follow-ups; replaying the last one would
 * repeat a correction against a conversation that no longer exists.
 */
export function taskSourcePrompt(
  messages: readonly Pick<UiMessage, "role" | "content">[],
): string | null {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const content = (message.content ?? "").trim();
    if (content) return content;
  }
  return null;
}

export type TaskReuseMode = "rerun" | "input" | "workspace";

export type TaskReusePlan = {
  /** Workspace the new session is created in; `null` means "no project". */
  projectPath: string | null;
  /** Whether the reused prompt is sent immediately. */
  sendPrompt: boolean;
  /** Whether the caller must read the old transcript first. */
  needsPrompt: boolean;
};

/**
 * What each button does, decided once:
 * - rerun: same workspace, same prompt, new session.
 * - input: same prompt, no workspace (the old folder may be gone).
 * - workspace: same folder only, so the user can restate the task themselves.
 */
export function taskReusePlan(
  mode: TaskReuseMode,
  row: Pick<TaskHistoryRow, "projectPath">,
): TaskReusePlan {
  const projectPath = row.projectPath ?? null;
  if (mode === "workspace") {
    return { projectPath, sendPrompt: false, needsPrompt: false };
  }
  return {
    projectPath: mode === "rerun" ? projectPath : null,
    sendPrompt: true,
    needsPrompt: true,
  };
}
