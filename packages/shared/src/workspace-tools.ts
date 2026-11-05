/**
 * Companion tools that live on the intranet beside the workbench.
 *
 * Only the ids are shared: they are what the renderer sends and what the menu
 * renders. The addresses stay in Electron Main (`main/workspace-tools.ts`), so a
 * renderer bundle never carries an intranet host and a compromised renderer has
 * nothing to point the OS at (D428).
 */
export type WorkspaceToolId = "pdf" | "cad" | "mindmap" | "minutes";

export const WORKSPACE_TOOL_IDS: readonly WorkspaceToolId[] = [
  "pdf",
  "cad",
  "mindmap",
  "minutes",
];

export function isWorkspaceToolId(rawId: unknown): rawId is WorkspaceToolId {
  return typeof rawId === "string" && (WORKSPACE_TOOL_IDS as readonly string[]).includes(rawId);
}
