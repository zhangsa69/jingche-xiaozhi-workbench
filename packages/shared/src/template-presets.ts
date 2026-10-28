/**
 * Built-in document templates: the skeleton only, never the wording.
 *
 * Every fixed string in a block is a `{{variable}}`, so one template serves all
 * eight UI languages: the user supplies the words, the template supplies the
 * order — heading, summary, a few points, one table, a closing line. If a
 * template ever needs a literal sentence it becomes a variable in the panel,
 * which keeps "same shape every time" true across languages.
 */

export type TemplateKind = "docx" | "xlsx" | "pptx";

export type TemplateVar = {
  key: string;
  /** Example shown as the input placeholder; also the shape a value should take. */
  example: string;
  required: boolean;
  /** Values longer than this are trimmed with a note instead of breaking layout. */
  maxLength: number;
};

export type TemplateBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

export type DocumentTemplate = {
  id: string;
  kind: TemplateKind;
  /** i18n key for the card title; the skeleton itself stays language-neutral. */
  nameKey: string;
  descriptionKey: string;
  /** Output name pattern; `{{var}}` is replaced, illegal filename characters are dropped. */
  fileName: string;
  vars: TemplateVar[];
  blocks: TemplateBlock[];
};

const short = (key: string, example: string, required = true): TemplateVar => ({
  key,
  example,
  required,
  maxLength: 80,
});

const long = (key: string, example: string, required = true): TemplateVar => ({
  key,
  example,
  required,
  maxLength: 400,
});

/**
 * Five templates, each one screen of input.
 *
 * Templates are deliberately small: a template with twenty variables is a form,
 * and a form is what the user was avoiding by asking for a template.
 */
export const DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = [
  {
    id: "docx.report",
    kind: "docx",
    nameKey: "templates.docxReport",
    descriptionKey: "templates.docxReportDesc",
    fileName: "{{title}}-{{period}}",
    vars: [
      short("title", "2026 Q3 review"),
      short("period", "2026 Q3"),
      short("author", "Lin"),
      long("summary", "Three paragraphs at most."),
      short("point1", "Revenue up 12%"),
      short("point2", "Churn flat"),
      short("point3", "Two hires closed"),
      short("metricName", "Revenue"),
      short("metricValue", "1.2M"),
      short("metricChange", "+12%"),
      long("conclusion", "Keep the current plan.", false),
    ],
    blocks: [
      { type: "heading", text: "{{title}}" },
      { type: "paragraph", text: "{{period}} · {{author}}" },
      { type: "paragraph", text: "{{summary}}" },
      { type: "bullets", items: ["{{point1}}", "{{point2}}", "{{point3}}"] },
      {
        type: "paragraph",
        text: "{{metricName}}: {{metricValue}} ({{metricChange}})",
      },
      { type: "paragraph", text: "{{conclusion}}" },
    ],
  },
  {
    id: "docx.minutes",
    kind: "docx",
    nameKey: "templates.docxMinutes",
    descriptionKey: "templates.docxMinutesDesc",
    fileName: "{{title}}-{{date}}",
    vars: [
      short("title", "Kickoff minutes"),
      short("date", "2026-10-28"),
      short("location", "Room 3 / online"),
      long("decision", "Ship the smaller scope first."),
      short("task", "Draft the spec"),
      short("owner", "Wei"),
      short("due", "2026-11-04"),
    ],
    blocks: [
      { type: "heading", text: "{{title}}" },
      { type: "paragraph", text: "{{date}} · {{location}}" },
      { type: "bullets", items: ["{{decision}}"] },
      { type: "paragraph", text: "{{task}} — {{owner}} — {{due}}" },
    ],
  },
  {
    id: "xlsx.datasheet",
    kind: "xlsx",
    nameKey: "templates.xlsxSheet",
    descriptionKey: "templates.xlsxSheetDesc",
    fileName: "{{title}}",
    vars: [
      short("title", "Weekly numbers"),
      short("col1", "Week"),
      short("col2", "Signups"),
      short("col3", "Activation"),
      short("row1c1", "W42"),
      short("row1c2", "128"),
      short("row1c3", "41%"),
    ],
    blocks: [
      {
        type: "table",
        headers: ["{{col1}}", "{{col2}}", "{{col3}}"],
        rows: [["{{row1c1}}", "{{row1c2}}", "{{row1c3}}"]],
      },
    ],
  },
  {
    id: "pptx.deck",
    kind: "pptx",
    nameKey: "templates.pptxDeck",
    descriptionKey: "templates.pptxDeckDesc",
    fileName: "{{title}}",
    vars: [
      short("title", "One-page strategy"),
      short("audience", "Leadership"),
      short("problem", "Onboarding drops at step 3"),
      short("approach", "Collapse steps 3 and 4"),
      short("evidence", "8 of 12 users stalled there"),
      short("ask", "Two weeks of one engineer"),
    ],
    blocks: [
      { type: "heading", text: "{{title}}" },
      { type: "paragraph", text: "{{audience}}" },
      { type: "bullets", items: ["{{problem}}", "{{approach}}", "{{evidence}}"] },
      { type: "paragraph", text: "{{ask}}" },
    ],
  },
  {
    id: "pptx.review",
    kind: "pptx",
    nameKey: "templates.pptxReview",
    descriptionKey: "templates.pptxReviewDesc",
    fileName: "{{title}}-retro",
    vars: [
      short("title", "Launch retro"),
      short("kept", "Daily demos"),
      short("dropped", "Chasing every bug"),
      short("next", "Freeze scope on Tuesday"),
    ],
    blocks: [
      { type: "heading", text: "{{title}}" },
      { type: "bullets", items: ["{{kept}}", "{{dropped}}", "{{next}}"] },
    ],
  },
] as const;

export function findDocumentTemplate(
  id: string,
): DocumentTemplate | undefined {
  return DOCUMENT_TEMPLATES.find((template) => template.id === id);
}

export function templatesByKind(): Array<{
  kind: TemplateKind;
  templates: DocumentTemplate[];
}> {
  const kinds: TemplateKind[] = ["docx", "xlsx", "pptx"];
  return kinds.map((kind) => ({
    kind,
    templates: DOCUMENT_TEMPLATES.filter((template) => template.kind === kind),
  }));
}
