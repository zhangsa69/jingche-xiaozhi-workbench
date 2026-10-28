/**
 * Local library (D-26): the folders and files a user keeps on hand, regardless
 * of which workspace the current task runs in.
 *
 * Pure list math so the rules that decide "what can be @-referenced" are tested
 * away from React and from the file-system index: one path appears once, case
 * does not create a second copy, and a library entry never shadows the same
 * path the workspace index already offers.
 */
import type { FsIndexEntry } from "./types/filesystem.js";

export type LibrarySourceKind = "folder" | "file";

export type LibrarySource = {
  /** Stable identity derived from the path, so re-adding is a no-op. */
  id: string;
  name: string;
  path: string;
  kind: LibrarySourceKind;
  addedAt: number;
};

export type AddLibraryResult =
  | { ok: true; sources: LibrarySource[]; source: LibrarySource }
  | { ok: false; sources: LibrarySource[]; reason: "empty" | "duplicate" | "limit" };

export const MAX_LIBRARY_SOURCES = 24;

/** Normalize to forward slashes and drop a trailing separator (keep drive roots). */
export function normalizeLibraryPath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/");
  if (!trimmed) return "";
  const collapsed = trimmed.replace(/\/{2,}/g, "/");
  const withoutTrailing = collapsed.replace(/\/+$/, "");
  // "C:" or "/" would otherwise become an empty string.
  return withoutTrailing || collapsed;
}

export function librarySourceId(path: string): string {
  return `lib:${normalizeLibraryPath(path).toLowerCase()}`;
}

/** Last meaningful path segment; falls back to the whole path for odd roots. */
export function librarySourceName(path: string): string {
  const normalized = normalizeLibraryPath(path);
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? normalized;
}

export function addLibrarySource(
  sources: readonly LibrarySource[],
  input: { path: string; kind: LibrarySourceKind; now?: number },
): AddLibraryResult {
  const normalized = normalizeLibraryPath(input.path);
  if (!normalized) return { ok: false, sources: [...sources], reason: "empty" };
  const id = librarySourceId(normalized);
  if (sources.some((source) => source.id === id)) {
    return { ok: false, sources: [...sources], reason: "duplicate" };
  }
  if (sources.length >= MAX_LIBRARY_SOURCES) {
    return { ok: false, sources: [...sources], reason: "limit" };
  }
  const source: LibrarySource = {
    id,
    name: librarySourceName(normalized),
    path: normalized,
    kind: input.kind,
    addedAt: input.now ?? Date.now(),
  };
  return { ok: true, sources: [...sources, source], source };
}

export function removeLibrarySource(
  sources: readonly LibrarySource[],
  id: string,
): LibrarySource[] {
  return sources.filter((source) => source.id !== id);
}

/**
 * Rank library sources for an `@` query: name prefix first, then name substring,
 * then path substring. Empty query keeps insertion order so the list is stable.
 */
export function matchLibrarySources(
  sources: readonly LibrarySource[],
  query: string,
): LibrarySource[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...sources];
  const scored: Array<{ source: LibrarySource; rank: number }> = [];
  for (const source of sources) {
    const name = source.name.toLowerCase();
    const path = source.path.toLowerCase();
    if (name.startsWith(needle)) scored.push({ source, rank: 0 });
    else if (name.includes(needle)) scored.push({ source, rank: 1 });
    else if (path.includes(needle)) scored.push({ source, rank: 2 });
  }
  scored.sort((a, b) => a.rank - b.rank);
  return scored.map(({ source }) => source);
}

export function librarySourceToEntry(source: LibrarySource): FsIndexEntry {
  // A folder is inserted with a trailing slash by the composer, so the kind
  // matters more than the rendered path here.
  return { path: source.path, kind: source.kind === "folder" ? "dir" : "file" };
}

export type LibraryCandidateMerge = {
  /** Entries that come from the library rather than the workspace index. */
  library: FsIndexEntry[];
  /** Workspace entries that the library does not already cover. */
  workspace: FsIndexEntry[];
};

/**
 * Merge library entries ahead of workspace entries for the `@` menu.
 *
 * Deduplication is by normalized path and ignores kind: the workspace index
 * already describes that path, and offering it twice would make the menu look
 * like it has stale duplicates.
 */
export function mergeLibraryCandidates(
  workspaceEntries: readonly FsIndexEntry[],
  sources: readonly LibrarySource[],
  query: string,
  limit: number,
): LibraryCandidateMerge {
  const matched = matchLibrarySources(sources, query);
  const library: FsIndexEntry[] = [];
  const seen = new Set<string>();
  for (const source of matched) {
    if (library.length >= limit) break;
    const entry = librarySourceToEntry(source);
    const key = normalizeLibraryPath(entry.path).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    library.push(entry);
  }
  const workspace: FsIndexEntry[] = [];
  for (const entry of workspaceEntries) {
    if (workspace.length >= limit) break;
    const key = normalizeLibraryPath(entry.path).toLowerCase();
    if (seen.has(key)) continue;
    workspace.push(entry);
  }
  return { library, workspace };
}

export type LibraryStatus = "empty" | "ready";

/**
 * Status shown at the top of the library page. Truncation belongs to the
 * workspace index rather than the library itself, so it is not a library state:
 * a library of twelve folders is complete even when a workspace index is cut off.
 */
export function libraryStatus(sources: readonly LibrarySource[]): LibraryStatus {
  return sources.length > 0 ? "ready" : "empty";
}
