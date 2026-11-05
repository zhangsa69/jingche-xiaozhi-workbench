import { isWorkspaceToolId, type WorkspaceToolId } from "@pi-desktop/shared";

/**
 * Intranet addresses for the companion tools (D428).
 *
 * They live in Main only: the renderer sends a tool id and never sees or
 * supplies a URL, so this table is the single place a click can send the OS.
 * Each address still goes through the guarded opener, which refuses anything
 * that is not `http(s)` (D330).
 */
const WORKSPACE_TOOL_URLS: Record<WorkspaceToolId, string> = {
  pdf: "http://10.120.65.148:3001/zh/",
  cad: "http://10.120.65.148:3003/",
  mindmap: "http://10.120.65.148:3002/",
  minutes: "https://10.120.65.148:3005/",
};

/** Address for a tool id, or null when the id is not one we ship. */
export function workspaceToolUrl(rawId: unknown): string | null {
  if (!isWorkspaceToolId(rawId)) return null;
  return WORKSPACE_TOOL_URLS[rawId];
}
