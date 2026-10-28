/**
 * The shape of one NDJSON log row, as far as the panel needs it (W-17).
 *
 * The main-process `LogRecord` is the producer; this is the consumer's subset,
 * kept structural so the renderer never imports main-process modules.
 */
export type LogTailLevel = "debug" | "info" | "warn" | "error";

export type LogTailChannel = "app" | "host" | "agent";

export type LogTailCategory =
  | "lifecycle"
  | "session"
  | "tool"
  | "permission"
  | "plugin"
  | "provider"
  | "persistence"
  | "updater"
  | "diagnostics"
  | "runtime";

export type LogTailRecord = {
  ts: string;
  level: LogTailLevel;
  channel: LogTailChannel;
  category: LogTailCategory;
  event: string;
  message: string;
  sessionId?: string;
  code?: string;
  data?: unknown;
};

export type LogTailRequest = {
  /** Defaults to `app`: the channel that describes the app itself. */
  channel?: LogTailChannel;
  /** Minimum level; `debug` means everything. */
  level?: LogTailLevel;
  /** Exact match on the row's `sessionId`. */
  sessionId?: string;
  /** Rows to return, newest kept. Clamped by the host. */
  limit?: number;
};

export type LogTailResult = {
  /** Oldest first, so the panel can append while following the tail. */
  records: LogTailRecord[];
  /** True when the tail window started mid-file or the limit dropped rows. */
  truncated: boolean;
};
