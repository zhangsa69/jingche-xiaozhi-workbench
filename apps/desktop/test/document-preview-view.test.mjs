/**
 * W-19 renderer contract: `.docx` / `.xlsx` / `.pptx` open as a document view
 * in the work panel, never through the text reader, and every locale can name
 * the view's states.
 *
 * No DOM here — the pure helpers, the i18n key set, and the wiring order in
 * `FilesTab.tsx` are the parts that can regress silently.
 */
import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const {
  previewKindForPath,
  previewTabTitle,
  gridCell,
  gridWidth,
  firstFilledRow,
  hasRenderableContent,
  unsupportedReasonKey,
} = await import("../src/lib/document-preview.ts");

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const LOCALES = ["zh-CN", "zh-TW", "en", "de", "es", "fr", "ko", "tr"];

const PREVIEW_KEYS = [
  "loading",
  "truncated",
  "unsupported",
  "extension",
  "corrupt",
  "tooLarge",
  "sheet",
  "slides",
  "empty",
  "failed",
  "openExternal",
];

const [filesTab, docPreview, styleSheet, ...localeSources] = await Promise.all([
  read("../src/components/workpanel/FilesTab.tsx"),
  read("../src/components/workpanel/DocumentPreview.tsx"),
  read("../src/styles/work-panel.css"),
  ...LOCALES.map((locale) => read(`../../../packages/i18n/src/locales/${locale}/index.ts`)),
]);

const localeByTag = Object.fromEntries(
  LOCALES.map((locale, index) => [locale, localeSources[index]]),
);

/** Body of the first `key: { … }` object at or after `from`, brace-matched. */
function objectBody(source, key, from = 0) {
  const candidates = [`${key}: {`, `"${key}": {`]
    .map((needle) => source.indexOf(needle, from))
    .filter((index) => index >= 0);
  if (candidates.length === 0) return null;
  const open = source.indexOf("{", Math.min(...candidates));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** `panel.files.preview` object of one locale source. */
function previewStrings(source) {
  const filesAt = source.indexOf("files: {") >= 0 ? source.indexOf("files: {") : source.indexOf('"files": {');
  const body = objectBody(source, "preview", filesAt);
  assert.ok(body, "panel.files.preview block is missing");
  const values = {};
  for (const [, key, value] of body.matchAll(/"?(\w+)"?\s*:\s*"([^"]*)"/g)) {
    values[key] = value;
  }
  return values;
}

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

test("previewKindForPath recognises the three Office families", () => {
  assert.equal(previewKindForPath("notes.docx"), "docx");
  assert.equal(previewKindForPath("budget.xlsx"), "xlsx");
  assert.equal(previewKindForPath("pitch.pptx"), "pptx");
});

test("previewKindForPath is extension-only and case-insensitive", () => {
  assert.equal(previewKindForPath("REPORT.DOCX"), "docx");
  assert.equal(previewKindForPath("Sheet.XlsX"), "xlsx");
  assert.equal(previewKindForPath("Deck.PPTX"), "pptx");
  assert.equal(previewKindForPath("a.b.c.docx"), "docx");
});

test("previewKindForPath ignores directories and non-document extensions", () => {
  assert.equal(previewKindForPath("docs/2026/q1/report.docx"), "docx");
  assert.equal(previewKindForPath("docs\\2026\\q1\\report.xlsx"), "xlsx");
  assert.equal(previewKindForPath("attachments/9f2c.docx"), "docx");
  assert.equal(previewKindForPath("readme.md"), null);
  assert.equal(previewKindForPath("data.csv"), null);
  assert.equal(previewKindForPath("archive.docx.zip"), null);
  assert.equal(previewKindForPath("docx"), null);
  assert.equal(previewKindForPath(""), null);
});

test("previewKindForPath does not treat a dotfile as an extension", () => {
  assert.equal(previewKindForPath(".docx"), null);
  assert.equal(previewKindForPath("docs/.xlsx"), null);
});

test("previewTabTitle returns the trailing name only", () => {
  assert.equal(previewTabTitle("docs/2026/q1/report.docx"), "report.docx");
  assert.equal(previewTabTitle("docs\\report.xlsx"), "report.xlsx");
  assert.equal(previewTabTitle("report.pptx"), "report.pptx");
  assert.equal(previewTabTitle("docs/2026/"), "2026");
  assert.equal(previewTabTitle(""), "");
});

test("gridCell reads a cell and never invents content", () => {
  const rows = [
    ["name", "qty"],
    ["bolt", "12"],
  ];
  assert.equal(gridCell(rows, 0, 0), "name");
  assert.equal(gridCell(rows, 1, 1), "12");
});

test("gridCell returns an empty string outside the grid", () => {
  const rows = [["a", "b"]];
  assert.equal(gridCell(rows, 5, 0), "", "row past the end");
  assert.equal(gridCell(rows, -1, 0), "", "negative row");
  assert.equal(gridCell(rows, 0, 7), "", "column past the end");
  assert.equal(gridCell(rows, 0, -1), "", "negative column");
  assert.equal(gridCell([], 0, 0), "", "empty grid");
  assert.equal(gridCell([[]], 0, 0), "", "empty row");
});

test("gridCell renders a null cell as empty, not the string 'null'", () => {
  const rows = [["header", null, undefined], [null, "kept"]];
  assert.equal(gridCell(rows, 0, 1), "");
  assert.equal(gridCell(rows, 0, 2), "");
  assert.equal(gridCell(rows, 1, 0), "");
  assert.equal(gridCell(rows, 1, 1), "kept");
  assert.notEqual(gridCell(rows, 0, 1), "null");
});

test("gridWidth follows the widest row so no cell is clipped", () => {
  assert.equal(gridWidth([]), 0);
  assert.equal(gridWidth([["a", "b"], ["a", "b", "c"]]), 3);
  assert.equal(gridWidth([[null], []]), 1);
});

test("firstFilledRow skips the placeholder rows a sheet starts with", () => {
  const shifted = [
    ["", ""],
    ["", ""],
    ["item", "qty"],
  ];
  assert.equal(firstFilledRow(shifted), 2, "data starts at row 2");
  assert.equal(firstFilledRow([["item", "qty"]]), 0, "data starts at row 0");
  assert.equal(firstFilledRow([[], [""]]), -1, "nothing but blanks");
  assert.equal(firstFilledRow([["   ", null]]), -1, "whitespace is not text");
  assert.equal(firstFilledRow([]), -1, "empty grid");
});

test("unsupportedReasonKey maps every host reason onto an existing key", () => {
  assert.equal(unsupportedReasonKey("extension"), "panel.files.preview.extension");
  assert.equal(unsupportedReasonKey("corrupt"), "panel.files.preview.corrupt");
  assert.equal(unsupportedReasonKey("too-large"), "panel.files.preview.tooLarge");
});

test("every locale carries the same non-empty preview strings", () => {
  for (const locale of LOCALES) {
    const values = previewStrings(localeByTag[locale]);
    for (const key of PREVIEW_KEYS) {
      assert.ok(values[key], `${locale}: panel.files.preview.${key} is missing`);
      assert.ok(
        values[key].trim().length > 0,
        `${locale}: panel.files.preview.${key} is empty`,
      );
    }
    assert.deepEqual(
      Object.keys(values).sort(),
      [...PREVIEW_KEYS].sort(),
      `${locale}: preview key set drifted`,
    );
  }
});

test("non-English locales are translated, not left as English placeholders", () => {
  const english = previewStrings(localeByTag.en);
  for (const locale of LOCALES.filter((tag) => tag !== "en")) {
    const values = previewStrings(localeByTag[locale]);
    for (const key of ["unsupported", "failed", "openExternal"]) {
      assert.notEqual(
        values[key],
        english[key],
        `${locale}: panel.files.preview.${key} still holds the English string`,
      );
    }
  }
});

test("FilesTab routes documents to the host parser", () => {
  assert.match(filesTab, /import \{ previewKindForPath \} from "\.\.\/\.\.\/lib\/document-preview"/);
  assert.match(filesTab, /api\.previewDocument\(\{ path: rel \}\)/);
  assert.match(filesTab, /<DocumentPreview\b/);
  assert.match(filesTab, /<DocumentPreviewSkeleton\b/);
});

test("the document branch runs before the text reader, not after it", () => {
  const guard = filesTab.indexOf("if (previewKindForPath(rel))");
  const fsRead = filesTab.indexOf("api.fsRead(");
  assert.ok(guard >= 0, "openFile no longer branches on previewKindForPath");
  assert.ok(fsRead >= 0, "openFile no longer reads text files");
  assert.ok(
    lineOf(filesTab, guard) < lineOf(filesTab, fsRead),
    `document branch (line ${lineOf(filesTab, guard)}) must precede api.fsRead (line ${lineOf(filesTab, fsRead)})`,
  );
});

test("FilesTab keeps an escape hatch when the parse fails", () => {
  assert.match(filesTab, /panel\.files\.preview\.failed/);
  assert.match(filesTab, /api\.fsOpen\(selected\)/);
});

test("DocumentPreview draws real table semantics and a truncation notice", () => {
  assert.match(docPreview, /<th scope="col"/);
  assert.match(docPreview, /panel\.files\.preview\.truncated/);
  assert.match(docPreview, /role="tablist"/);
  assert.match(docPreview, /unsupportedReasonKey\(preview\.reason\)/);
  assert.doesNotMatch(docPreview, /dangerouslySetInnerHTML/);
});

test("a blank first row never becomes a header", () => {
  assert.match(
    docPreview,
    /hasHeader && \(\s*<thead>/,
    "the header row must sit behind the hasHeader guard",
  );
  assert.match(docPreview, /firstFilledRow\(rows\) === 0/);
});

test("cells keep the host's line breaks instead of collapsing them", () => {
  assert.match(
    styleSheet,
    /\.doc-preview-table th,\s*\.doc-preview-table td \{[^}]*white-space: pre-wrap;/,
    "docx cells join paragraphs with \\n, so the cell rule must preserve it",
  );
  assert.match(
    styleSheet,
    /\.doc-preview-table--nowrap th,\s*\.doc-preview-table--nowrap td \{\s*white-space: pre;/,
    "the spreadsheet variant must keep `pre` so columns still do not wrap",
  );
});

test("a runaway column is capped instead of stretching the panel", () => {
  // The host sends no column widths and allows 5000 characters per block, so a
  // single cell must not be able to size the whole table.
  assert.match(
    styleSheet,
    /\.doc-preview-table th,\s*\.doc-preview-table td \{[^}]*max-width:/,
    "cells need a width cap",
  );
  assert.match(
    styleSheet,
    /\.doc-preview-table--nowrap th,\s*\.doc-preview-table--nowrap td \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/,
    "clipped spreadsheet cells must show an ellipsis",
  );
  assert.match(
    docPreview,
    /title=\{titleOf\(text\)\}/,
    "a clipped cell must still expose its full text",
  );
});

test("an empty table block reads as an empty document, not a blank page", () => {
  // Two ways to get `rows: []`: the host's cell budget stopped before the first
  // cell (`truncated`), or the source kept a `<w:tbl>` shell with no `<w:tr>`.
  assert.equal(hasRenderableContent([{ kind: "table", rows: [] }]), false);
  assert.equal(hasRenderableContent([]), false);
  // Deliberate: a table with rows but no text is a template's empty grid, so it
  // keeps its borders instead of collapsing into the empty state.
  assert.equal(hasRenderableContent([{ kind: "table", rows: [["", ""]] }]), true);
  assert.equal(hasRenderableContent([{ kind: "heading", text: "title" }]), true);
  assert.equal(
    hasRenderableContent([
      { kind: "table", rows: [] },
      { kind: "paragraph", text: "body" },
    ]),
    true,
    "a later block still counts",
  );
  assert.match(
    docPreview,
    /if \(!hasRenderableContent\(blocks\)\)/,
    "the view must ask the helper instead of counting blocks",
  );
  assert.match(
    docPreview,
    /if \(rows\.length === 0 \|\| columns === 0\) return null;/,
    "an empty grid must render no table element at all",
  );
});

test("only the selected sheet is mounted, not all twenty", () => {
  // 20 sheets x 500 rows x 64 columns is 640k cells; mounting every sheet and
  // toggling visibility would put all of them in the DOM at once.
  assert.equal(
    (docPreview.match(/<DataTable\b/g) || []).length,
    2,
    "one table for docx blocks, one for the selected sheet",
  );
  assert.match(
    docPreview,
    /sheets\.map\([\s\S]{0,200}?<button/,
    "the sheet list must render tabs only",
  );
});

test("truncation comes from the host flag, never from counting rows", () => {
  // The host stops at MAX_SHEET_ROWS without padding the rest, so the row count
  // can look short while `truncated` is already true: the view must only read
  // the flag.
  assert.match(docPreview, /\{truncated && preview\.kind !== "unsupported" &&/);
  assert.doesNotMatch(
    docPreview,
    /truncated[^\n]*(rows\.length|blocks\.length|slides\.length)/,
    "truncation must not be re-derived from content length",
  );
});

test("the preview styles ship with the panel stylesheet", () => {
  for (const selector of [
    ".doc-preview-paper",
    ".doc-preview-table",
    ".doc-preview-sheet-scroll",
    ".doc-preview-slide",
    ".doc-preview-notice",
  ]) {
    assert.ok(styleSheet.includes(selector), `${selector} is missing from work-panel.css`);
  }
});
