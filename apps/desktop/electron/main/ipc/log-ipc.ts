import { join } from "node:path";
import {
  ErrorCodes,
  IPC,
  type LogTailRequest,
  type LogTailResult,
} from "@pi-desktop/shared";
import { readLogTail } from "../log-tail";
import type { IpcRegistrar } from "./types";

const CHANNELS = new Set(["app", "host", "agent"]);
const LEVELS = new Set(["debug", "info", "warn", "error"]);

function invalid(message: string): Error {
  return Object.assign(new Error(message), {
    errorCode: ErrorCodes.INVALID_ARGUMENT,
  });
}

/**
 * Reject unknown filter values instead of silently falling back: a panel that
 * asks for a channel the host does not have is a bug, and an empty list with no
 * hint would look like "there are no logs".
 */
export function sanitizeLogRequest(input?: LogTailRequest): LogTailRequest {
  const channel = input?.channel;
  if (channel !== undefined && !CHANNELS.has(channel)) {
    throw invalid("unknown log channel");
  }
  const level = input?.level;
  if (level !== undefined && !LEVELS.has(level)) {
    throw invalid("unknown log level");
  }
  const sessionId =
    typeof input?.sessionId === "string" ? input.sessionId.trim().slice(0, 200) : "";

  return {
    ...(channel ? { channel } : {}),
    ...(level ? { level } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(input?.limit === undefined ? {} : { limit: input.limit }),
  };
}

/** W-17: the panel reads the same NDJSON files the logger writes. */
export function registerLogIpc({
  registrar,
  dataDir,
}: {
  registrar: IpcRegistrar;
  dataDir: string;
}): void {
  registrar.handle(
    IPC.invoke.logTail,
    async (input?: LogTailRequest): Promise<LogTailResult> =>
      readLogTail(join(dataDir, "logs"), sanitizeLogRequest(input)),
  );
}
