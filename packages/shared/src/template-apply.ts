/**
 * Template application: fill one template, then fill it for many rows.
 *
 * Two rules keep this honest:
 * - every missing required variable is reported at once, because a form that
 *   reveals one red field per submit is slower than no template at all;
 * - a filled-in fact is never silently dropped — unknown placeholders stay
 *   literal and over-long values are trimmed with a warning, so the user can
 *   see what the document will actually say.
 */

import type { DocumentTemplate, TemplateBlock } from "./template-presets.js";

export type TemplateValues = Record<string, string>;

export type ApplyWarning =
  | { kind: "unknownVar"; key: string }
  | { kind: "trimmed"; key: string; limit: number }
  | { kind: "assumedOrder" };

export type ApplyOutcome =
  | {
      ok: true;
      blocks: TemplateBlock[];
      missing: [];
      warnings: ApplyWarning[];
      values: TemplateValues;
    }
  | {
      ok: false;
      blocks: [];
      missing: string[];
      warnings: ApplyWarning[];
      values: TemplateValues;
    };

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

/** Variable keys in declaration order, which is also the form order. */
export function templateVarKeys(template: DocumentTemplate): string[] {
  return template.vars.map((variable) => variable.key);
}

function truncate(value: string, limit: number): string {
  // Cut on a word when possible: half a word reads as a bug, not a shortening.
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return space > limit * 0.6 ? cut.slice(0, space) : cut;
}

function normalizeValues(
  template: DocumentTemplate,
  values: TemplateValues,
): { values: TemplateValues; missing: string[]; warnings: ApplyWarning[] } {
  const warnings: ApplyWarning[] = [];
  const missing: string[] = [];
  const clean: TemplateValues = {};

  for (const variable of template.vars) {
    const raw = (values[variable.key] ?? "").trim();
    if (!raw) {
      if (variable.required) missing.push(variable.key);
      clean[variable.key] = "";
      continue;
    }
    const next = truncate(raw, variable.maxLength);
    if (next !== raw) {
      warnings.push({
        kind: "trimmed",
        key: variable.key,
        limit: variable.maxLength,
      });
    }
    clean[variable.key] = next;
  }

  return { values: clean, missing, warnings };
}

function renderText(
  text: string,
  values: TemplateValues,
  declared: ReadonlySet<string>,
  warnings: ApplyWarning[],
): string {
  return text
    .replace(PLACEHOLDER, (match, key: string) => {
      if (!declared.has(key)) {
        warnings.push({ kind: "unknownVar", key });
        return match;
      }
      return values[key] ?? "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function renderBlocks(
  template: DocumentTemplate,
  values: TemplateValues,
  warnings: ApplyWarning[],
): TemplateBlock[] {
  const declared = new Set(templateVarKeys(template));
  const rendered: TemplateBlock[] = [];

  for (const block of template.blocks) {
    if (block.type === "heading") {
      const text = renderText(block.text, values, declared, warnings);
      if (text) rendered.push({ type: "heading", text });
      continue;
    }
    if (block.type === "paragraph") {
      const text = renderText(block.text, values, declared, warnings);
      if (text) rendered.push({ type: "paragraph", text });
      continue;
    }
    if (block.type === "bullets") {
      const items = block.items
        .map((item) => renderText(item, values, declared, warnings))
        .filter(Boolean);
      if (items.length) rendered.push({ type: "bullets", items });
      continue;
    }
    const headers = block.headers
      .map((header) => renderText(header, values, declared, warnings))
      .filter(Boolean);
    const rows = block.rows
      .map((row) =>
        row.map((cell) => renderText(cell, values, declared, warnings)),
      )
      .filter((row) => row.some(Boolean));
    if (headers.length) rendered.push({ type: "table", headers, rows });
  }

  return rendered;
}

/** Fill one template. Missing required variables fail the whole fill. */
export function applyTemplate(
  template: DocumentTemplate,
  values: TemplateValues,
): ApplyOutcome {
  const normalized = normalizeValues(template, values);
  const blocks = renderBlocks(template, normalized.values, normalized.warnings);

  if (normalized.missing.length) {
    // Do not hand back half a document: an incomplete render is worse than none.
    return {
      ok: false,
      blocks: [],
      missing: normalized.missing,
      warnings: normalized.warnings,
      values: normalized.values,
    };
  }

  return {
    ok: true,
    blocks,
    missing: [],
    warnings: normalized.warnings,
    values: normalized.values,
  };
}

const ILLEGAL_FILENAME = /[\\/:*?"<>|]+/g;

/** Output name from the pattern; never empty, never containing a path. */
export function renderFileName(
  template: DocumentTemplate,
  values: TemplateValues,
  extension?: string,
): string {
  const flat: TemplateValues = {};
  for (const [key, value] of Object.entries(values)) {
    // A newline in a title would otherwise become a directory-shaped name.
    flat[key] = (value ?? "").replace(/\s+/g, " ").trim();
  }
  const declared = new Set(templateVarKeys(template));
  const raw = template.fileName.replace(PLACEHOLDER, (_match, key: string) =>
    declared.has(key) ? (flat[key] ?? "") : "",
  );
  const cleaned = raw
    .replace(ILLEGAL_FILENAME, "-")
    .replace(/[\s-]{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80)
    .replace(/[-.]+$/g, "");
  const fallback = template.id.split(".").at(-1) ?? "document";
  return `${cleaned || fallback}${extension ?? `.${template.kind}`}`;
}

export type PromptInput = {
  template: DocumentTemplate;
  fileName: string;
  blocks: TemplateBlock[];
};

function describeBlock(block: TemplateBlock): string {
  if (block.type === "heading") return `heading: ${block.text}`;
  if (block.type === "paragraph") return `paragraph: ${block.text}`;
  if (block.type === "bullets") {
    return `bullets:\n${block.items.map((item) => `  - ${item}`).join("\n")}`;
  }
  const header = `table: ${block.headers.join(" | ")}`;
  const rows = block.rows.map((row) => `  ${row.join(" | ")}`).join("\n");
  return rows ? `${header}\n${rows}` : header;
}

/**
 * The prompt handed to the agent.
 *
 * English is deliberate: tool names and structure words are English everywhere
 * in the product, and mixing a translated instruction with an English tool name
 * is how the wrong tool gets called.
 */
export function templateTaskPrompt(input: PromptInput): string {
  const { template, fileName, blocks } = input;
  const tool =
    template.kind === "docx"
      ? "OfficeDoc"
      : template.kind === "xlsx"
        ? "OfficeSheet"
        : "OfficeSlides";
  const body = blocks.map(describeBlock).join("\n\n");
  return [
    `Create the file "${fileName}" with the ${tool} tool.`,
    "Use the structure below exactly — same order, same wording. Do not add sections.",
    "",
    body,
  ].join("\n");
}

export type BatchParse =
  | { ok: true; rows: TemplateValues[]; warnings: ApplyWarning[] }
  | { ok: false; reason: "empty" | "noSeparator" };

/**
 * Parse a pasted block of rows (Excel paste is tab-separated, hand-typed rows
 * are usually commas). A recognised header row maps columns by name; otherwise
 * columns are assumed to follow the template's variable order and say so.
 */
export function parseBatchTable(
  text: string,
  template: DocumentTemplate,
): BatchParse {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return { ok: false, reason: "empty" };

  const separator = lines.some((line) => line.includes("\t")) ? "\t" : ",";
  if (!lines.some((line) => line.includes(separator))) {
    return { ok: false, reason: "noSeparator" };
  }

  const keys = templateVarKeys(template);
  const cells = lines.map((line) => line.split(separator).map((cell) => cell.trim()));
  const warnings: ApplyWarning[] = [];

  let header: string[] | null = null;
  const first = cells[0].map((cell) => cell.toLowerCase());
  const known = new Set(keys.map((key) => key.toLowerCase()));
  if (first.length && first.every((cell) => known.has(cell))) {
    header = first;
  }

  const rows = (header ? cells.slice(1) : cells).map((row) => {
    const values: TemplateValues = {};
    if (header) {
      header.forEach((key, index) => {
        values[key] = row[index] ?? "";
      });
      return values;
    }
    keys.forEach((key, index) => {
      values[key] = row[index] ?? "";
    });
    return values;
  });

  if (!header) {
    // Loud, because a wrong column order silently swaps two facts.
    warnings.push({ kind: "assumedOrder" });
  }

  return { ok: true, rows, warnings };
}

export type BatchFile = {
  fileName: string;
  blocks: TemplateBlock[];
  values: TemplateValues;
};

export type BatchOutcome = {
  files: BatchFile[];
  skipped: Array<{ index: number; missing: string[] }>;
  warnings: ApplyWarning[];
};

/** Fill one template per row; a bad row is skipped, never the whole batch. */
export function applyTemplateBatch(
  template: DocumentTemplate,
  rows: readonly TemplateValues[],
): BatchOutcome {
  const files: BatchFile[] = [];
  const skipped: BatchOutcome["skipped"] = [];
  const warnings: ApplyWarning[] = [];
  const used = new Map<string, number>();

  rows.forEach((row, index) => {
    const applied = applyTemplate(template, row);
    warnings.push(...applied.warnings);
    if (!applied.ok) {
      skipped.push({ index, missing: applied.missing });
      return;
    }
    let fileName = renderFileName(template, applied.values);
    const seen = used.get(fileName.toLowerCase()) ?? 0;
    if (seen) {
      const dot = fileName.lastIndexOf(".");
      const base = fileName.slice(0, dot);
      const extension = fileName.slice(dot);
      fileName = `${base}-${seen + 1}${extension}`;
    }
    used.set(fileName.toLowerCase(), seen + 1);
    files.push({ fileName, blocks: applied.blocks, values: applied.values });
  });

  return { files, skipped, warnings };
}
