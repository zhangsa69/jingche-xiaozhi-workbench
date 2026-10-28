import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  DocumentPreviewBlock,
  DocumentPreviewResult,
} from "@pi-desktop/shared";
import {
  firstFilledRow,
  gridCell,
  gridWidth,
  hasRenderableContent,
  previewTabTitle,
  unsupportedReasonKey,
} from "../../lib/document-preview";
import { cx } from "../ui";
import { IconFileText } from "../icons";
import { WorkTabEmpty } from "./WorkTabEmpty";

type Props = {
  /** Workspace-relative path, used only as the view's accessible name. */
  path: string;
  result: DocumentPreviewResult;
  /** Escape hatch for `unsupported`: hand the file to the OS. */
  onOpenExternal: () => void;
};

/**
 * Read-only rendering of a parsed Office document (W-19).
 *
 * The host flattens the document; this component only draws three shapes. It
 * never inspects the extension itself — `FilesTab` already decided the file is
 * a document before mounting it, and `unsupported` falls back to the ordinary
 * "open it elsewhere" state rather than pretending to render bytes.
 */
export function DocumentPreview({ path, result, onOpenExternal }: Props) {
  const { t } = useTranslation();
  const { preview, truncated } = result;
  const title = previewTabTitle(path);

  return (
    <div className="doc-preview" role="region" aria-label={title}>
      {truncated && preview.kind !== "unsupported" && (
        <p className="doc-preview-notice" role="status">
          {t("panel.files.preview.truncated")}
        </p>
      )}
      {preview.kind === "unsupported" ? (
        <WorkTabEmpty
          icon={IconFileText}
          title={t("panel.files.preview.unsupported")}
          body={t(unsupportedReasonKey(preview.reason))}
        >
          <button
            type="button"
            className="doc-preview-action"
            onClick={onOpenExternal}
          >
            {t("panel.files.preview.openExternal")}
          </button>
        </WorkTabEmpty>
      ) : preview.kind === "docx" ? (
        <DocxView blocks={preview.blocks} />
      ) : preview.kind === "xlsx" ? (
        <XlsxView sheets={preview.sheets} />
      ) : (
        <PptxView slides={preview.slides} />
      )}
    </div>
  );
}

/**
 * Loading placeholder shown while the host parses. Paper-shaped so the panel
 * does not jump when the real document lands.
 */
export function DocumentPreviewSkeleton({ path }: { path: string }) {
  const { t } = useTranslation();
  return (
    <div
      className="doc-preview"
      role="region"
      aria-busy="true"
      aria-label={previewTabTitle(path)}
    >
      <div className="doc-preview-paper doc-preview-paper--skeleton">
        <div className="doc-preview-skeleton-line" />
        <div className="doc-preview-skeleton-line" />
        <div className="doc-preview-skeleton-line doc-preview-skeleton-line--short" />
        <div className="doc-preview-skeleton-line" />
        <div className="doc-preview-skeleton-line doc-preview-skeleton-line--short" />
      </div>
      <p className="doc-preview-notice" role="status">
        {t("panel.files.preview.loading")}
      </p>
    </div>
  );
}

function DocxView({ blocks }: { blocks: DocumentPreviewBlock[] }) {
  const { t } = useTranslation();
  // "No blocks" is not the only empty document: an empty table shell counts as
  // no content, whether it was truncated by the host or empty in the source.
  if (!hasRenderableContent(blocks)) {
    return <WorkTabEmpty icon={IconFileText} title={t("panel.files.preview.empty")} />;
  }
  return (
    <article className="doc-preview-paper">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return (
            <h3 className="doc-preview-heading" key={index}>
              {block.text}
            </h3>
          );
        }
        if (block.kind === "paragraph") {
          return (
            <p className="doc-preview-paragraph" key={index}>
              {block.text}
            </p>
          );
        }
        return <DataTable key={index} rows={block.rows} />;
      })}
    </article>
  );
}

function XlsxView({
  sheets,
}: {
  sheets: { name: string; rows: string[][] }[];
}) {
  const { t } = useTranslation();
  // Only the selected sheet is mounted: with 20 sheets of 500 x 64 cells the
  // grid would otherwise be 640k nodes. The selection is keyed to the sheet
  // array so opening another workbook starts on its first sheet again.
  const [selection, setSelection] = useState({ sheets, active: 0 });
  if (selection.sheets !== sheets) setSelection({ sheets, active: 0 });
  if (sheets.length === 0) {
    return <WorkTabEmpty icon={IconFileText} title={t("panel.files.preview.empty")} />;
  }
  const index = Math.min(Math.max(selection.active, 0), sheets.length - 1);
  const sheet = sheets[index];
  return (
    <div className="doc-preview-sheet">
      {sheets.length > 1 && (
        <div
          className="doc-preview-sheet-tabs"
          role="tablist"
          aria-label={t("panel.files.preview.sheet")}
        >
          {sheets.map((item, i) => (
            <button
              key={`${item.name}:${i}`}
              type="button"
              role="tab"
              aria-selected={i === index}
              className={cx("doc-preview-sheet-tab", i === index && "active")}
              onClick={() => setSelection({ sheets, active: i })}
            >
              {item.name || `#${i + 1}`}
            </button>
          ))}
        </div>
      )}
      {sheet.rows.length === 0 ? (
        <WorkTabEmpty icon={IconFileText} title={t("panel.files.preview.empty")} />
      ) : (
        <div className="doc-preview-sheet-scroll">
          <DataTable rows={sheet.rows} nowrap />
        </div>
      )}
    </div>
  );
}

function PptxView({ slides }: { slides: { title: string; bullets: string[] }[] }) {
  const { t } = useTranslation();
  if (slides.length === 0) {
    return <WorkTabEmpty icon={IconFileText} title={t("panel.files.preview.empty")} />;
  }
  return (
    <div className="doc-preview-deck" aria-label={t("panel.files.preview.slides")}>
      {slides.map((slide, index) => (
        <section className="doc-preview-slide" key={index}>
          <h3 className="doc-preview-slide-title">
            {slide.title || `#${index + 1}`}
          </h3>
          {slide.bullets.length > 0 && (
            <ul className="doc-preview-bullets">
              {slide.bullets.map((bullet, i) => (
                <li key={i}>{bullet}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * Row 0 is the header (`<th scope="col">`) only when it holds text; a sheet
 * that starts below row 0 keeps its blank placeholder rows as plain body rows
 * so column alignment survives without a blank header bar. Columns come from
 * the widest row, because docx rows can be ragged around merged cells.
 */
function DataTable({
  rows,
  nowrap = false,
}: {
  rows: string[][];
  nowrap?: boolean;
}) {
  const columns = gridWidth(rows);
  if (rows.length === 0 || columns === 0) return null;
  const hasHeader = firstFilledRow(rows) === 0;
  const bodyStart = hasHeader ? 1 : 0;
  // A clipped spreadsheet cell still has to be readable, so the clipped
  // variants carry the full text as a native tooltip.
  const titleOf = (text: string) => (nowrap && text ? text : undefined);
  return (
    <table className={cx("doc-preview-table", nowrap && "doc-preview-table--nowrap")}>
      {hasHeader && (
        <thead>
          <tr>
            {Array.from({ length: columns }, (_, c) => {
              const text = gridCell(rows, 0, c);
              return (
                <th scope="col" key={c} title={titleOf(text)}>
                  {text}
                </th>
              );
            })}
          </tr>
        </thead>
      )}
      <tbody>
        {rows.slice(bodyStart).map((_, r) => (
          <tr key={r}>
            {Array.from({ length: columns }, (_, c) => {
              const text = gridCell(rows, r + bodyStart, c);
              return (
                <td key={c} title={titleOf(text)}>
                  {text}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
