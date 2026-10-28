import {
  parsePromptLibrary,
  recordPromptUsage,
  removePrompt,
  setPromptTags,
  togglePromptPinned,
  type PromptLibraryEntry,
} from "@pi-desktop/shared";

/**
 * The prompt library is local storage, like the folder library: it is the
 * user's own words, and keeping them on this machine is the whole promise of
 * the privacy page. Nothing here is sent anywhere until the user inserts an
 * entry into the composer.
 */
export const PROMPT_LIBRARY_STORAGE_KEY = "pi.desktop.promptLibrary";

export function loadPromptLibrary(): PromptLibraryEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(PROMPT_LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    return parsePromptLibrary(JSON.parse(raw));
  } catch {
    // Corrupt JSON is treated as an empty library rather than a crash on load.
    return [];
  }
}

export function savePromptLibrary(entries: readonly PromptLibraryEntry[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PROMPT_LIBRARY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // A full or blocked quota keeps the in-memory list usable for this session.
  }
}

/** Record a sent prompt and return the new list, so callers can set state once. */
export function rememberPromptText(text: string): PromptLibraryEntry[] {
  const current = loadPromptLibrary();
  const next = recordPromptUsage(current, text);
  // Slash commands and blank drafts come back as the same array; skip the write.
  if (next !== current) savePromptLibrary(next);
  return next;
}

export function togglePinnedPrompt(
  entries: readonly PromptLibraryEntry[],
  id: string,
): PromptLibraryEntry[] {
  const next = togglePromptPinned(entries, id);
  savePromptLibrary(next);
  return next;
}

export function updatePromptTags(
  entries: readonly PromptLibraryEntry[],
  id: string,
  tags: readonly string[],
): PromptLibraryEntry[] {
  const next = setPromptTags(entries, id, tags);
  savePromptLibrary(next);
  return next;
}

export function deletePrompt(entries: readonly PromptLibraryEntry[], id: string): PromptLibraryEntry[] {
  const next = removePrompt(entries, id);
  savePromptLibrary(next);
  return next;
}
