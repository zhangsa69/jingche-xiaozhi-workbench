import i18n from "i18next";

import { useAppStore } from "../stores/app-store";
import { api } from "./api";
import { exportFile } from "./export-file";
import { buildSessionDocument } from "./session-pdf";

/**
 * W-13: the current transcript as a PDF, straight into the save dialog.
 *
 * Three steps that stay separate on purpose — build the document in the
 * renderer, render it in the main process, then reuse the export channel — so
 * the PDF never becomes a fourth way to write files.
 */
export async function exportSessionPdf(): Promise<void> {
  const { messages, sessions, activeSessionId, showToast } = useAppStore.getState();
  if (messages.length === 0) {
    showToast(i18n.t("panel.files.pdfEmpty"), { variant: "error" });
    return;
  }

  const title =
    sessions.find((session) => session.id === activeSessionId)?.title?.trim() ||
    i18n.t("panel.files.pdfFallbackTitle");

  try {
    const html = buildSessionDocument(title, messages, {
      user: i18n.t("panel.files.pdfUser"),
      assistant: i18n.t("panel.files.pdfAssistant"),
    });
    const result = await api.pdfRender({
      html,
      ...(activeSessionId ? { sessionId: activeSessionId } : {}),
      name: title,
    });
    // The PDF is in scratch; the save dialog decides where it actually lives.
    await exportFile(result.path, `${title}.pdf`);
  } catch {
    showToast(i18n.t("panel.files.pdfError"), { variant: "error" });
  }
}
