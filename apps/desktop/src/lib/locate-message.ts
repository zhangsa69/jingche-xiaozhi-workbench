const HIGHLIGHT_MS = 1600;

/**
 * Bring one transcript row into view from the work panel (W-16).
 *
 * The transcript is the only surface that owns scroll position, so the panel
 * asks the DOM rather than keeping a second notion of "where am I". Returning
 * false lets the caller stay quiet when the row is not rendered (for example a
 * session that has been switched away).
 */
export function locateTranscriptMessage(messageId: string): boolean {
  if (typeof document === "undefined") return false;
  const element = document.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(messageId)}"]`,
  );
  if (!element) return false;
  const row = element.closest<HTMLElement>(".message-row") ?? element;
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  row.classList.add("transcript-locate-target");
  window.setTimeout(() => row.classList.remove("transcript-locate-target"), HIGHLIGHT_MS);
  return true;
}
