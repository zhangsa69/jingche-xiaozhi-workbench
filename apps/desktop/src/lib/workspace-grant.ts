/**
 * The folder brief: what the agent may read, where its output lands, and what
 * stays on this machine — stated once per workspace before the first task.
 *
 * The brief is not a permission gate: tool-level approvals already exist and a
 * folder-wide grant would silently widen them. It is a one-paragraph answer to
 * "what happens if I press send here", so the rules live in pure functions and
 * the card stays a render.
 */

/** Where the session's files come from when no workspace is bound yet. */
export type WorkspaceBriefKind = "project" | "temporary";

export type WorkspaceBriefRowId = "writes" | "reads" | "keeps";

export type WorkspaceBrief = {
  kind: WorkspaceBriefKind;
  /** Displayable folder path; `null` when nothing is bound yet. */
  location: string | null;
  /** Rows in the order that answers "what will happen when I send". */
  rows: WorkspaceBriefRowId[];
  /** A session with no folder must offer the picker instead of describing one. */
  needsFolder: boolean;
};

/** Trim, drop trailing separators, and use forward slashes for display. */
export function normalizeWorkspacePath(path: string | null | undefined): string {
  const trimmed = (path ?? "").trim();
  if (!trimmed) return "";
  const slashed = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  // A bare root like `C:` or `/` must keep its separator to stay meaningful.
  if (!slashed) return trimmed.replace(/\\/g, "/");
  return /^[a-zA-Z]:$/.test(slashed) ? `${slashed}/` : slashed;
}

/**
 * Dismissal memory key.
 *
 * Case and separator style are presentation details of the same folder, so
 * `E:\work` and `e:/work/` must share one key; otherwise the brief reappears
 * the moment a path is echoed back in another shape.
 */
export function workspaceGrantKey(
  path: string | null | undefined,
  kind: WorkspaceBriefKind,
): string {
  const normalized = normalizeWorkspacePath(path);
  if (!normalized) return `${kind}:`;
  return `${kind}:${normalized.toLowerCase()}`;
}

/** The facts the card prints, resolved from whichever path the shell knows. */
export function workspaceBrief(input: {
  projectPath?: string | null;
  fallbackPath?: string | null;
}): WorkspaceBrief {
  const location =
    normalizeWorkspacePath(input.projectPath) ||
    normalizeWorkspacePath(input.fallbackPath);
  const kind: WorkspaceBriefKind = location ? "project" : "temporary";
  return {
    kind,
    location: location || null,
    // Writes first: it is the question users actually ask before a first send.
    rows: ["writes", "reads", "keeps"],
    needsFolder: !location,
  };
}

/**
 * Show once per folder, plus once for the folderless case.
 *
 * A dismissed folder stays dismissed even after the app restarts, because the
 * reminder is about that folder, not about this run.
 */
export function shouldShowWorkspaceBrief(
  brief: WorkspaceBrief,
  dismissedKeys: readonly string[],
): boolean {
  return !dismissedKeys.includes(workspaceGrantKey(brief.location, brief.kind));
}

/** Immutable add, so callers can keep dismissal list in React state. */
export function rememberWorkspaceBrief(
  dismissedKeys: readonly string[],
  brief: WorkspaceBrief,
): string[] {
  const key = workspaceGrantKey(brief.location, brief.kind);
  return dismissedKeys.includes(key) ? [...dismissedKeys] : [...dismissedKeys, key];
}
