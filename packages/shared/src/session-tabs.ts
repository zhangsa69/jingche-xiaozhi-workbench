/**
 * Session tab arithmetic.
 *
 * A tab is a view, not a session: closing one never deletes anything, it only
 * stops keeping that conversation one click away. The bar therefore has no
 * persistence story of its own and can be recomputed from ids alone.
 */

/** How many conversations the bar keeps within reach. */
export const MAX_SESSION_TABS = 8;

/**
 * Open (or keep) a tab. Existing tabs hold their position so switching around
 * does not reshuffle the bar under the pointer; only a new open appends.
 *
 * Over the limit the oldest open drops out — the session itself stays in the
 * sidebar, so the loss is one click, not work.
 */
export function openSessionTab(
  tabs: readonly string[],
  id: string,
  limit: number = MAX_SESSION_TABS,
): string[] {
  const key = id.trim();
  const width = Math.max(1, limit);
  const seen = new Set<string>();
  const next: string[] = [];
  for (const tab of tabs) {
    if (!tab || seen.has(tab)) continue;
    seen.add(tab);
    next.push(tab);
  }
  if (!key) return next;
  if (!seen.has(key)) next.push(key);
  return next.slice(-width);
}

/** Drop one tab, leaving the rest in order. */
export function closeSessionTab(tabs: readonly string[], id: string): string[] {
  return tabs.filter((tab) => tab !== id);
}

/**
 * Which tab to show after closing `closedId` while `activeId` was open.
 * Closing an inactive tab changes nothing. Closing the active one hands over to
 * its right neighbour, then to its left — the nearest thing to where the user
 * was looking.
 */
export function activeSessionTabAfterClose(
  tabs: readonly string[],
  closedId: string,
  activeId: string | undefined,
): string | undefined {
  if (activeId !== closedId) return activeId;
  const index = tabs.indexOf(closedId);
  if (index < 0) return activeId;
  const remaining = tabs.filter((tab) => tab !== closedId);
  if (!remaining.length) return undefined;
  return remaining[Math.min(index, remaining.length - 1)];
}

/**
 * Forget tabs whose session no longer exists. Deleted or archived sessions must
 * not leave a tab that opens an empty transcript.
 */
export function pruneSessionTabs(
  tabs: readonly string[],
  liveIds: Iterable<string>,
): string[] {
  const live = new Set(liveIds);
  const next: string[] = [];
  for (const tab of tabs) {
    if (live.has(tab) && !next.includes(tab)) next.push(tab);
  }
  return next;
}

/** Tabs hidden by the limit, so the bar can say so instead of lying. */
export function hiddenSessionTabCount(
  tabs: readonly string[],
  limit: number = MAX_SESSION_TABS,
): number {
  return Math.max(0, tabs.length - Math.max(0, limit));
}
