/**
 * Office — bundled first-party plugin (W-12).
 *
 * Three agent tools that turn plain arguments into real OOXML files in one
 * step: OfficeDoc (.docx), OfficeSheet (.xlsx), OfficeSlides (.pptx).
 *
 * The bytes are assembled in this process by the CommonJS builders in `lib/`
 * (pure Buffer work, no third-party packages), then handed to the host through
 * `pi.fs.writeBase64` so the manifest's `fs.write` scope and the host's write
 * audit both apply. Nothing here touches Node's `fs` directly: a plugin that
 * wrote behind the host's back would be outside the permission gateway.
 *
 * `lib/` is CommonJS while this entry is ESM, hence `createRequire`.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const TOOL_NAMES = ["OfficeDoc", "OfficeSheet", "OfficeSlides"];

function fail(toolName, message) {
  return { ok: false, isError: true, content: `${toolName}: ${message}` };
}

function messageOf(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() || "unknown error";
}

/** How a wrong value is described back to the model, e.g. "a string". */
function shapeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return `a ${typeof value}`;
}

/**
 * One scalar as text: strings pass through, numbers and booleans stringify, a
 * blank entry stays a blank line. Objects and arrays return `null` so the
 * caller can refuse them instead of writing "[object Object]" into a document.
 */
function textOf(entry) {
  if (entry === null || entry === undefined) return "";
  if (typeof entry === "string") return entry;
  if (typeof entry === "number" || typeof entry === "boolean") return String(entry);
  return null;
}

/**
 * Read an optional one-line text argument: `title`, `sheetName`.
 *
 * `lib/` keeps a heading only when it is literally a string (`typeof value ===
 * "string"`), so `title: 2026` would drop the heading and still report success
 * — the same silent loss the array checks exist to prevent. Scalars are
 * stringified here, matching how `paragraphs`/`bullets` entries are treated;
 * objects are refused rather than written as "[object Object]".
 */
function optionalTextArg(label, value) {
  if (value === null || value === undefined) return { text: "" };
  const text = textOf(value);
  if (text === null) {
    return { error: `\`${label}\` must be a string, got ${shapeOf(value)}.` };
  }
  return { text: text.trim() };
}

/**
 * Read the required `paragraphs` array.
 *
 * The builders in `lib/` are deliberately forgiving: a string where an array
 * belongs reads as "no paragraphs", so the file is written, the tool reports
 * success, and the model never learns its arguments were wrong. Refusing the
 * shape here turns that silent blank document into a message it can act on.
 */
function paragraphList(value) {
  if (!Array.isArray(value)) {
    return {
      error: `\`paragraphs\` must be an array of strings, one item per paragraph; got ${shapeOf(value)}.`,
    };
  }
  const paragraphs = [];
  for (const [index, entry] of value.entries()) {
    const text = textOf(entry);
    if (text === null) {
      return { error: `\`paragraphs[${index}]\` must be a string, got ${shapeOf(entry)}.` };
    }
    paragraphs.push(text);
  }
  return { paragraphs };
}

/** Read the required `rows` grid; a row that is not an array is a shape error. */
function rowGrid(value) {
  if (!Array.isArray(value)) {
    return {
      error: `\`rows\` must be an array of rows, each row an array of cells; got ${shapeOf(value)}.`,
    };
  }
  const rows = [];
  for (const [rowIndex, row] of value.entries()) {
    if (!Array.isArray(row)) {
      return {
        error: `\`rows[${rowIndex}]\` must be an array of cells, got ${shapeOf(row)}. Wrap that row's cells in an array.`,
      };
    }
    const cells = [];
    for (const [cellIndex, cell] of row.entries()) {
      const text = textOf(cell);
      if (text === null) {
        return {
          error: `\`rows[${rowIndex}][${cellIndex}]\` must be a string (numbers are fine), got ${shapeOf(cell)}.`,
        };
      }
      cells.push(text);
    }
    rows.push(cells);
  }
  return { rows };
}

/** Read the required `slides` array; one string per slide is the classic slip. */
function slideList(value) {
  if (!Array.isArray(value)) {
    return {
      error: `\`slides\` must be an array of \`{ title, bullets }\` objects; got ${shapeOf(value)}.`,
    };
  }
  const slides = [];
  for (const [index, slide] of value.entries()) {
    if (!slide || typeof slide !== "object" || Array.isArray(slide)) {
      return {
        error: `\`slides[${index}]\` must be an object like { "title": "Intro", "bullets": ["..."] }, got ${shapeOf(slide)}.`,
      };
    }
    if (slide.title === undefined || slide.title === null) {
      return {
        error: `\`slides[${index}].title\` is required; pass "" for a slide with no heading.`,
      };
    }
    const title = textOf(slide.title);
    if (title === null) {
      return { error: `\`slides[${index}].title\` must be a string, got ${shapeOf(slide.title)}.` };
    }
    if (slide.bullets !== undefined && slide.bullets !== null && !Array.isArray(slide.bullets)) {
      return {
        error: `\`slides[${index}].bullets\` must be an array of strings, got ${shapeOf(slide.bullets)}. A single line still goes in an array.`,
      };
    }
    const bullets = [];
    for (const [bulletIndex, entry] of (slide.bullets ?? []).entries()) {
      const text = textOf(entry);
      if (text === null) {
        return {
          error: `\`slides[${index}].bullets[${bulletIndex}]\` must be a string, got ${shapeOf(entry)}.`,
        };
      }
      bullets.push(text);
    }
    slides.push({ title, ...(bullets.length ? { bullets } : {}) });
  }
  return { slides };
}

/**
 * Validate `path` into the workspace-relative form the host expects.
 *
 * Refused up front — rather than letting the host refuse them — because the
 * model can fix these from the message: an absolute path has to become
 * relative, `..` has to go, and the extension has to match the tool.
 */
function checkPath(toolName, raw, extension) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    return {
      error: fail(toolName, `\`path\` is required, e.g. "reports/q3/summary${extension}".`),
    };
  }
  const slashed = value.replace(/\\/g, "/");
  if (slashed.startsWith("/") || /^[a-zA-Z]:/.test(slashed)) {
    return {
      error: fail(
        toolName,
        `"${value}" is an absolute path. Use a path relative to the workspace, e.g. "reports/q3/summary${extension}".`,
      ),
    };
  }
  const rel = slashed.replace(/^\.\//, "");
  if (rel.split("/").includes("..")) {
    return {
      error: fail(
        toolName,
        `"${value}" steps outside the workspace with "..". Use a path inside the open project.`,
      ),
    };
  }
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  if (!base || base === ".") {
    return { error: fail(toolName, `"${value}" does not name a file.`) };
  }
  if (!rel.toLowerCase().endsWith(extension)) {
    return {
      error: fail(
        toolName,
        `"${value}" must end in ${extension}; this tool only writes ${extension} files.`,
      ),
    };
  }
  return { path: rel };
}

/**
 * Load one builder from `lib/` on first use.
 *
 * Required lazily so a packaging slip in `lib/` reports itself as a tool error
 * instead of preventing the plugin — and its other two tools — from loading.
 */
function builder(file, exportName) {
  const loaded = require(`./lib/${file}`);
  const build = loaded?.[exportName];
  if (typeof build !== "function") {
    throw new Error(`lib/${file} does not export ${exportName}()`);
  }
  return build;
}

/**
 * Hand the finished bytes to the host. The host resolves the relative path
 * against the workspace, enforces `manifest.fs.write.scope`, and audits the
 * write; `path`/`bytes` come back so the caller (and the UI) can link the file.
 */
async function writeOutput(toolName, relPath, label, buffer) {
  if (!buffer || typeof buffer.length !== "number" || buffer.length === 0) {
    return fail(toolName, "the generator produced no bytes.");
  }
  const written = await pi.fs.writeBase64(relPath, buffer.toString("base64"));
  const bytes = typeof written?.bytes === "number" ? written.bytes : buffer.length;
  const path = typeof written?.path === "string" && written.path ? written.path : relPath;
  return { ok: true, content: `Wrote ${label} (${bytes} bytes) to ${path}.`, path, bytes };
}

const DOC_TOOL = {
  name: "OfficeDoc",
  description:
    "Generate a Word document (.docx) and write it into the workspace in one step. " +
    'Pass `path` (workspace-relative, ending in .docx), `paragraphs` (one string per paragraph, empty string for a blank line) and an optional `title` shown as the first heading. ' +
    "The file is built as minimal OOXML by this plugin — there is no editor round trip, so to change a document, regenerate it with different text. " +
    'Call ToolSearch for "office" or "docx" to load this tool. Use OfficeSheet for spreadsheets and OfficeSlides for decks.',
  risk: "medium",
  schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: 'Workspace-relative output path ending in .docx, e.g. "reports/q3/summary.docx".',
      },
      title: {
        type: "string",
        description: "Optional document title, written as the first heading paragraph.",
      },
      paragraphs: {
        type: "array",
        items: { type: "string" },
        description:
          "Body paragraphs in order, plain text. Each entry becomes one paragraph; an empty string is a blank line.",
      },
    },
    required: ["path", "paragraphs"],
  },
  execute: async (args) => {
    const target = checkPath("OfficeDoc", args?.path, ".docx");
    if (target.error) return target.error;
    const body = paragraphList(args?.paragraphs);
    if (body.error) return fail("OfficeDoc", body.error);
    const heading = optionalTextArg("title", args?.title);
    if (heading.error) return fail("OfficeDoc", heading.error);
    try {
      const buildDocx = builder("docx.js", "buildDocx");
      const buffer = buildDocx({
        title: heading.text,
        paragraphs: body.paragraphs,
      });
      return await writeOutput("OfficeDoc", target.path, "a Word document", buffer);
    } catch (error) {
      return fail("OfficeDoc", messageOf(error));
    }
  },
};

const SHEET_TOOL = {
  name: "OfficeSheet",
  description:
    "Generate an Excel workbook (.xlsx) and write it into the workspace in one step. " +
    'Pass `path` (workspace-relative, ending in .xlsx), `rows` (an array of rows, each row an array of cell values as strings — put the header row in first) and an optional `sheetName`. ' +
    "Cells are written as inline text, so numbers and dates keep the exact string you send. " +
    'Call ToolSearch for "office" or "xlsx" to load this tool. Use OfficeDoc for documents and OfficeSlides for decks.',
  risk: "medium",
  schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: 'Workspace-relative output path ending in .xlsx, e.g. "reports/q3/numbers.xlsx".',
      },
      sheetName: {
        type: "string",
        description: 'Optional worksheet name; defaults to "Sheet1".',
      },
      rows: {
        type: "array",
        items: { type: "array", items: { type: "string" } },
        description:
          'Rows top to bottom, each an array of cell values. A header row such as ["Month", "Revenue"] is just the first row.',
      },
    },
    required: ["path", "rows"],
  },
  execute: async (args) => {
    const target = checkPath("OfficeSheet", args?.path, ".xlsx");
    if (target.error) return target.error;
    const grid = rowGrid(args?.rows);
    if (grid.error) return fail("OfficeSheet", grid.error);
    const sheet = optionalTextArg("sheetName", args?.sheetName);
    if (sheet.error) return fail("OfficeSheet", sheet.error);
    try {
      const buildXlsx = builder("xlsx.js", "buildXlsx");
      const buffer = buildXlsx({
        sheetName: sheet.text || "Sheet1",
        rows: grid.rows,
      });
      return await writeOutput("OfficeSheet", target.path, "an Excel workbook", buffer);
    } catch (error) {
      return fail("OfficeSheet", messageOf(error));
    }
  },
};

const SLIDES_TOOL = {
  name: "OfficeSlides",
  description:
    "Generate a PowerPoint deck (.pptx) and write it into the workspace in one step. " +
    'Pass `path` (workspace-relative, ending in .pptx), `slides` (each `{ title, bullets }`, bullets optional) and an optional deck `title`. ' +
    "Layout is title plus bullets — one line of text per bullet; keep bullets short because the deck is plain, not styled. " +
    "An empty `slides` array is not an error: the deck then opens on a single slide holding only `title`, which is how you make a cover-only deck. " +
    'Call ToolSearch for "office" or "pptx" to load this tool. Use OfficeDoc for documents and OfficeSheet for spreadsheets.',
  risk: "medium",
  schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: 'Workspace-relative output path ending in .pptx, e.g. "decks/q3-review.pptx".',
      },
      title: {
        type: "string",
        description: "Optional deck title, shown on the opening slide.",
      },
      slides: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Slide title." },
            bullets: {
              type: "array",
              items: { type: "string" },
              description: "Bullet lines, in order. Omit for a title-only slide.",
            },
          },
          required: ["title"],
        },
        description:
          "Slides in presentation order. An empty array still produces a valid one-slide deck containing only the deck `title`.",
      },
    },
    required: ["path", "slides"],
  },
  execute: async (args) => {
    const target = checkPath("OfficeSlides", args?.path, ".pptx");
    if (target.error) return target.error;
    const deck = slideList(args?.slides);
    if (deck.error) return fail("OfficeSlides", deck.error);
    const heading = optionalTextArg("title", args?.title);
    if (heading.error) return fail("OfficeSlides", heading.error);
    try {
      const buildPptx = builder("pptx.js", "buildPptx");
      const buffer = buildPptx({ title: heading.text, slides: deck.slides });
      return await writeOutput("OfficeSlides", target.path, "a PowerPoint deck", buffer);
    } catch (error) {
      return fail("OfficeSlides", messageOf(error));
    }
  },
};

const TOOLS = [DOC_TOOL, SHEET_TOOL, SLIDES_TOOL];

export async function onLoad() {
  for (const tool of TOOLS) {
    await pi.agent.registerTool(tool);
  }
}

export async function onUnload() {
  for (const name of TOOL_NAMES) {
    await pi.agent.unregisterTool(name);
  }
}
