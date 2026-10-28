import type { LogTailLevel, LogTailRecord } from "@pi-desktop/shared";

export type LogFilter = {
  /** Minimum severity, or `all` to keep everything the channel returned. */
  level: LogTailLevel | "all";
  query: string;
};

export const LOG_LEVELS: readonly (LogTailLevel | "all")[] = [
  "all",
  "debug",
  "info",
  "warn",
  "error",
];

const LEVEL_RANK: Record<LogTailLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * Filtering lives in the renderer (W-17): the host already narrowed by level
 * and session, and a search box must not cost a round trip per keystroke.
 */
export function filterLogRecords(
  records: LogTailRecord[],
  filter: LogFilter,
): LogTailRecord[] {
  const minRank = filter.level === "all" ? 0 : LEVEL_RANK[filter.level];
  const byLevel = records.filter(
    (record) => LEVEL_RANK[record.level] >= minRank,
  );
  const needle = filter.query.trim().toLowerCase();
  if (!needle) return byLevel;

  return byLevel.filter((record) => {
    const haystack =
      `${record.event} ${record.message} ${record.category} ${record.channel} ` +
      `${record.code ?? ""} ${record.sessionId ?? ""} ${safeStringify(record.data)}`;
    return haystack.toLowerCase().includes(needle);
  });
}

export function logLevelCounts(
  records: LogTailRecord[],
): Record<LogTailLevel, number> {
  const counts: Record<LogTailLevel, number> = {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
  };
  for (const record of records) counts[record.level] += 1;
  return counts;
}

/** `HH:mm:ss` in the viewer's locale; a full date is noise while following. */
export function formatLogTime(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
