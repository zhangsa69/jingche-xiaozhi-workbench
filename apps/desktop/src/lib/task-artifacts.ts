import type { ReviewChangeStatus, UiMessage } from "@pi-desktop/shared";
// Explicit extension: `node --test` strips types without a bundler, so a
// runtime import needs a real specifier (tsconfig allows `.ts` imports).
import { reviewChangesFromMessages } from "./workspace-review.ts";

/** One file the agent wrote to during this task, newest change wins. */
export type TaskArtifact = {
  path: string;
  additions: number;
  deletions: number;
};

/**
 * One file with every write it received in this task folded together: the
 * counts come from the latest snapshot (summing snapshots would count the same
 * lines twice), while `snapshots` says how many times the agent came back.
 */
export type TaskChangeGroup = {
  path: string;
  additions: number;
  deletions: number;
  status: ReviewChangeStatus;
  rolledBack: boolean;
  snapshots: number;
};

/**
 * Collect the files this task produced.
 *
 * "Artifact" here means a workspace write the transcript can prove: the review
 * record embedded in a successful `Write`/`Edit` message. Rolled-back changes
 * are excluded — the file's current state no longer matches them.
 */
export function collectTaskArtifacts(messages: UiMessage[]): TaskArtifact[] {
  const byPath = new Map<string, TaskArtifact>();
  for (const entry of reviewChangesFromMessages(messages)) {
    const { change } = entry;
    if (change.state !== "active") continue;
    byPath.set(change.path, {
      path: change.path,
      additions: change.additions,
      deletions: change.deletions,
    });
  }
  return [...byPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

/**
 * The same review records, grouped by path instead of filtered.
 *
 * The artifacts tab needs both shapes from one pass of evidence: "produced"
 * (active only, what the task left behind) and "changed" (every file it touched,
 * rolled-back ones kept but demoted, because undoing a change is part of the
 * story and a file that is still dirty deserves to be seen first).
 */
export function groupTaskChanges(messages: UiMessage[]): TaskChangeGroup[] {
  const byPath = new Map<string, TaskChangeGroup>();
  for (const { change } of reviewChangesFromMessages(messages)) {
    byPath.set(change.path, {
      path: change.path,
      additions: change.additions,
      deletions: change.deletions,
      status: change.status,
      rolledBack: change.state !== "active",
      snapshots: (byPath.get(change.path)?.snapshots ?? 0) + 1,
    });
  }
  return [...byPath.values()].sort(
    (left, right) =>
      Number(left.rolledBack) - Number(right.rolledBack) ||
      left.path.localeCompare(right.path),
  );
}

/** Keep the tail of a long workspace path; panel rows are narrow. */
export function shortArtifactPath(path: string, keep = 2): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts.length > keep ? `…/${parts.slice(-keep).join("/")}` : path;
}
