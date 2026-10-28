import type { ReviewChangeEntry } from "./workspace-review.ts";

export type ReviewRollbackTarget = { messageId: string; snapshotId: string };

export type ReviewChangeGroup = {
  path: string;
  /** Oldest first, matching the transcript, so the diff reads top to bottom. */
  entries: ReviewChangeEntry[];
  additions: number;
  deletions: number;
  activeCount: number;
  rolledBackCount: number;
  /**
   * Newest first: a file edited three times has three snapshots, and undoing
   * them in transcript order would restore an intermediate state over the
   * newest one. Reversal happens in the reverse order it was applied.
   */
  rollbackTargets: ReviewRollbackTarget[];
};

/**
 * One review row per file instead of one per snapshot (W-16).
 *
 * A file the agent edited five times is five snapshots and one file; the
 * per-snapshot list buried the fact that only one file was touched. Grouping
 * is by path, sorted by path rather than by first appearance so the list is
 * scannable in the same order as the file tree.
 */
export function groupReviewChanges(
  entries: ReviewChangeEntry[],
): ReviewChangeGroup[] {
  const byPath = new Map<string, ReviewChangeEntry[]>();
  for (const entry of entries) {
    const list = byPath.get(entry.change.path);
    if (list) list.push(entry);
    else byPath.set(entry.change.path, [entry]);
  }

  return [...byPath.entries()]
    .map(([path, groupEntries]) => {
      let additions = 0;
      let deletions = 0;
      let activeCount = 0;
      let rolledBackCount = 0;
      const rollbackTargets: ReviewRollbackTarget[] = [];

      for (const entry of groupEntries) {
        additions += entry.change.additions;
        deletions += entry.change.deletions;
        if (entry.change.state === "rolledBack") {
          rolledBackCount += 1;
          continue;
        }
        activeCount += 1;
        if (entry.change.reversible) {
          rollbackTargets.push({
            messageId: entry.message.id,
            snapshotId: entry.change.snapshotId,
          });
        }
      }

      return {
        path,
        entries: groupEntries,
        additions,
        deletions,
        activeCount,
        rolledBackCount,
        rollbackTargets: rollbackTargets.reverse(),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}
