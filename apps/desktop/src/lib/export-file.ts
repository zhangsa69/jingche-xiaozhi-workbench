import i18n from "i18next";

import { useAppStore } from "../stores/app-store";
import { api } from "./api";

/**
 * W-14: send one file to the OS save dialog.
 *
 * Kept out of the components because both the file viewer and the artifacts
 * tab offer the same action, and the only interesting part is what the user is
 * told afterwards: a canceled dialog says nothing, success names the place the
 * file landed, and a failure stays an error toast instead of throwing into a
 * click handler.
 */
export async function exportFile(path: string, suggestedName?: string): Promise<void> {
  const { showToast } = useAppStore.getState();
  try {
    const result = await api.fsExport(path, suggestedName);
    if (result.canceled) return;
    showToast(i18n.t("panel.files.exported", { path: result.path ?? "" }));
  } catch {
    showToast(i18n.t("panel.files.exportError"), { variant: "error" });
  }
}
