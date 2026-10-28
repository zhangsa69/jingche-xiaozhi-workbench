import {
  MAX_LIBRARY_SOURCES,
  normalizeLibraryPath,
  librarySourceId,
  librarySourceName,
  type LibrarySource,
  type LibrarySourceKind,
} from "@pi-desktop/shared";

/**
 * The library lives in local storage next to the other view preferences: it is
 * a pointer list, not data. Files stay where the user put them, which keeps the
 * library honest (removing an entry never deletes anything) and avoids a new
 * IPC channel plus a migration on the host side.
 */
export const LIBRARY_STORAGE_KEY = "pi.desktop.library";

function isKind(value: unknown): value is LibrarySourceKind {
  return value === "folder" || value === "file";
}

/** Rebuild entries from storage, dropping anything that no longer parses. */
export function parseLibrarySources(raw: unknown): LibrarySource[] {
  if (!Array.isArray(raw)) return [];
  const sources: LibrarySource[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const path = typeof record.path === "string" ? normalizeLibraryPath(record.path) : "";
    if (!path) continue;
    const id = librarySourceId(path);
    if (seen.has(id)) continue;
    seen.add(id);
    sources.push({
      id,
      name:
        typeof record.name === "string" && record.name.trim()
          ? record.name.trim()
          : librarySourceName(path),
      path,
      kind: isKind(record.kind) ? record.kind : "folder",
      addedAt:
        typeof record.addedAt === "number" && Number.isFinite(record.addedAt)
          ? record.addedAt
          : 0,
    });
    if (sources.length >= MAX_LIBRARY_SOURCES) break;
  }
  return sources;
}

export function loadLibrarySources(): LibrarySource[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    return parseLibrarySources(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveLibrarySources(sources: readonly LibrarySource[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(sources));
  } catch {
    // A full or blocked quota must not break the page; the list stays in memory.
  }
}
