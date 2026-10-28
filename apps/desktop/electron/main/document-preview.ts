import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { inflateRawSync } from "node:zlib";
import type {
  DocumentPreview,
  DocumentPreviewBlock,
  DocumentPreviewRequest,
  DocumentPreviewResult,
} from "@pi-desktop/shared";
// `.ts` on purpose: `node --test` loads this module directly, while the bundle
// resolves it the same way (see `main-process-errors.ts`).
import { resolveOpenablePath } from "./fs-panel.ts";

/**
 * Read-only rich preview of Office files (W-19).
 *
 * Three formats have to be readable without adding a dependency, so the ZIP
 * container and the little XML that matters are parsed here: a preview panel
 * needs text, not a document model, and a parser we own is one we can bound.
 */

/**
 * Anything bigger is a file the panel cannot usefully scroll, and reading it
 * would put a 100 MB buffer on the main-process heap for a format we then
 * throw away — so it is refused before the bytes are touched.
 */
export const MAX_PREVIEW_BYTES = 16 * 1024 * 1024;

/** Blocks per docx body: enough for a long report, small enough for one IPC frame. */
export const MAX_BLOCKS = 2000;
/** Rows per docx table; wide tables are read sideways, deep ones are the problem. */
export const MAX_TABLE_ROWS = 200;
/** Sheets per workbook: a preview tab shows a handful, not all forty. */
export const MAX_SHEETS = 20;
/** Rows per sheet; a data dump stops being previewable long before this. */
export const MAX_SHEET_ROWS = 500;
/** Columns per sheet, A..BL. Wider than this is not a readable table. */
export const MAX_SHEET_COLS = 64;
/** Slides per deck; the same order of magnitude as the block budget. */
export const MAX_SLIDES = 200;
/** One text block. Longer single paragraphs are cut, not wrapped. */
export const MAX_BLOCK_CHARS = 5000;

export type PreviewLimits = {
  maxBlocks: number;
  maxTableRows: number;
  maxSheets: number;
  maxSheetRows: number;
  maxSheetCols: number;
  maxSlides: number;
  maxBlockChars: number;
};

/** The shipped limits. Callers only pass their own in tests. */
export const DEFAULT_PREVIEW_LIMITS: PreviewLimits = {
  maxBlocks: MAX_BLOCKS,
  maxTableRows: MAX_TABLE_ROWS,
  maxSheets: MAX_SHEETS,
  maxSheetRows: MAX_SHEET_ROWS,
  maxSheetCols: MAX_SHEET_COLS,
  maxSlides: MAX_SLIDES,
  maxBlockChars: MAX_BLOCK_CHARS,
};

/**
 * Mirrors `ErrorCodes.PATH_OUTSIDE_WORKSPACE`. Spelled out rather than imported
 * so this module stays loadable by `node --test` without the shared bundle.
 */
const PATH_OUTSIDE_WORKSPACE = "PATH_OUTSIDE_WORKSPACE";
const NOT_FOUND = "NOT_FOUND";
const INVALID_ARGUMENT = "INVALID_ARGUMENT";

function failure(code: string, message: string): Error {
  return Object.assign(new Error(message), { errorCode: code });
}

// ---------------------------------------------------------------------------
// ZIP container
// ---------------------------------------------------------------------------

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** EOCD is 22 bytes plus a comment of at most 64 KiB. */
const EOCD_MAX_SCAN = 22 + 0xffff;

/**
 * Read the central directory. Returns null for anything this reader cannot
 * trust; a preview of a half-written or ZIP64 archive is not worth a guess.
 */
export function readZipDirectory(buffer: Buffer): Map<string, ZipEntry> | null {
  if (buffer.length < 22) return null;
  let eocd = -1;
  const stop = Math.max(0, buffer.length - EOCD_MAX_SCAN);
  for (let at = buffer.length - 22; at >= stop; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) return null;

  const count = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  // ZIP64 escapes to 0xffff/0xffffffff; the real directory lives in an extra
  // field this reader does not follow, so the archive is reported as unreadable.
  if (count === 0xffff || directoryOffset === 0xffffffff) return null;
  if (directoryOffset >= buffer.length) return null;

  const entries = new Map<string, ZipEntry>();
  let cursor = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length) return null;
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) return null;
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const offset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    if (nameStart + nameLength > buffer.length) return null;
    const name = buffer.toString("utf8", nameStart, nameStart + nameLength);
    entries.set(name, { name, method, compressedSize, size, offset });
    cursor = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Bytes of one entry, or null when the archive disagrees with itself.
 *
 * Central-directory sizes are the authority: a local header can carry zeros and
 * a data descriptor instead, so only the payload is taken from the local header.
 */
export function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer | null {
  const at = entry.offset;
  if (at + 30 > buffer.length) return null;
  if (buffer.readUInt32LE(at) !== LOCAL_SIGNATURE) return null;
  const nameLength = buffer.readUInt16LE(at + 26);
  const extraLength = buffer.readUInt16LE(at + 28);
  const start = at + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (start > buffer.length || end > buffer.length) return null;
  const payload = buffer.subarray(start, end);

  if (entry.method === 0) {
    // Stored: the two sizes must match, or the directory is describing something
    // other than the bytes on disk.
    return entry.compressedSize === entry.size ? payload : null;
  }
  if (entry.method !== 8) return null;
  try {
    const inflated = inflateRawSync(payload);
    return inflated.length === entry.size ? inflated : null;
  } catch {
    return null;
  }
}

/** Text of one entry, or null when it is missing or not decodable. */
function readZipText(
  buffer: Buffer,
  entries: Map<string, ZipEntry>,
  name: string,
): string | null {
  const entry = entries.get(name);
  if (!entry) return null;
  const bytes = readZipEntry(buffer, entry);
  return bytes ? bytes.toString("utf8") : null;
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
};

function localName(qualified: string): string {
  const colon = qualified.lastIndexOf(":");
  return colon < 0 ? qualified : qualified.slice(colon + 1);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Word escapes `&`, `<` and `>` in text nodes; `&#10;` shows up as a line break. */
export function decodeXmlText(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (let match = pattern.exec(raw); match; match = pattern.exec(raw)) {
    attrs[localName(match[1])] = decodeXmlText(match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/**
 * Minimal tree for one part, matched on local names so a `w:` or `x:` prefix
 * change does not matter. Self-closing tags become empty nodes; an unbalanced
 * document still yields whatever could be read, since a preview of half a
 * paragraph beats an error.
 */
export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const appendText = (text: string): void => {
    if (!text) return;
    stack[stack.length - 1].text += decodeXmlText(text);
  };

  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf("<", cursor);
    if (open < 0) {
      appendText(source.slice(cursor));
      break;
    }
    if (open > cursor) appendText(source.slice(cursor, open));

    let close = open + 1;
    let quote = "";
    for (; close < source.length; close += 1) {
      const char = source[close];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      }
    }
    if (close >= source.length) break;
    const raw = source.slice(open + 1, close);
    cursor = close + 1;

    if (raw.startsWith("?") || raw.startsWith("!")) continue;
    if (raw.startsWith("/")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const split = body.search(/\s/);
    const node: XmlNode = {
      name: localName(split < 0 ? body : body.slice(0, split)),
      attrs: split < 0 ? {} : parseAttributes(body.slice(split)),
      children: [],
      text: "",
    };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

function child(node: XmlNode, name: string): XmlNode | null {
  return node.children.find((candidate) => candidate.name === name) ?? null;
}

function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((candidate) => candidate.name === name);
}

function descendants(node: XmlNode, name: string): XmlNode[] {
  const found: XmlNode[] = [];
  const walk = (current: XmlNode): void => {
    for (const candidate of current.children) {
      if (candidate.name === name) found.push(candidate);
      walk(candidate);
    }
  };
  walk(node);
  return found;
}

function firstDescendant(node: XmlNode | null, name: string): XmlNode | null {
  if (!node) return null;
  return descendants(node, name)[0] ?? null;
}

/** A part's text, or null when the part is absent — a missing part is `corrupt`. */
function partText(buffer: Buffer, entries: Map<string, ZipEntry>, name: string): XmlNode | null {
  const text = readZipText(buffer, entries, name);
  return text === null ? null : parseXml(text);
}

// ---------------------------------------------------------------------------
// Budget helpers
// ---------------------------------------------------------------------------

type Budget = { limits: PreviewLimits; truncated: boolean };

function capText(budget: Budget, text: string): string {
  if (text.length <= budget.limits.maxBlockChars) return text;
  budget.truncated = true;
  return text.slice(0, budget.limits.maxBlockChars);
}

// ---------------------------------------------------------------------------
// docx
// ---------------------------------------------------------------------------

/** Elements that carry visible text, in the order they appear in a paragraph. */
function runText(node: XmlNode): string {
  let text = "";
  const walk = (current: XmlNode, inProperties: boolean): void => {
    for (const candidate of current.children) {
      // `w:pPr > w:tabs > w:tab` defines a tab stop; it is not a tab character.
      const properties = inProperties || candidate.name === "pPr" || candidate.name === "tabs";
      if (candidate.name === "t") text += candidate.text;
      else if (candidate.name === "br" && !inProperties) text += "\n";
      else if (candidate.name === "tab" && !properties) text += "\t";
      else if (candidate.name === "delText" || candidate.name === "instrText") continue;
      else walk(candidate, properties);
    }
  };
  walk(node, false);
  return text;
}

function isHeading(paragraph: XmlNode): boolean {
  const style = firstDescendant(paragraph, "pStyle");
  const id = style?.attrs.val ?? "";
  return id === "Title" || id.startsWith("Heading") || id.startsWith("heading");
}

function tableRows(node: XmlNode, budget: Budget): string[][] {
  const rows: string[][] = [];
  for (const row of children(node, "tr")) {
    if (rows.length >= budget.limits.maxTableRows) {
      budget.truncated = true;
      break;
    }
    const cells = children(row, "tc").map((cell) =>
      // A cell may hold several paragraphs; they are kept on separate lines so a
      // multi-line cell does not read as one run-on sentence.
      capText(
        budget,
        children(cell, "p")
          .map((paragraph) => runText(paragraph))
          .join("\n"),
      ),
    );
    rows.push(cells);
  }
  return rows;
}

/**
 * Body-level blocks, looking through content controls.
 *
 * Word wraps form fields, tables of contents and whole sections in `w:sdt`;
 * the block inside is an ordinary paragraph, so skipping the wrapper would drop
 * the most prominent part of a template.
 */
function blockNodes(node: XmlNode): XmlNode[] {
  const nodes: XmlNode[] = [];
  for (const candidate of node.children) {
    if (candidate.name === "p" || candidate.name === "tbl") nodes.push(candidate);
    else if (candidate.name === "sdt") {
      for (const content of children(candidate, "sdtContent")) nodes.push(...blockNodes(content));
    }
  }
  return nodes;
}

function parseDocx(buffer: Buffer, entries: Map<string, ZipEntry>, budget: Budget): DocumentPreview {
  const document = partText(buffer, entries, "word/document.xml");
  const body = firstDescendant(document, "body");
  if (!body) return { kind: "unsupported", reason: "corrupt" };

  const blocks: DocumentPreviewBlock[] = [];
  for (const node of blockNodes(body)) {
    if (blocks.length >= budget.limits.maxBlocks) {
      budget.truncated = true;
      break;
    }
    if (node.name === "p") {
      const text = capText(budget, runText(node));
      // An empty paragraph is spacing, not content: the panel does not need it.
      if (!text.trim()) continue;
      blocks.push(isHeading(node) ? { kind: "heading", text } : { kind: "paragraph", text });
    } else if (node.name === "tbl") {
      const rows = tableRows(node, budget);
      if (rows.length > 0) blocks.push({ kind: "table", rows });
    }
  }
  return { kind: "docx", blocks };
}

// ---------------------------------------------------------------------------
// xlsx
// ---------------------------------------------------------------------------

/** `A`..`Z`, `AA`..`XFD` into a 0-based column index. */
export function columnIndex(reference: string): number {
  let index = 0;
  for (const char of reference) {
    const code = char.charCodeAt(0);
    if (code >= 65 && code <= 90) index = index * 26 + (code - 64);
    else if (code >= 97 && code <= 122) index = index * 26 + (code - 96);
    else break;
  }
  return index - 1;
}

/** Row number from a cell reference; `0` when the reference has no digits. */
function rowNumber(reference: string): number {
  const digits = /(\d+)$/.exec(reference);
  return digits ? Number.parseInt(digits[1], 10) : 0;
}

function resolveTarget(baseDirectory: string, target: string): string {
  const normalized = target.replace(/\\/g, "/");
  const parts = normalized.startsWith("/")
    ? []
    : baseDirectory.split("/").filter(Boolean);
  for (const segment of normalized.replace(/^\//, "").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

/** Relationship id → part path, as the rels part declares it. */
function relationshipTargets(
  buffer: Buffer,
  entries: Map<string, ZipEntry>,
  relsPath: string,
  baseDirectory: string,
): Map<string, string> {
  const targets = new Map<string, string>();
  const part = partText(buffer, entries, relsPath);
  if (!part) return targets;
  for (const relationship of descendants(part, "Relationship")) {
    const id = relationship.attrs.Id ?? relationship.attrs.id ?? "";
    const target = relationship.attrs.Target ?? relationship.attrs.target ?? "";
    if (id && target) targets.set(id, resolveTarget(baseDirectory, target));
  }
  return targets;
}

function sharedStrings(buffer: Buffer, entries: Map<string, ZipEntry>): string[] {
  const part = partText(buffer, entries, "xl/sharedStrings.xml");
  if (!part) return [];
  // `rPh` is phonetic guidance for East Asian text; it is not the cell value.
  const collect = (node: XmlNode): string =>
    node.children
      .filter((candidate) => candidate.name !== "rPh" && candidate.name !== "phoneticPr")
      .map((candidate) => candidate.text + collect(candidate))
      .join("");
  return descendants(part, "si").map((item) => collect(item));
}

function cellText(cell: XmlNode, strings: readonly string[]): string {
  const type = cell.attrs.t ?? "";
  if (type === "s") {
    const value = child(cell, "v")?.text ?? "";
    const index = Number.parseInt(value.trim(), 10);
    return Number.isFinite(index) ? (strings[index] ?? "") : "";
  }
  if (type === "inlineStr") return firstDescendant(child(cell, "is"), "t")?.text ?? "";
  // `str` is a formula result, no type at all is a plain number or date literal:
  // both are the raw text of `v`.
  return child(cell, "v")?.text ?? "";
}

function parseSheet(
  buffer: Buffer,
  entries: Map<string, ZipEntry>,
  path: string,
  strings: readonly string[],
  budget: Budget,
): string[][] {
  const sheet = partText(buffer, entries, path);
  const data = firstDescendant(sheet, "sheetData");
  if (!data) return [];

  const rows: string[][] = [];
  let sequential = 0;
  for (const row of children(data, "row")) {
    if (rows.length >= budget.limits.maxSheetRows) {
      budget.truncated = true;
      break;
    }
    const declared = Number.parseInt(row.attrs.r ?? "", 10);
    const at = Number.isFinite(declared) && declared > 0 ? declared - 1 : sequential;
    sequential = at + 1;
    // A single stale row number near the end of a sheet would otherwise pad
    // thousands of blank rows into the result.
    if (at >= budget.limits.maxSheetRows) {
      budget.truncated = true;
      break;
    }

    const values: string[] = [];
    let column = -1;
    for (const cell of children(row, "c")) {
      const reference = cell.attrs.r ?? "";
      const index = reference ? columnIndex(reference) : column + 1;
      column = index;
      if (index < 0) continue;
      if (index >= budget.limits.maxSheetCols) {
        budget.truncated = true;
        continue;
      }
      // A skipped cell is absent from the file, not empty in the sheet.
      while (values.length < index) values.push("");
      values[index] = capText(budget, cellText(cell, strings));
    }
    // Rows are numbered, so a hole in the file is a blank row in the sheet.
    while (rows.length < at) rows.push([]);
    rows[at] = values;
  }

  const width = Math.min(
    budget.limits.maxSheetCols,
    rows.reduce((widest, row) => Math.max(widest, row.length), 0),
  );
  return rows.map((row) => {
    const padded = row.slice(0, width);
    while (padded.length < width) padded.push("");
    return padded;
  });
}

function parseXlsx(buffer: Buffer, entries: Map<string, ZipEntry>, budget: Budget): DocumentPreview {
  const workbook = partText(buffer, entries, "xl/workbook.xml");
  const sheetsNode = firstDescendant(workbook, "sheets");
  if (!sheetsNode) return { kind: "unsupported", reason: "corrupt" };

  const declared = children(sheetsNode, "sheet");
  const targets = relationshipTargets(
    buffer,
    entries,
    "xl/_rels/workbook.xml.rels",
    "xl",
  );
  const strings = sharedStrings(buffer, entries);

  const sheets: { name: string; rows: string[][] }[] = [];
  for (const [index, sheet] of declared.entries()) {
    if (sheets.length >= budget.limits.maxSheets) {
      budget.truncated = true;
      break;
    }
    const relationshipId = sheet.attrs.id ?? "";
    // A workbook written by hand may skip rels; sheet order is then the file
    // order the format already guarantees.
    const path = targets.get(relationshipId) ?? `xl/worksheets/sheet${index + 1}.xml`;
    if (!entries.has(path)) return { kind: "unsupported", reason: "corrupt" };
    sheets.push({
      name: capText(budget, sheet.attrs.name ?? ""),
      rows: parseSheet(buffer, entries, path, strings, budget),
    });
  }
  return { kind: "xlsx", sheets };
}

// ---------------------------------------------------------------------------
// pptx
// ---------------------------------------------------------------------------

function shapeText(shape: XmlNode): string {
  const body = child(shape, "txBody");
  if (!body) return "";
  return children(body, "p")
    .map((paragraph) => runText(paragraph))
    .join(" ")
    .trim();
}

function parseSlideTitle(slide: XmlNode): string {
  for (const shape of descendants(slide, "sp")) {
    const placeholder = firstDescendant(child(shape, "nvSpPr"), "ph");
    const type = placeholder?.attrs.type ?? "";
    if (type === "title" || type === "ctrTitle") {
      const text = shapeText(shape);
      if (text) return text;
    }
  }
  // A slide laid out without a placeholder still has a first shape; it is not
  // labelled, so no title is reported rather than guessing wrong.
  return "";
}

function parseSlideBullets(slide: XmlNode): string[] {
  const bullets: string[] = [];
  for (const shape of descendants(slide, "sp")) {
    const placeholder = firstDescendant(child(shape, "nvSpPr"), "ph");
    const type = placeholder?.attrs.type ?? "";
    if (type === "title" || type === "ctrTitle") continue;
    const body = child(shape, "txBody");
    if (!body) continue;
    for (const paragraph of children(body, "p")) {
      // Levels are flattened on purpose: the panel shows a list, not an outline.
      const text = runText(paragraph).trim();
      if (text) bullets.push(text);
    }
  }
  return bullets;
}

function parsePptx(buffer: Buffer, entries: Map<string, ZipEntry>, budget: Budget): DocumentPreview {
  const presentation = partText(buffer, entries, "ppt/presentation.xml");
  const list = firstDescendant(presentation, "sldIdLst");
  if (!list) return { kind: "unsupported", reason: "corrupt" };

  const ids = children(list, "sldId");
  const targets = relationshipTargets(
    buffer,
    entries,
    "ppt/_rels/presentation.xml.rels",
    "ppt",
  );

  const slides: { title: string; bullets: string[] }[] = [];
  for (const [index, entry] of ids.entries()) {
    if (slides.length >= budget.limits.maxSlides) {
      budget.truncated = true;
      break;
    }
    const relationshipId = entry.attrs.id ?? "";
    const path = targets.get(relationshipId) ?? `ppt/slides/slide${index + 1}.xml`;
    if (!entries.has(path)) return { kind: "unsupported", reason: "corrupt" };
    const slide = partText(buffer, entries, path);
    if (!slide) return { kind: "unsupported", reason: "corrupt" };
    const bullets = parseSlideBullets(slide).map((bullet) => capText(budget, bullet));
    slides.push({ title: capText(budget, parseSlideTitle(slide)), bullets });
  }
  return { kind: "pptx", slides };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

const EXTENSION_KIND: Record<string, "docx" | "xlsx" | "pptx"> = {
  ".docx": "docx",
  ".xlsx": "xlsx",
  ".pptx": "pptx",
};

/** Parse bytes already in memory; the extension decides the reader. */
export function parseDocumentPreview(
  path: string,
  buffer: Buffer,
  limits: PreviewLimits = DEFAULT_PREVIEW_LIMITS,
): DocumentPreviewResult {
  const budget: Budget = { limits, truncated: false };
  const kind = EXTENSION_KIND[extname(path).toLowerCase()];
  // Anything else is the renderer's cue to show the plain file view.
  if (!kind) return { preview: { kind: "unsupported", reason: "extension" }, truncated: false };

  const entries = readZipDirectory(buffer);
  if (!entries) return { preview: { kind: "unsupported", reason: "corrupt" }, truncated: false };

  // A malformed part must not escape as a throw: the panel falls back instead.
  let preview: DocumentPreview;
  try {
    preview =
      kind === "docx"
        ? parseDocx(buffer, entries, budget)
        : kind === "xlsx"
          ? parseXlsx(buffer, entries, budget)
          : parsePptx(buffer, entries, budget);
  } catch {
    return { preview: { kind: "unsupported", reason: "corrupt" }, truncated: false };
  }
  if (preview.kind === "unsupported") return { preview, truncated: false };
  return { preview, truncated: budget.truncated };
}

/**
 * Read one Office document for the preview panel.
 *
 * Containment is `fs/open`'s (D320): a workspace-relative path, an
 * `attachments/<sha256>` blob, or an absolute path inside a root the file tab
 * may already read. A rejected path throws an `AppError` code and never echoes
 * the path back — the renderer supplied it, so repeating it only widens the log.
 */
export async function readDocumentPreview(
  request: DocumentPreviewRequest,
  workspaceRoot: string | null | undefined,
  extraRoots: readonly string[],
  limits: PreviewLimits = DEFAULT_PREVIEW_LIMITS,
): Promise<DocumentPreviewResult> {
  const requested = String(request?.path ?? "").trim();
  if (!requested) throw failure(INVALID_ARGUMENT, "document path required");

  const target = resolveOpenablePath(requested, workspaceRoot, extraRoots);
  if (!target) throw failure(PATH_OUTSIDE_WORKSPACE, "path outside allowed roots");

  let size: number;
  try {
    size = (await stat(target)).size;
  } catch {
    throw failure(NOT_FOUND, "file not found");
  }
  // Checked before the read: a large archive is refused without allocating it.
  if (size > MAX_PREVIEW_BYTES) {
    return { preview: { kind: "unsupported", reason: "too-large" }, truncated: false };
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(target);
  } catch {
    throw failure(NOT_FOUND, "file not found");
  }
  return parseDocumentPreview(target, buffer, limits);
}
