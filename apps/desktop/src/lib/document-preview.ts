/**
 * Pure helpers for the work-panel rich-format preview (W-19).
 *
 * The panel decides "is this an Office document?" from the path alone, before
 * any bytes are read: `.docx` / `.xlsx` / `.pptx` must never travel through the
 * text reader (their bytes are a zip archive, not UTF-8). Everything that can
 * be asserted without a DOM lives here so `document-preview-view.test.mjs` can
 * cover it with plain node.
 */

import type { DocumentPreview } from "@pi-desktop/shared";

/** File families the panel can draw as a document. */
export type DocumentPreviewKind = "docx" | "xlsx" | "pptx";

/** Why the host declined to parse a file; mirrors `DocumentPreview`. */
export type DocumentPreviewUnsupportedReason = Extract<
  DocumentPreview,
  { kind: "unsupported" }
>["reason"];

const PREVIEW_KINDS: Record<string, DocumentPreviewKind> = {
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
};

/** A row grid as the host sends it; cells may be missing or null. */
export type PreviewGrid = ReadonlyArray<
  ReadonlyArray<string | null | undefined> | null | undefined
>;

/**
 * Trailing basename of a workspace-relative or absolute path, without
 * touching the filesystem. Both separators are accepted so a path that came
 * from a Windows host keeps working on the renderer side.
 */
export function previewTabTitle(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
}

/**
 * Which document view a path should open, or `null` for everything else.
 * Case-insensitive, extension-only: the file's contents are the host's
 * problem, and a mislabelled archive still answers `unsupported` there.
 */
export function previewKindForPath(path: string): DocumentPreviewKind | null {
  const name = previewTabTitle(path);
  const dot = name.lastIndexOf(".");
  // `dot <= 0` also rejects dotfiles such as `.docx`, which have no stem.
  if (dot <= 0) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  return PREVIEW_KINDS[extension] ?? null;
}

/**
 * One cell of a row grid. Out-of-range rows, out-of-range columns and null
 * cells all read as `""` so the table renderer never prints `"null"`.
 */
export function gridCell(rows: PreviewGrid, row: number, column: number): string {
  const cells = rows[row];
  if (!cells) return "";
  const value = cells[column];
  return typeof value === "string" ? value : "";
}

/**
 * Widest row in the grid. Tables size their columns from this rather than from
 * the header row, so a longer body row is not silently clipped.
 */
export function gridWidth(rows: PreviewGrid): number {
  let width = 0;
  for (const cells of rows) {
    if (cells && cells.length > width) width = cells.length;
  }
  return width;
}

/**
 * First row that actually carries text, or `-1` when every cell is blank.
 *
 * The host keeps row order intact, so a sheet whose data starts at row 3
 * arrives with blank placeholder rows above it, and a Word table's first row is
 * often a merged caption. The table renderer only promotes row 0 to a header
 * when this returns 0, which keeps a blank header bar off the panel.
 */
export function firstFilledRow(rows: PreviewGrid): number {
  for (let row = 0; row < rows.length; row += 1) {
    const cells = rows[row];
    if (!cells) continue;
    for (const cell of cells) {
      if (typeof cell === "string" && cell.trim() !== "") return row;
    }
  }
  return -1;
}

/** A docx answer as the host sends it. */
export type PreviewBlocks = Extract<DocumentPreview, { kind: "docx" }>["blocks"];

/**
 * Whether a docx answer has anything worth drawing.
 *
 * A table block can arrive with no rows in two different ways: the host's cell
 * budget ran out before the first cell (with `truncated`), or the source kept
 * an empty `<w:tbl>` shell that has no `w:tr` at all (without `truncated`).
 * Both must read as an empty document rather than a blank paper surface.
 *
 * A table that has rows but no text is kept on purpose: templates often ship an
 * empty grid waiting to be filled in, and the borders say more than a blank
 * paper does. Do not tighten this to "some cell has text" without a product
 * decision.
 */
export function hasRenderableContent(blocks: PreviewBlocks): boolean {
  return blocks.some(
    (block) => block.kind !== "table" || block.rows.length > 0,
  );
}

/**
 * i18n key explaining an `unsupported` answer. The reason is a host enum, so
 * the mapping stays here instead of in the component.
 */
export function unsupportedReasonKey(
  reason: DocumentPreviewUnsupportedReason,
): string {
  return `panel.files.preview.${reason === "too-large" ? "tooLarge" : reason}`;
}
