import { isAbsolute, join } from "node:path";
import {
  ErrorCodes,
  IPC,
  type DocumentPreviewRequest,
  type DocumentPreviewResult,
} from "@pi-desktop/shared";
import { readDocumentPreview } from "../document-preview";
import { isAttachmentBlobRef } from "../fs-panel";
import type { HostProcess } from "../host-process";
import { projectFolderPaths } from "../workspace-roots";
import type { IpcRegistrar } from "./types";

/**
 * Rich preview of Office files (W-19).
 *
 * Reads go through the same containment the files tab uses: the open
 * workspace, the session stores, and the other folders of the project group.
 * No new authority is granted — the panel can only preview what it could
 * already open.
 */
export function registerPreviewIpc({
  registrar,
  getHost,
  dataDir,
}: {
  registrar: IpcRegistrar;
  getHost: () => HostProcess | null;
  dataDir: string;
}): void {
  const workspaceRoot = async (): Promise<string | null> => {
    const host = getHost();
    if (!host) return null;
    try {
      const result = (await host.call("workspace.get")) as {
        workspace: { path?: string } | null;
      };
      return result.workspace?.path ?? null;
    } catch {
      return null;
    }
  };

  registrar.handle(
    IPC.invoke.documentPreview,
    async (
      input: Partial<DocumentPreviewRequest> = {},
    ): Promise<DocumentPreviewResult> => {
      const requested = String(input.path ?? "").trim();
      // A relative path is meaningless without a workspace, so only the two
      // root-anchored forms survive a closed project.
      const root = await workspaceRoot();
      if (!root && !isAbsolute(requested) && !isAttachmentBlobRef(requested)) {
        throw Object.assign(new Error("workspace required"), {
          errorCode: ErrorCodes.WORKSPACE_REQUIRED,
        });
      }
      return readDocumentPreview({ path: requested }, root, [
        join(dataDir, "scratch"),
        join(dataDir, "attachments"),
        ...projectFolderPaths(root).filter((path) => path !== root),
      ]);
    },
  );
}
