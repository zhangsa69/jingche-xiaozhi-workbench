import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

import {
  DEFAULT_PREVIEW_LIMITS,
  MAX_BLOCKS,
  MAX_INFLATED_BYTES,
  MAX_SLIDES,
  MAX_TABLE_CELLS,
  MAX_TABLE_ROWS,
  readDocumentPreview,
  readZipEntry,
} from "../electron/main/document-preview.ts";

/**
 * One stored or deflated ZIP, built by hand so the fixtures are real bytes and
 * the reader is exercised against both compression methods Office uses.
 */
function zip(files, { deflate = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    const nameBytes = Buffer.from(name, "utf8");
    const method = deflate ? 8 : 0;
    const body = deflate ? deflateRawSync(data) : data;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const count = Object.keys(files).length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function docx(body, options) {
  return zip(
    {
      "[Content_Types].xml": '<?xml version="1.0"?><Types/>',
      "word/document.xml": `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    },
    options,
  );
}

function paragraph(text, style) {
  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${properties}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}

const SHEET_NS =
  'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const WORKSHEET = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
const SLIDE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";

/** A workbook in the shape real Excel writes: shared strings, sheet rels. */
function xlsx({ sheets, sharedStrings, files = {} }) {
  const sheetEntries = sheets.map((sheet, index) => ({
    name: sheet.name,
    path: `xl/worksheets/sheet${index + 1}.xml`,
    xml: sheet.xml,
  }));
  return zip({
    "[Content_Types].xml": '<?xml version="1.0"?><Types/>',
    "xl/workbook.xml": `<?xml version="1.0"?><workbook ${SHEET_NS}><sheets>${sheetEntries
      .map(
        (entry, index) =>
          `<sheet name="${entry.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
      )
      .join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships ${REL_NS}>${sheetEntries
      .map(
        (entry, index) =>
          `<Relationship Id="rId${index + 1}" Type="${WORKSHEET}" Target="worksheets/sheet${
            index + 1
          }.xml"/>`,
      )
      .join("")}</Relationships>`,
    ...(sharedStrings === undefined ? {} : { "xl/sharedStrings.xml": sharedStrings }),
    ...Object.fromEntries(sheetEntries.map((entry) => [entry.path, entry.xml])),
    ...files,
  });
}

function sheetXml(rows) {
  return `<?xml version="1.0"?><worksheet ${SHEET_NS}><sheetData>${rows}</sheetData></worksheet>`;
}

function slide(title, bullets) {
  const titleShape =
    title === null
      ? ""
      : `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>`;
  const bodyShape = `<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody>${bullets
    .map((bullet) => `<a:p><a:pPr lvl="1"/><a:r><a:t>${bullet}</a:t></a:r></a:p>`)
    .join("")}</p:txBody></p:sp>`;
  return `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${titleShape}${bodyShape}</p:spTree></p:cSld></p:sld>`;
}

function pptx(slides) {
  return zip({
    "[Content_Types].xml": '<?xml version="1.0"?><Types/>',
    "ppt/presentation.xml": `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${slides
      .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`)
      .join("")}</p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<?xml version="1.0"?><Relationships ${REL_NS}>${slides
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="${SLIDE}" Target="slides/slide${
            index + 1
          }.xml"/>`,
      )
      .join("")}</Relationships>`,
    ...Object.fromEntries(
      slides.map((xml, index) => [`ppt/slides/slide${index + 1}.xml`, xml]),
    ),
  });
}

async function workspace() {
  return mkdtemp(join(tmpdir(), "pi-preview-"));
}

async function fixture(root, name, bytes) {
  const path = join(root, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return name;
}

async function preview(root, name, limits) {
  return readDocumentPreview({ path: name }, root, [], limits);
}

test("a stored docx yields headings, paragraphs and tables in order", async () => {
  const root = await workspace();
  const table = `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cost</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Widget</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>42</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
  const body = [
    paragraph("Quarterly report", "Heading1"),
    paragraph("Q1 &lt;Q2&gt; &amp; more"),
    // A content control around an ordinary paragraph is still that paragraph.
    `<w:sdt><w:sdtContent>${paragraph("In a form field")}</w:sdtContent></w:sdt>`,
    paragraph(""),
    table,
    `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Appendix</w:t></w:r></w:p>`,
  ].join("");
  await fixture(root, "report.docx", docx(body));

  const { preview: result, truncated } = await preview(root, "report.docx");

  assert.equal(result.kind, "docx");
  assert.equal(truncated, false);
  assert.deepEqual(result.blocks, [
    { kind: "heading", text: "Quarterly report" },
    { kind: "paragraph", text: "Q1 <Q2> & more" },
    { kind: "paragraph", text: "In a form field" },
    {
      kind: "table",
      rows: [
        ["Item", "Cost"],
        ["Widget", "42"],
      ],
    },
    { kind: "heading", text: "Appendix" },
  ]);
});

test("a deflated docx reads the same as a stored one", async () => {
  const root = await workspace();
  const body = `${paragraph("Compressed", "Heading2")}${paragraph("body text")}`;
  await fixture(root, "deflated.docx", docx(body, { deflate: true }));

  const { preview: result } = await preview(root, "deflated.docx");

  assert.equal(result.kind, "docx");
  assert.deepEqual(result.blocks, [
    { kind: "heading", text: "Compressed" },
    { kind: "paragraph", text: "body text" },
  ]);
});

test("a docx without word/document.xml is corrupt, not an error", async () => {
  const root = await workspace();
  await fixture(
    root,
    "broken.docx",
    zip({ "[Content_Types].xml": '<?xml version="1.0"?><Types/>' }),
  );

  assert.deepEqual(await preview(root, "broken.docx"), {
    preview: { kind: "unsupported", reason: "corrupt" },
    truncated: false,
  });
});

test("a docx that is not a zip at all is corrupt", async () => {
  const root = await workspace();
  await fixture(root, "plain.docx", Buffer.from("not a zip archive"));

  assert.deepEqual(await preview(root, "plain.docx"), {
    preview: { kind: "unsupported", reason: "corrupt" },
    truncated: false,
  });
});

test("shared strings, column letters and sheet order come out as Excel wrote them", async () => {
  const root = await workspace();
  await fixture(
    root,
    "costs.xlsx",
    xlsx({
      sheets: [
        {
          name: "Costs",
          xml: sheetXml(
            `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
              // B2 only: A2 must come back as an empty string, not a missing column.
              `<row r="2"><c r="B2" t="s"><v>2</v></c></row>` +
              `<row r="3"><c r="A3"><v>7</v></c><c r="C3" t="str"><v>=SUM(B2)</v></c></row>`,
          ),
        },
        { name: "Notes", xml: sheetXml(`<row r="1"><c r="A1" t="s"><v>3</v></c></row>`) },
      ],
      sharedStrings:
        '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Item</t></si><si><t>Cost</t></si><si><t>Widget</t></si><si><t>draft</t></si></sst>',
    }),
  );

  const { preview: result } = await preview(root, "costs.xlsx");

  assert.equal(result.kind, "xlsx");
  assert.deepEqual(
    result.sheets.map((sheet) => sheet.name),
    ["Costs", "Notes"],
  );
  assert.deepEqual(result.sheets[0].rows, [
    ["Item", "Cost", ""],
    ["", "Widget", ""],
    ["7", "", "=SUM(B2)"],
  ]);
  assert.deepEqual(result.sheets[1].rows, [["draft"]]);
});

test("inline strings and untyped values read without a shared string table", async () => {
  const root = await workspace();
  await fixture(
    root,
    "plugin.xlsx",
    xlsx({
      sheets: [
        {
          name: "Export",
          xml: sheetXml(
            `<row r="1"><c r="A1" t="inlineStr"><is><t>Order</t></is></c><c r="B1"><v>12</v></c></row>`,
          ),
        },
      ],
    }),
  );

  const { preview: result } = await preview(root, "plugin.xlsx");

  assert.equal(result.kind, "xlsx");
  assert.deepEqual(result.sheets, [{ name: "Export", rows: [["Order", "12"]] }]);
});

test("slides keep presentation order, with an empty title when there is none", async () => {
  const root = await workspace();
  await fixture(
    root,
    "deck.pptx",
    pptx([
      slide("Roadmap", ["Ship the preview", "Then the deck"]),
      slide(null, ["No title on this one"]),
    ]),
  );

  const { preview: result } = await preview(root, "deck.pptx");

  assert.equal(result.kind, "pptx");
  assert.deepEqual(result.slides, [
    { title: "Roadmap", bullets: ["Ship the preview", "Then the deck"] },
    { title: "", bullets: ["No title on this one"] },
  ]);
});

test("limits cut arrays at the bound and report truncation", async () => {
  const root = await workspace();
  await fixture(
    root,
    "long.pptx",
    pptx([slide("One", ["a"]), slide("Two", ["b"]), slide("Three", ["c"])]),
  );
  await fixture(
    root,
    "many.xlsx",
    xlsx({
      sheets: [
        {
          name: "Rows",
          xml: sheetXml(
            [1, 2, 3, 4, 5]
              .map((row) => `<row r="${row}"><c r="A${row}" t="inlineStr"><is><t>${row}</t></is></c></row>`)
              .join(""),
          ),
        },
      ],
    }),
  );
  await fixture(
    root,
    "blocks.docx",
    docx([paragraph("one"), paragraph("two"), paragraph("three")].join("")),
  );
  await fixture(
    root,
    "table.docx",
    docx(
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
    ),
  );
  await fixture(
    root,
    "costs.xlsx",
    xlsx({
      sheets: [
        { name: "One", xml: sheetXml(`<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row>`) },
        { name: "Two", xml: sheetXml(`<row r="1"><c r="A1" t="inlineStr"><is><t>y</t></is></c></row>`) },
      ],
    }),
  );

  const slides = await preview(root, "long.pptx", {
    ...DEFAULT_PREVIEW_LIMITS,
    maxSlides: 2,
  });
  assert.equal(slides.preview.slides.length, 2);
  assert.equal(slides.truncated, true);

  const rows = await preview(root, "many.xlsx", {
    ...DEFAULT_PREVIEW_LIMITS,
    maxSheetRows: 3,
  });
  assert.equal(rows.preview.sheets[0].rows.length, 3);
  assert.equal(rows.truncated, true);

  const blocks = await preview(root, "blocks.docx", {
    ...DEFAULT_PREVIEW_LIMITS,
    maxBlocks: 2,
  });
  assert.equal(blocks.preview.blocks.length, 2);
  assert.equal(blocks.truncated, true);

  const sheets = await preview(root, "costs.xlsx", {
    ...DEFAULT_PREVIEW_LIMITS,
    maxSheets: 1,
  });
  assert.equal(sheets.preview.sheets.length, 1);
  assert.equal(sheets.truncated, true);

  const table = await preview(root, "table.docx", {
    ...DEFAULT_PREVIEW_LIMITS,
    maxTableRows: 1,
  });
  assert.equal(table.preview.blocks[0].rows.length, 1);
  assert.equal(table.truncated, true);

  // The shipped defaults are the limits the spec names.
  assert.equal(DEFAULT_PREVIEW_LIMITS.maxSlides, MAX_SLIDES);
  assert.equal(DEFAULT_PREVIEW_LIMITS.maxBlocks, MAX_BLOCKS);
  assert.equal(DEFAULT_PREVIEW_LIMITS.maxTableRows, MAX_TABLE_ROWS);
  assert.equal(MAX_SLIDES, 200);
  assert.equal(MAX_BLOCKS, 2000);
  assert.equal(MAX_TABLE_ROWS, 200);
});

test("a long paragraph is cut at the block budget", async () => {
  const root = await workspace();
  await fixture(root, "long.docx", docx(paragraph("x".repeat(50))));

  const { preview: result, truncated } = await preview(root, "long.docx", {
    ...DEFAULT_PREVIEW_LIMITS,
    maxBlockChars: 10,
  });

  assert.equal(result.blocks[0].text.length, 10);
  assert.equal(truncated, true);
});

test("the cell budget is shared by every table and sheet", async () => {
  const root = await workspace();
  const row = (value) =>
    `<w:tr><w:tc><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc></w:tr>`;
  await fixture(root, "three-row.docx", docx(`<w:tbl>${row(1)}${row(2)}${row(3)}</w:tbl>`));
  await fixture(
    root,
    "two-by-two.xlsx",
    xlsx({
      sheets: [
        {
          name: "One",
          xml: sheetXml(
            `<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row><row r="2"><c r="A2"><v>3</v></c><c r="B2"><v>4</v></c></row>`,
          ),
        },
        {
          name: "Two",
          xml: sheetXml(`<row r="1"><c r="A1"><v>5</v></c></row>`),
        },
      ],
    }),
  );

  // Two cells buy exactly two rows of a one-column table: the third is dropped
  // whole rather than half-written, and the flag explains the missing tail.
  const table = await preview(root, "three-row.docx", {
    ...DEFAULT_PREVIEW_LIMITS,
    maxCells: 2,
  });
  assert.equal(table.preview.blocks[0].rows.length, 2);
  assert.deepEqual(table.preview.blocks[0].rows, [["1"], ["2"]]);
  assert.equal(table.truncated, true);

  const sheets = await preview(root, "two-by-two.xlsx", {
    ...DEFAULT_PREVIEW_LIMITS,
    maxCells: 3,
  });
  const kept = sheets.preview.sheets.flatMap((sheet) => sheet.rows).flat().filter(Boolean);
  assert.deepEqual(kept, ["1", "2", "3"]);
  assert.equal(sheets.truncated, true);
  // The second sheet is never parsed: no part is inflated for a result that
  // cannot be shown.
  assert.equal(sheets.preview.sheets.length, 1);

  assert.equal(DEFAULT_PREVIEW_LIMITS.maxCells, MAX_TABLE_CELLS);
  assert.equal(MAX_TABLE_CELLS, 50_000);
});

test("an entry claiming to expand past the ceiling is refused unexpanded", () => {
  const plain = Buffer.from("fits easily".repeat(100), "utf8");
  const payload = deflateRawSync(plain);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(plain.length, 22);
  const buffer = Buffer.concat([local, payload]);
  const entry = (size) => ({
    name: "word/document.xml",
    method: 8,
    compressedSize: payload.length,
    size,
    offset: 0,
  });

  // The same bytes: an honest claim inflates, an inflated one is refused.
  assert.deepEqual(readZipEntry(buffer, entry(plain.length)), plain);
  // The declared size is the bomb's lever — a few kilobytes of deflate claiming
  // to expand past the ceiling must be refused before anything is inflated.
  assert.equal(readZipEntry(buffer, entry(MAX_INFLATED_BYTES + 1)), null);
});

test("a path that leaves the workspace is refused, without echoing it", async () => {
  const root = await workspace();
  const outside = await workspace();
  await fixture(outside, "secret.docx", docx(paragraph("secret")));

  for (const requested of ["../escape.docx", join(outside, "secret.docx")]) {
    await assert.rejects(
      () => readDocumentPreview({ path: requested }, root, []),
      (error) => {
        assert.equal(error.errorCode, "PATH_OUTSIDE_WORKSPACE");
        assert.ok(!error.message.includes(outside), "the message must not name a path");
        return true;
      },
    );
  }
});

test("a missing file is NOT_FOUND, not a preview", async () => {
  const root = await workspace();

  await assert.rejects(
    () => readDocumentPreview({ path: "missing.docx" }, root, []),
    (error) => {
      assert.equal(error.errorCode, "NOT_FOUND");
      assert.ok(!error.message.includes(root));
      return true;
    },
  );
});

test("a non-Office extension is unsupported, so the panel falls back", async () => {
  const root = await workspace();
  await fixture(root, "notes.txt", Buffer.from("hello"));

  assert.deepEqual(await preview(root, "notes.txt"), {
    preview: { kind: "unsupported", reason: "extension" },
    truncated: false,
  });
});
