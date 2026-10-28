import { describe, expect, it } from "vitest";

import {
  applyTemplate,
  applyTemplateBatch,
  parseBatchTable,
  renderFileName,
  templateTaskPrompt,
  templateVarKeys,
} from "./template-apply.js";
import {
  DOCUMENT_TEMPLATES,
  findDocumentTemplate,
  templatesByKind,
  type DocumentTemplate,
} from "./template-presets.js";

const report = findDocumentTemplate("docx.report")!;

const filled = {
  title: "Q3 review",
  period: "2026 Q3",
  author: "Lin",
  summary: "Revenue grew while churn held flat.",
  point1: "Revenue up 12%",
  point2: "Churn flat",
  point3: "Two hires closed",
  metricName: "Revenue",
  metricValue: "1.2M",
  metricChange: "+12%",
  conclusion: "Keep the current plan.",
};

describe("applyTemplate", () => {
  it("fills every block in template order", () => {
    const result = applyTemplate(report, filled);
    expect(result.ok).toBe(true);
    expect(result.blocks[0]).toEqual({ type: "heading", text: "Q3 review" });
    expect(result.blocks[1]).toEqual({
      type: "paragraph",
      text: "2026 Q3 · Lin",
    });
    expect(result.missing).toEqual([]);
  });

  it("reports every missing required variable at once", () => {
    const result = applyTemplate(report, { title: "Only a title" });
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("period");
    expect(result.missing).toContain("summary");
    expect(result.missing.length).toBeGreaterThan(3);
  });

  it("never returns half a document when a variable is missing", () => {
    const result = applyTemplate(report, { title: "Only a title" });
    expect(result.ok).toBe(false);
    expect(result.blocks).toEqual([]);
  });

  it("drops a block whose optional variable was left empty", () => {
    const result = applyTemplate(report, { ...filled, conclusion: "" });
    expect(result.ok).toBe(true);
    expect(result.blocks.at(-1)).not.toEqual({
      type: "paragraph",
      text: "",
    });
    expect(JSON.stringify(result.blocks)).not.toContain("conclusion");
  });

  it("trims an over-long value on a word boundary and says so", () => {
    const long = `${"a".repeat(50)} ${"b".repeat(60)}`;
    const result = applyTemplate(report, { ...filled, title: long });
    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual({
      kind: "trimmed",
      key: "title",
      limit: 80,
    });
    expect((result.blocks[0] as { text: string }).text).toBe("a".repeat(50));
  });

  it("keeps an undeclared placeholder literal instead of guessing", () => {
    const custom: DocumentTemplate = {
      id: "docx.custom",
      kind: "docx",
      nameKey: "templates.docxReport",
      descriptionKey: "templates.docxReportDesc",
      fileName: "{{title}}",
      vars: [{ key: "title", example: "T", required: true, maxLength: 80 }],
      blocks: [{ type: "paragraph", text: "{{title}} / {{nope}}" }],
    };
    const result = applyTemplate(custom, { title: "Hello" });
    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual({ kind: "unknownVar", key: "nope" });
    expect(result.blocks[0]).toEqual({
      type: "paragraph",
      text: "Hello / {{nope}}",
    });
  });
});

describe("renderFileName", () => {
  it("builds the name from the pattern and adds the extension", () => {
    expect(renderFileName(report, filled)).toBe("Q3 review-2026 Q3.docx");
  });

  it("removes characters that cannot live in a filename", () => {
    const name = renderFileName(report, {
      ...filled,
      title: 'Q3: "review" / final?',
    });
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name.endsWith(".docx")).toBe(true);
  });

  it("flattens newlines so a title cannot become a directory", () => {
    const name = renderFileName(report, {
      ...filled,
      title: "Line one\nLine two",
    });
    expect(name).toBe("Line one Line two-2026 Q3.docx");
  });

  it("falls back to the template id when everything is empty", () => {
    const custom: DocumentTemplate = {
      ...report,
      id: "docx.report",
      fileName: "{{missing}}",
    };
    expect(renderFileName(custom, {})).toBe("report.docx");
  });

  it("honours an explicit extension", () => {
    expect(renderFileName(report, filled, ".pdf")).toBe(
      "Q3 review-2026 Q3.pdf",
    );
  });
});

describe("parseBatchTable", () => {
  const keys = templateVarKeys(report);

  it("maps columns by header name regardless of order", () => {
    const text = ["period\ttitle", "2026 Q3\tQ3 review"].join("\n");
    const parsed = parseBatchTable(text, report);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]).toEqual({ period: "2026 Q3", title: "Q3 review" });
    expect(parsed.warnings).toEqual([]);
  });

  it("assumes declaration order when there is no header, and warns", () => {
    const text = ["2026 Q3", "Q3 review"].join(",");
    const parsed = parseBatchTable(text, report);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.rows[0])).toEqual(keys);
    expect(parsed.rows[0].title).toBe("2026 Q3");
    expect(parsed.warnings).toContainEqual({ kind: "assumedOrder" });
  });

  it("pads short rows instead of throwing", () => {
    const text = ["title,period", "Only title"].join("\n");
    const parsed = parseBatchTable(text, report);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0].period).toBe("");
  });

  it("refuses empty input and input with no separator", () => {
    expect(parseBatchTable("  \n ", report)).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(parseBatchTable("single line", report)).toEqual({
      ok: false,
      reason: "noSeparator",
    });
  });
});

describe("applyTemplateBatch", () => {
  it("skips a row with missing values without losing the rest", () => {
    const outcome = applyTemplateBatch(report, [
      { ...filled, title: "First" },
      { title: "Broken" },
      { ...filled, title: "Third" },
    ]);
    expect(outcome.files).toHaveLength(2);
    expect(outcome.skipped).toHaveLength(1);
    expect(outcome.skipped[0].index).toBe(1);
    expect(outcome.skipped[0].missing).toContain("period");
  });

  it("numbers duplicate output names instead of overwriting", () => {
    const outcome = applyTemplateBatch(report, [
      { ...filled, title: "Same" },
      { ...filled, title: "Same" },
    ]);
    expect(outcome.files.map((file) => file.fileName)).toEqual([
      "Same-2026 Q3.docx",
      "Same-2026 Q3-2.docx",
    ]);
  });
});

describe("templateTaskPrompt", () => {
  it("names the right office tool for each kind", () => {
    const docx = applyTemplate(report, filled);
    if (!docx.ok) throw new Error("expected a filled template");
    const prompt = templateTaskPrompt({
      template: report,
      fileName: "Q3.docx",
      blocks: docx.blocks,
    });
    expect(prompt).toContain('Create the file "Q3.docx" with the OfficeDoc tool.');
    expect(prompt).toContain("Do not add sections.");
    expect(prompt).toContain("bullets:");
    expect(prompt).toContain("heading: Q3 review");
  });
});

describe("template catalogue", () => {
  it("keeps ids unique and covers all three document kinds", () => {
    const ids = DOCUMENT_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(templatesByKind().map((group) => group.kind)).toEqual([
      "docx",
      "xlsx",
      "pptx",
    ]);
    for (const group of templatesByKind()) {
      expect(group.templates.length).toBeGreaterThan(0);
    }
  });

  it("declares every placeholder it uses", () => {
    for (const template of DOCUMENT_TEMPLATES) {
      const declared = new Set(template.vars.map((variable) => variable.key));
      const text = JSON.stringify([template.fileName, template.blocks]);
      const used = [...text.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)].map(
        (match) => match[1],
      );
      expect(used.length).toBeGreaterThan(0);
      for (const key of used) {
        expect(declared, `${template.id} uses undeclared {{${key}}}`).toContain(
          key,
        );
      }
    }
  });

  it("gives every variable an example a person could copy", () => {
    for (const template of DOCUMENT_TEMPLATES) {
      for (const variable of template.vars) {
        expect(variable.example.trim().length).toBeGreaterThan(0);
        expect(variable.maxLength).toBeGreaterThan(0);
      }
    }
  });
});
