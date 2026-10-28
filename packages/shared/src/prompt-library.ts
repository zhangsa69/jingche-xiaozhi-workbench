/**
 * Prompt library: the prompts a user actually reuses, kept as plain data.
 *
 * Everything here is a pure function over an array so the renderer can hold the
 * same shape in `useState`, hand it to `localStorage`, and reload it after a
 * corrupt write without a second implementation. Entries are keyed by their
 * normalised text, because two prompts that differ only in spacing are the same
 * prompt to a person — and a library that shows both is a library they stop
 * trusting.
 *
 * Slash commands are deliberately not recorded: they dispatch to machinery, so
 * recalling `/model` as free text would produce a prompt that does nothing.
 */

export type PromptLibraryEntry = {
  /** Derived from the normalised text; stable across reloads. */
  id: string;
  /** Whitespace-collapsed text, ready to hand back to the composer. */
  text: string;
  tags: string[];
  pinned: boolean;
  uses: number;
  createdAt: number;
  lastUsedAt: number;
};

/** Oldest unpinned entries are dropped past this count. */
export const MAX_PROMPT_LIBRARY_ENTRIES = 300;
export const MAX_PROMPT_LIBRARY_TAGS = 5;
export const MAX_PROMPT_LIBRARY_TAG_LENGTH = 24;
/**
 * Prompts longer than this are not worth recalling by arrow key: the user
 * cannot see where they are in the list, only that the draft jumped.
 */
export const MAX_PROMPT_LIBRARY_TEXT = 4000;
/** How far ArrowUp walks back before it stops. */
export const PROMPT_RECALL_LIMIT = 40;

/** Collapse runs of whitespace so the same prompt typed twice is one entry. */
export function normalizePromptText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * FNV-1a over the normalised text, with the length appended. A hash collision
 * between two different prompts would silently merge them, so the length is
 * part of the id to make that vanishingly unlikely without storing the text
 * twice inside the id.
 */
export function promptEntryId(normalizedText: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalizedText.length; index += 1) {
    hash ^= normalizedText.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `p${hash.toString(36)}-${normalizedText.length.toString(36)}`;
}

function isRecordable(text: string): boolean {
  const normalized = normalizePromptText(text);
  return (
    normalized.length > 0 &&
    normalized.length <= MAX_PROMPT_LIBRARY_TEXT &&
    !normalized.startsWith("/")
  );
}

/** Trim, drop blanks, dedupe case-insensitively, cap the count and length. */
export function normalizePromptTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().slice(0, MAX_PROMPT_LIBRARY_TAG_LENGTH);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(tag);
    if (next.length >= MAX_PROMPT_LIBRARY_TAGS) break;
  }
  return next;
}

/**
 * Pinned entries are never pruned: a pin is the user saying "keep this", and a
 * count cap that silently outranks it is the kind of thing they only notice
 * when the entry is already gone.
 */
function prune(entries: PromptLibraryEntry[]): PromptLibraryEntry[] {
  if (entries.length <= MAX_PROMPT_LIBRARY_ENTRIES) return entries;
  const keep = new Set<PromptLibraryEntry>();
  for (const entry of entries) {
    if (entry.pinned) keep.add(entry);
  }
  let budget = MAX_PROMPT_LIBRARY_ENTRIES - keep.size;
  for (const entry of entries) {
    if (keep.has(entry)) continue;
    if (budget <= 0) break;
    keep.add(entry);
    budget -= 1;
  }
  // Filtering instead of rebuilding keeps the recency order at the head, so the
  // entry the user just sent is still first after a prune.
  return entries.filter((entry) => keep.has(entry));
}

/**
 * Record a sent prompt. Returns a new array ordered by recency; the same input
 * array is returned untouched when the text is not recordable, so callers can
 * skip a write with a reference check.
 */
export function recordPromptUsage(
  entries: readonly PromptLibraryEntry[],
  text: string,
  at: number = Date.now(),
): PromptLibraryEntry[] {
  const normalized = normalizePromptText(text);
  if (!isRecordable(text)) return entries as PromptLibraryEntry[];
  const id = promptEntryId(normalized);
  const existing = entries.find((entry) => entry.id === id);
  const entry: PromptLibraryEntry = existing
    ? {
        ...existing,
        text: normalized,
        uses: existing.uses + 1,
        lastUsedAt: at,
      }
    : {
        id,
        text: normalized,
        tags: [],
        pinned: false,
        uses: 1,
        createdAt: at,
        lastUsedAt: at,
      };
  return prune([
    entry,
    ...entries.filter((candidate) => candidate.id !== id),
  ]);
}

export function togglePromptPinned(
  entries: readonly PromptLibraryEntry[],
  id: string,
): PromptLibraryEntry[] {
  return entries.map((entry) =>
    entry.id === id ? { ...entry, pinned: !entry.pinned } : entry,
  );
}

export function setPromptTags(
  entries: readonly PromptLibraryEntry[],
  id: string,
  tags: readonly string[],
): PromptLibraryEntry[] {
  const normalized = normalizePromptTags(tags);
  return entries.map((entry) =>
    entry.id === id ? { ...entry, tags: normalized } : entry,
  );
}

export function removePrompt(
  entries: readonly PromptLibraryEntry[],
  id: string,
): PromptLibraryEntry[] {
  return entries.filter((entry) => entry.id !== id);
}

/**
 * Every whitespace-separated token has to match the text or one tag, so typing
 * two words narrows rather than widens — the same left-to-right expectation a
 * file search sets. Pinned entries float to the top; the rest stay in recency
 * order, which is what the user just did.
 */
export function matchPrompts(
  entries: readonly PromptLibraryEntry[],
  query: string,
): PromptLibraryEntry[] {
  const tokens = normalizePromptText(query).toLowerCase().split(" ").filter(Boolean);
  const matched = tokens.length
    ? entries.filter((entry) => {
        const text = entry.text.toLowerCase();
        const tags = entry.tags.map((tag) => tag.toLowerCase());
        return tokens.every(
          (token) => text.includes(token) || tags.some((tag) => tag.includes(token)),
        );
      })
    : [...entries];
  return matched.sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return right.lastUsedAt - left.lastUsedAt;
  });
}

/** Header counts and the tag rail, most used first then alphabetical. */
export function promptLibraryStatus(entries: readonly PromptLibraryEntry[]): {
  total: number;
  pinned: number;
  tags: string[];
} {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const tags = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([tag]) => tag);
  return {
    total: entries.length,
    pinned: entries.filter((entry) => entry.pinned).length,
    tags,
  };
}

/**
 * Recency-ordered texts for ArrowUp recall. Pins do not reorder it: recalling
 * by pin order would make the second ArrowUp jump to something from last week.
 */
export function promptRecallHistory(
  entries: readonly PromptLibraryEntry[],
  limit: number = PROMPT_RECALL_LIMIT,
): string[] {
  return [...entries]
    .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.text);
}

export type PromptRecallCursor = {
  /** What is in the composer right now. */
  text: string;
  /** The recalled entry the draft came from, or null when it was typed. */
  anchor: string | null;
};

/**
 * Step through recall history. `null` means "do not touch the draft": either
 * there is nothing to recall, the list is exhausted, or the user edited a
 * recalled prompt — resuming from an entry they have rewritten would quietly
 * discard the edit on the next keypress.
 */
export function recallPrompt(
  history: readonly string[],
  cursor: PromptRecallCursor,
  direction: "older" | "newer" = "older",
): { text: string; anchor: string | null } | null {
  if (history.length === 0) return null;
  const editable = cursor.text.trim();
  const anchorIndex = cursor.anchor === null ? -1 : history.indexOf(cursor.anchor);
  if (editable && anchorIndex === -1) return null;
  if (direction === "newer") {
    if (anchorIndex === -1) return null;
    if (anchorIndex === 0) return { text: "", anchor: null };
    return { text: history[anchorIndex - 1], anchor: history[anchorIndex - 1] };
  }
  // Editing the recalled text detaches it from history: the user's words win.
  if (editable && cursor.anchor !== cursor.text) return null;
  const nextIndex = anchorIndex + 1;
  if (nextIndex >= history.length) return null;
  return { text: history[nextIndex], anchor: history[nextIndex] };
}

/**
 * Rebuild a library from untrusted storage: drop anything without usable text,
 * recompute ids, keep a pin only if the stored one is a real boolean.
 */
export function parsePromptLibrary(raw: unknown): PromptLibraryEntry[] {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  const seen = new Set<string>();
  const entries: PromptLibraryEntry[] = [];
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Record<string, unknown>;
    if (typeof record.text !== "string") continue;
    const text = normalizePromptText(record.text);
    if (!isRecordable(text)) continue;
    const id = promptEntryId(text);
    if (seen.has(id)) continue;
    seen.add(id);
    const number = (value: unknown, fallback: number) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : fallback;
    const tags = Array.isArray(record.tags)
      ? normalizePromptTags(
          record.tags.filter((tag): tag is string => typeof tag === "string"),
        )
      : [];
    const createdAt = number(record.createdAt, now);
    entries.push({
      id,
      text,
      tags,
      pinned: record.pinned === true,
      uses: Math.max(1, Math.floor(number(record.uses, 1))),
      createdAt,
      lastUsedAt: number(record.lastUsedAt, createdAt),
    });
    if (entries.length >= MAX_PROMPT_LIBRARY_ENTRIES) break;
  }
  return entries;
}
