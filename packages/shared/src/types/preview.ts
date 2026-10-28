/**
 * Rich-format preview of an Office file (W-19).
 *
 * The main process owns the parsing; the renderer only draws these three
 * shapes. Everything flattenable is flattened on purpose — a preview that
 * keeps styling would drag a full Office layout model across IPC for a panel
 * that shows text, so headings, paragraphs and tables are all the detail the
 * renderer gets, and an unsupported file falls back to the ordinary view.
 */

/** One block of a `.docx` body, in document order. */
export type DocumentPreviewBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; rows: string[][] };

/**
 * A parsed document, or the reason it could not be parsed.
 *
 * `unsupported` is a normal answer, not an error: the panel shows the plain
 * file view instead of an error toast when a file is too large, is not an
 * Office document, or turns out to be a broken archive.
 */
export type DocumentPreview =
  | { kind: "docx"; blocks: DocumentPreviewBlock[] }
  | { kind: "xlsx"; sheets: { name: string; rows: string[][] }[] }
  | { kind: "pptx"; slides: { title: string; bullets: string[] }[] }
  | { kind: "unsupported"; reason: "extension" | "corrupt" | "too-large" };

/** Workspace-relative path or an `attachments/<sha256>` blob reference. */
export type DocumentPreviewRequest = { path: string };

export type DocumentPreviewResult = {
  preview: DocumentPreview;
  /** True when any host-side limit cut content out of `preview`. */
  truncated: boolean;
};
