import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  LogTailChannel,
  LogTailLevel,
  LogTailRecord,
  LogTailRequest,
  LogTailResult,
} from "@pi-desktop/shared";

/** One read window per category file; enough for a few thousand rows. */
const READ_WINDOW_BYTES = 256 * 1024;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1_000;

const LEVEL_RANK: Record<LogTailLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Parse NDJSON rows, dropping anything a crash left half-written (W-17).
 *
 * A torn line is expected at the tail of a file whose writer was killed; it is
 * not an error worth surfacing, and one bad row must not hide the rest.
 */
export function parseLogLines(text: string): LogTailRecord[] {
  const records: LogTailRecord[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (
      typeof value.ts !== "string" ||
      typeof value.level !== "string" ||
      typeof value.message !== "string"
    ) {
      continue;
    }
    records.push({
      ts: value.ts,
      level: value.level as LogTailLevel,
      channel: value.channel as LogTailChannel,
      category: value.category as LogTailRecord["category"],
      event: typeof value.event === "string" ? value.event : "",
      message: value.message,
      ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}),
      ...(typeof value.code === "string" ? { code: value.code } : {}),
      ...(value.data === undefined ? {} : { data: value.data }),
    });
  }
  return records;
}

async function readTail(
  path: string,
  maxBytes: number,
): Promise<{ text: string; cut: boolean }> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return { text: "", cut: false };
  }
  if (size === 0) return { text: "", cut: false };

  const start = Math.max(0, size - maxBytes);
  const handle = await open(path, "r");
  try {
    const length = size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    let text = buffer.toString("utf8");
    if (start > 0) {
      // The window usually begins mid-row; the first fragment is not a record.
      const breakAt = text.indexOf("\n");
      text = breakAt >= 0 ? text.slice(breakAt + 1) : "";
    }
    return { text, cut: start > 0 };
  } finally {
    await handle.close();
  }
}

export function clampLogLimit(value: unknown): number {
  const limit = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_LIMIT;
  return Math.min(Math.max(limit, 1), MAX_LIMIT);
}

/**
 * The newest rows of one channel, oldest first.
 *
 * Only the live `<category>.log` files are read: rotated ones are history the
 * panel is not asking for, and the panel already says when the window was cut.
 */
export async function readLogTail(
  logRoot: string,
  request: LogTailRequest = {},
): Promise<LogTailResult> {
  const channel: LogTailChannel = request.channel ?? "app";
  const limit = clampLogLimit(request.limit);
  const minRank = LEVEL_RANK[request.level ?? "debug"] ?? 0;

  let files: string[];
  try {
    files = await readdir(join(logRoot, channel));
  } catch {
    return { records: [], truncated: false };
  }

  const active = files
    .filter((name) => name.endsWith(".log") && !/\.\d+\.log$/.test(name))
    .sort();

  const collected: LogTailRecord[] = [];
  let truncated = false;
  for (const name of active) {
    const { text, cut } = await readTail(join(logRoot, channel, name), READ_WINDOW_BYTES);
    if (cut) truncated = true;
    collected.push(...parseLogLines(text));
  }

  const matching = collected
    .filter((record) => (LEVEL_RANK[record.level] ?? 0) >= minRank)
    .filter((record) => !request.sessionId || record.sessionId === request.sessionId)
    .sort((left, right) => left.ts.localeCompare(right.ts));

  if (matching.length > limit) truncated = true;
  return { records: matching.slice(-limit), truncated };
}
