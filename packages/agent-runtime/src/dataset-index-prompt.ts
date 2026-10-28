/**
 * Mounted-dataset index (W-24).
 *
 * A dataset is a pointer the user attached to a task, so the prompt lists what
 * was mounted and where it lives — never a summary of what is inside it. Claims
 * about a file's contents have to come from reading that file, otherwise the
 * model would be guessing with the user's authority behind it.
 */

export type DatasetKind = "folder" | "file";

export type DatasetIndexEntry = {
  name: string;
  path: string;
  kind: DatasetKind;
  /** Known size, when the mount already counted it. Omitted otherwise. */
  itemCount?: number;
};

export type DatasetIndexOptions = {
  /** How many entries to list before summarising the rest. */
  limit?: number;
  heading?: string;
};

/** A mounted list stays useful long before it is a whole corpus dump. */
export const DATASET_INDEX_LIMIT = 20;

const DEFAULT_HEADING = "## Mounted datasets";

const GUIDE = [
  "The user mounted these folders and files for this task. Each one is a pointer,",
  "not a summary: read a path before relying on its contents, and say which",
  "dataset a claim came from when it changes the answer.",
].join("\n");

export function normalizeDatasetPath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/");
  if (!trimmed) return "";
  const collapsed = trimmed.replace(/\/{2,}/g, "/");
  const withoutTrailing = collapsed.replace(/\/+$/, "");
  return withoutTrailing || collapsed;
}

function describeEntry(entry: DatasetIndexEntry): string {
  const details = [entry.kind];
  if (typeof entry.itemCount === "number" && Number.isFinite(entry.itemCount)) {
    details.push(`${entry.itemCount} item${entry.itemCount === 1 ? "" : "s"}`);
  }
  const name = entry.name.trim() || normalizeDatasetPath(entry.path);
  return `- ${name} — ${normalizeDatasetPath(entry.path)} (${details.join(", ")})`;
}

/**
 * Render the mounted-dataset block, or an empty string when nothing is mounted.
 *
 * Mounting order is preserved: it is the order the user chose, and re-sorting
 * by name would silently argue with that.
 */
export function buildDatasetIndexPrompt(
  entries: readonly DatasetIndexEntry[],
  options: DatasetIndexOptions = {},
): string {
  const limit = Math.max(0, options.limit ?? DATASET_INDEX_LIMIT);
  const seen = new Set<string>();
  const kept: DatasetIndexEntry[] = [];
  let total = 0;
  for (const entry of entries) {
    const path = normalizeDatasetPath(entry.path);
    if (!path) continue;
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    total += 1;
    if (kept.length < limit) kept.push(entry);
  }
  if (kept.length === 0) return "";

  const heading = options.heading ?? DEFAULT_HEADING;
  const lines = [heading, "", GUIDE, "", ...kept.map(describeEntry)];
  const hidden = total - kept.length;
  if (hidden > 0) {
    lines.push("", `…and ${hidden} more dataset${hidden === 1 ? "" : "s"} not listed.`);
  }
  return lines.join("\n");
}

/**
 * Append the index to an existing system prompt.
 *
 * With nothing mounted the prompt is returned untouched — byte for byte — so a
 * task without datasets behaves exactly as it did before this feature existed.
 */
export function appendDatasetIndexPrompt(
  systemPrompt: string,
  entries: readonly DatasetIndexEntry[],
  options: DatasetIndexOptions = {},
): string {
  const block = buildDatasetIndexPrompt(entries, options);
  if (!block) return systemPrompt;
  const base = systemPrompt.replace(/\s+$/, "");
  return base ? `${base}\n\n${block}` : block;
}
