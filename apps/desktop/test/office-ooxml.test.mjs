import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, posix, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

/**
 * Office OOXML generators (pi.office).
 *
 * Everything asserted here is asserted against real bytes: the archive is
 * re-read by an independent reader (not the writer's own code) and every part is
 * parsed for XML well-formedness. This does not prove Word opens the result —
 * only that the package and its XML have the structure Word requires.
 */

const require = createRequire(import.meta.url);
const LIB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../resources/plugins/pi.office/lib");

const { buildZip } = require(resolve(LIB_DIR, "zip.js"));
const { buildDocx } = require(resolve(LIB_DIR, "docx.js"));
const { buildXlsx } = require(resolve(LIB_DIR, "xlsx.js"));
const { buildPptx } = require(resolve(LIB_DIR, "pptx.js"));

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/**
 * Sequential local-header reader written against the spec rather than shared
 * with zip.js: if writer and reader agreed only because they were the same code,
 * a broken header layout would still pass. CRC-32 is checked with node:zlib,
 * which is an authority independent of the writer's table.
 */
function readZip(bytes) {
  assert.ok(Buffer.isBuffer(bytes), "buildZip must return a Buffer");
  assert.ok(bytes.length >= 22, "a zip is at least the 22-byte EOCD");

  const eocdOffset = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(eocdOffset), SIG_EOCD, "archive must end with an EOCD record");
  const count = bytes.readUInt16LE(eocdOffset + 10);
  assert.equal(bytes.readUInt16LE(eocdOffset + 8), count, "single-disk archive counts match");
  const centralSize = bytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  assert.equal(centralOffset + centralSize, eocdOffset, "central directory sits directly before the EOCD");

  const entries = [];
  let offset = 0;
  for (let i = 0; i < count; i += 1) {
    assert.equal(bytes.readUInt32LE(offset), SIG_LOCAL, `local header signature at entry ${i}`);
    const versionNeeded = bytes.readUInt16LE(offset + 4);
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const checksum = bytes.readUInt32LE(offset + 14);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const size = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);

    const nameStart = offset + 30;
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    assert.ok(dataEnd <= centralOffset, `entry "${name}" must not overrun the central directory`);
    const data = bytes.subarray(dataStart, dataEnd);

    entries.push({ name, data, method, flags, versionNeeded, crc: checksum, size, compressedSize, localOffset: offset });
    offset = dataEnd;
  }
  assert.equal(offset, centralOffset, "local headers must span exactly up to the central directory");

  const central = [];
  let cursor = centralOffset;
  for (let i = 0; i < count; i += 1) {
    assert.equal(bytes.readUInt32LE(cursor), SIG_CENTRAL, `central header signature at entry ${i}`);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const nameStart = cursor + 46;
    central.push({
      name: bytes.subarray(nameStart, nameStart + nameLength).toString("utf8"),
      method: bytes.readUInt16LE(cursor + 10),
      crc: bytes.readUInt32LE(cursor + 16),
      compressedSize: bytes.readUInt32LE(cursor + 20),
      localOffset: bytes.readUInt32LE(cursor + 42),
    });
    cursor = nameStart + nameLength + extraLength + commentLength;
  }
  assert.equal(cursor, eocdOffset, "central directory must end where the EOCD begins");

  // Both views of the archive must describe the same files, otherwise an
  // extractor trusting the central directory reads different bytes than one
  // walking local headers.
  assert.deepEqual(
    central.map((entry) => entry.name),
    entries.map((entry) => entry.name),
    "central and local entry order must match",
  );
  central.forEach((entry, index) => {
    assert.equal(entry.localOffset, entries[index].localOffset, `central offset for "${entry.name}"`);
    assert.equal(entry.method, entries[index].method, `method for "${entry.name}"`);
    assert.equal(entry.crc, entries[index].crc, `crc for "${entry.name}"`);
    assert.equal(entry.compressedSize, entries[index].compressedSize, `size for "${entry.name}"`);
  });

  const names = entries.map((entry) => entry.name);
  return {
    names,
    entries,
    get(name) {
      const found = entries.find((entry) => entry.name === name);
      assert.ok(found, `expected part "${name}", archive holds ${JSON.stringify(names)}`);
      return found;
    },
    text(name) {
      return this.get(name).data.toString("utf8");
    },
  };
}

/** Tag-balance check: catches a mismatched or unclosed element in any part. */
function assertWellFormed(xml, label) {
  assert.ok(xml.startsWith(XML_DECL), `${label} must start with the UTF-8 XML declaration`);
  const stack = [];
  const tagPattern = /<(\/?)([A-Za-z_][\w:.-]*)([^<>]*?)(\/?)>/g;
  let match = tagPattern.exec(xml);
  while (match !== null) {
    const [, closing, name, , selfClosing] = match;
    if (closing === "/") {
      assert.equal(stack.pop(), name, `${label}: closing </${name}> does not match the open element`);
    } else if (selfClosing !== "/") {
      stack.push(name);
    }
    match = tagPattern.exec(xml);
  }
  assert.deepEqual(stack, [], `${label}: unclosed elements remain`);
  const rawAmpersand = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.exec(xml);
  assert.equal(rawAmpersand, null, `${label}: unescaped ampersand at index ${rawAmpersand?.index}`);
}

/** Every `.rels` target has to name a part that exists in the same package. */
function assertRelationshipsResolve(zip) {
  const relsParts = zip.names.filter((name) => name.endsWith(".rels"));
  assert.ok(relsParts.length > 0, "package must declare relationships");
  for (const name of relsParts) {
    const rels = zip.text(name);
    assertWellFormed(rels, name);
    const baseDirectory = name.includes("/_rels/") ? name.slice(0, name.indexOf("/_rels/")) : "";
    const targets = [...rels.matchAll(/Target="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(targets.length > 0, `${name} must declare at least one relationship`);
    for (const target of targets) {
      assert.ok(!target.startsWith("/"), `${name}: Target "${target}" must be relative`);
      const resolvedPart = posix.normalize(posix.join(baseDirectory, target)).replace(/^\.\//, "");
      assert.ok(
        zip.names.includes(resolvedPart),
        `${name}: Target "${target}" resolves to "${resolvedPart}", which is not in the package`,
      );
    }
  }
}

function assertStoredWithValidCrc(zip) {
  for (const entry of zip.entries) {
    // `store` is not a preference: Office accepts it and the plugin cannot rely
    // on a compressor being present.
    assert.equal(entry.method, 0, `${entry.name} must be stored`);
    assert.equal(entry.compressedSize, entry.size, `${entry.name} stores the payload verbatim`);
    assert.equal(entry.crc, crc32(entry.data), `${entry.name} CRC-32 must match the payload`);
    assertWellFormed(entry.data.toString("utf8"), entry.name);
  }
}

// ----------------------------------------------------------------------- zip

test("buildZip writes a store-only archive an extractor can walk", () => {
  const entries = [
    { name: "a.txt", data: Buffer.from("hello", "utf8") },
    { name: "nested/b.bin", data: new Uint8Array([0, 1, 2, 250]) },
    { name: "文档/说明.xml", data: Buffer.from("<x/>", "utf8") },
  ];
  const zip = readZip(buildZip(entries));

  assert.deepEqual(zip.names, ["a.txt", "nested/b.bin", "文档/说明.xml"]);
  for (const entry of zip.entries) {
    assert.equal(entry.versionNeeded, 20, `${entry.name} needs zip 2.0 (store)`);
    assert.equal(entry.crc, crc32(entry.data), `${entry.name} CRC-32`);
  }
  // Non-ASCII names must carry the UTF-8 flag, otherwise Windows extractors read
  // them as CP437; ASCII-only names stay flag-free for stable bytes.
  assert.equal(zip.get("文档/说明.xml").flags & 0x0800, 0x0800);
  assert.equal(zip.get("a.txt").flags & 0x0800, 0);
  assert.equal(zip.text("a.txt"), "hello");
  assert.deepEqual([...zip.get("nested/b.bin").data], [0, 1, 2, 250]);
});

test("buildZip rejects names that escape the archive root", () => {
  for (const name of ["../x", "/abs", "a/../b", "./a", "a//b", "a\\b"]) {
    assert.throws(() => buildZip([{ name, data: Buffer.alloc(0) }]), /zip entry name/, `"${name}" must be refused`);
  }
  assert.throws(() => buildZip([{ name: "", data: Buffer.alloc(0) }]), TypeError);
  assert.throws(
    () =>
      buildZip([
        { name: "same.txt", data: Buffer.from("1") },
        { name: "same.txt", data: Buffer.from("2") },
      ]),
    /duplicate zip entry/,
  );
  assert.throws(() => buildZip([{ name: "x", data: "not bytes" }]), TypeError);
});

test("buildZip of no entries is a bare, valid EOCD", () => {
  const bytes = buildZip([]);
  assert.equal(bytes.length, 22);
  assert.deepEqual(readZip(bytes).names, []);
  assert.equal(bytes.readUInt16LE(8), 0);
  assert.equal(bytes.readUInt32LE(12), 0);
  assert.equal(bytes.readUInt32LE(16), 0);
});

test("buildZip is byte-reproducible", () => {
  const build = () => buildZip([{ name: "x.xml", data: Buffer.from("<x>1</x>", "utf8") }]);
  // A fixed DOS timestamp is what makes two exports diff cleanly.
  assert.deepEqual(build(), build());
});

// ---------------------------------------------------------------------- docx

const DOCX_PARTS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "word/document.xml",
  "word/_rels/document.xml.rels",
  "word/styles.xml",
  "docProps/core.xml",
  "docProps/app.xml",
];

test("buildDocx produces a package with every part Word resolves", () => {
  const zip = readZip(
    buildDocx({ title: "Quarterly Report", paragraphs: ["First paragraph", "", "Third paragraph"] }),
  );

  for (const part of DOCX_PARTS) {
    assert.ok(zip.names.includes(part), `docx must contain ${part}`);
  }
  assertStoredWithValidCrc(zip);
  assertRelationshipsResolve(zip);

  const contentTypes = zip.text("[Content_Types].xml");
  assert.match(
    contentTypes,
    /ContentType="application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\.main\+xml"/,
  );
  assert.match(contentTypes, /PartName="\/word\/document\.xml"/);

  const document = zip.text("word/document.xml");
  assert.match(document, /<w:pStyle w:val="Title"\/>/);
  assert.match(document, /Quarterly Report/);
  assert.match(document, /First paragraph/);
  assert.match(document, /Third paragraph/);
  // An empty input string must survive as an empty paragraph, not as one holding
  // a single space.
  assert.match(document, /<w:p\/>/);
  // One paragraph per input line plus the title.
  assert.equal(document.match(/<w:p>/g).length + document.match(/<w:p\/>/g).length, 4);
  assert.match(document, /<w:sectPr>/);

  // The referenced Title style has to exist, or Word renders plain text.
  assert.match(zip.text("word/styles.xml"), /w:styleId="Title"/);
  assert.match(zip.text("word/_rels/document.xml.rels"), /Target="styles\.xml"/);
});

test("buildDocx escapes markup and strips characters XML cannot carry", () => {
  const zip = readZip(
    buildDocx({
      title: "A & B < C",
      paragraphs: ['x & y < z > w "quoted" \'single\'', "bell\u0007char\u0000nul"],
    }),
  );
  const document = zip.text("word/document.xml");

  assert.match(document, /A &amp; B &lt; C/);
  assert.match(document, /x &amp; y &lt; z &gt; w &quot;quoted&quot; &apos;single&apos;/);
  // A raw control byte makes Office reject the file outright, so it has to be
  // gone from the bytes on disk.
  assert.doesNotMatch(document, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  assert.match(document, /bellcharnul/);
  assertWellFormed(document, "word/document.xml");
  assert.match(zip.text("docProps/core.xml"), /<dc:title>A &amp; B &lt; C<\/dc:title>/);
});

test("buildDocx accepts an empty title and no paragraphs", () => {
  const document = readZip(buildDocx({ title: "", paragraphs: [] })).text("word/document.xml");
  assert.doesNotMatch(document, /w:pStyle/);
  assert.match(document, /<w:sectPr>/);
  assertWellFormed(document, "word/document.xml");
});

// ---------------------------------------------------------------------- xlsx

const XLSX_PARTS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "xl/worksheets/sheet1.xml",
  "xl/styles.xml",
  "docProps/core.xml",
  "docProps/app.xml",
];

test("buildXlsx produces a package with every part Excel resolves", () => {
  const zip = readZip(
    buildXlsx({
      sheetName: "Sales",
      rows: [
        ["Region", "Units", "Total"],
        ["North", "12", "340.50"],
        ["South & East", "0", ""],
      ],
    }),
  );

  for (const part of XLSX_PARTS) {
    assert.ok(zip.names.includes(part), `xlsx must contain ${part}`);
  }
  assertStoredWithValidCrc(zip);
  assertRelationshipsResolve(zip);

  assert.match(zip.text("xl/workbook.xml"), /<sheet name="Sales" sheetId="1" r:id="rId1"\/>/);
  assert.match(zip.text("xl/_rels/workbook.xml.rels"), /Target="worksheets\/sheet1\.xml"/);
  assert.match(
    zip.text("[Content_Types].xml"),
    /ContentType="application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet\.main\+xml"/,
  );

  const sheet = zip.text("xl/worksheets/sheet1.xml");
  assert.match(sheet, /<dimension ref="A1:C3"\/>/);

  const cells = [...sheet.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>(.*?)<\/c>/g)].map((match) => ({
    ref: match[1],
    attributes: match[2],
    inner: match[3],
  }));
  assert.equal(cells.length, 9, "every input cell must be written");
  assert.deepEqual(cells.map((cell) => cell.ref), ["A1", "B1", "C1", "A2", "B2", "C2", "A3", "B3", "C3"]);
  for (const cell of cells) {
    // Inline strings keep the exact text the caller wrote, with no shared-string
    // table to get wrong.
    assert.match(cell.attributes, /t="inlineStr"/, `${cell.ref} must be an inline string`);
    assert.match(cell.inner, /^<is><t[^>]*>/, `${cell.ref} must hold an <is><t> payload`);
  }
  // Row 1 is the header, so it carries the bold style; body rows do not.
  assert.match(cells[0].attributes, /s="1"/);
  assert.doesNotMatch(cells[3].attributes, /s="1"/);
  assert.match(sheet, />Region</);
  assert.match(sheet, />South &amp; East</);
  assert.match(sheet, />340\.50</);
});

test("buildXlsx sanitizes a sheet name Excel would reject", () => {
  const illegal = readZip(buildXlsx({ sheetName: "a/b:c*?", rows: [] }));
  assert.match(illegal.text("xl/workbook.xml"), /<sheet name="a b c"/);

  const truncated = readZip(buildXlsx({ sheetName: "x".repeat(40), rows: [] }));
  assert.match(truncated.text("xl/workbook.xml"), new RegExp(`<sheet name="${"x".repeat(31)}"`));

  // No name at all still has to name the sheet.
  const fallback = readZip(buildXlsx({ sheetName: "", rows: [[""]] }));
  assert.match(fallback.text("xl/workbook.xml"), /<sheet name="Sheet1"/);
  assert.match(fallback.text("xl/worksheets/sheet1.xml"), /<c r="A1" t="inlineStr" s="1"><is><t[^>]*><\/t><\/is><\/c>/);
});

test("buildXlsx handles an empty row set", () => {
  const sheet = readZip(buildXlsx({ sheetName: "Empty", rows: [] })).text("xl/worksheets/sheet1.xml");
  assert.match(sheet, /<dimension ref="A1"\/>/);
  assert.doesNotMatch(sheet, /<c /);
  assertWellFormed(sheet, "xl/worksheets/sheet1.xml");
});

// ---------------------------------------------------------------------- pptx

function pptxParts(slideCount) {
  const parts = [
    "[Content_Types].xml",
    "_rels/.rels",
    "ppt/presentation.xml",
    "ppt/_rels/presentation.xml.rels",
    "ppt/slideMasters/slideMaster1.xml",
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    "ppt/slideLayouts/slideLayout1.xml",
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    "ppt/theme/theme1.xml",
    "docProps/core.xml",
    "docProps/app.xml",
  ];
  for (let index = 1; index <= slideCount; index += 1) {
    parts.push(`ppt/slides/slide${index}.xml`);
    parts.push(`ppt/slides/_rels/slide${index}.xml.rels`);
  }
  return parts;
}

test("buildPptx produces the full slide-master-layout-theme chain", () => {
  const zip = readZip(
    buildPptx({
      title: "Roadmap",
      slides: [
        { title: "Roadmap", bullets: ["Ship Q1", "Ship Q2"] },
        { title: "Risks & Mitigations", bullets: ["Scope creep"] },
        { title: "No bullets" },
      ],
    }),
  );

  for (const part of pptxParts(3)) {
    assert.ok(zip.names.includes(part), `pptx must contain ${part}`);
  }
  assertStoredWithValidCrc(zip);
  // Every relationship target must exist: one dangling slide -> layout link is
  // exactly what makes PowerPoint show a repair prompt instead of a deck.
  assertRelationshipsResolve(zip);

  const presentation = zip.text("ppt/presentation.xml");
  assert.match(presentation, /<p:sldMasterId id="2147483648" r:id="rId1"\/>/);
  const slideIds = [...presentation.matchAll(/<p:sldId id="(\d+)" r:id="(rId\d+)"\/>/g)];
  assert.deepEqual(
    slideIds.map((match) => [match[1], match[2]]),
    [
      ["256", "rId2"],
      ["257", "rId3"],
      ["258", "rId4"],
    ],
    "one sldId per slide, unique and ascending",
  );
  assert.match(zip.text("ppt/_rels/presentation.xml.rels"), /Target="slides\/slide3\.xml"/);
  assert.match(
    zip.text("[Content_Types].xml"),
    /ContentType="application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation\.main\+xml"/,
  );
  assert.match(zip.text("[Content_Types].xml"), /PartName="\/ppt\/slides\/slide3\.xml"/);

  // A theme with a short format list is rejected by PowerPoint, so the counts
  // are part of the contract.
  const theme = zip.text("ppt/theme/theme1.xml");
  // 3 fill styles + 3 background fill styles + the 3 line styles' own fills.
  assert.equal(theme.match(/<a:solidFill>/g)?.length, 9, "every format list carries three entries");
  assert.equal(theme.match(/<a:ln w=/g)?.length, 3, "3 line styles");
  assert.equal(theme.match(/<a:effectStyle>/g)?.length, 3, "3 effect styles");
  assert.match(theme, /<a:clrScheme name="Office">/);

  // The master points at the layout and the theme it needs.
  const masterRels = zip.text("ppt/slideMasters/_rels/slideMaster1.xml.rels");
  assert.match(masterRels, /Target="\.\.\/slideLayouts\/slideLayout1\.xml"/);
  assert.match(masterRels, /Target="\.\.\/theme\/theme1\.xml"/);
  assert.match(zip.text("ppt/slideLayouts/_rels/slideLayout1.xml.rels"), /slideMaster1\.xml"/);
});

test("buildPptx writes each slide's title and bullets", () => {
  const zip = readZip(
    buildPptx({
      title: "Roadmap",
      slides: [
        { title: "Roadmap", bullets: ["Ship Q1", "Ship Q2"] },
        { title: "Risks & Mitigations", bullets: ["Scope creep"] },
        { title: "No bullets" },
      ],
    }),
  );

  const first = zip.text("ppt/slides/slide1.xml");
  assert.match(first, /<p:ph type="title"\/>/);
  assert.match(first, /<p:ph idx="1"\/>/);
  assert.match(first, />Roadmap<\/a:t>/);
  assert.match(first, />Ship Q1<\/a:t>/);
  assert.match(first, />Ship Q2<\/a:t>/);
  // Two bullets means two bullet paragraphs, each carrying its own buChar: the
  // list style is not inherited from a master this writer does not ship.
  assert.equal(first.match(/<a:buChar char="&#8226;"\/>/g)?.length, 2);

  const second = zip.text("ppt/slides/slide2.xml");
  assert.match(second, />Risks &amp; Mitigations<\/a:t>/);
  assert.match(second, />Scope creep<\/a:t>/);
  assert.doesNotMatch(second, /Risks & Mitigations/);

  // A slide with no bullets still needs one legal paragraph in its body.
  const third = zip.text("ppt/slides/slide3.xml");
  assert.match(third, />No bullets<\/a:t>/);
  assert.equal(third.match(/<a:buChar/g), null);
  assert.match(third, /<a:endParaRPr lang="en-US"\/>/);

  for (const name of ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml"]) {
    assert.match(zip.text(name), /<a:masterClrMapping\/>/);
    assert.equal(zip.text(name).match(/<p:sp>/g)?.length, 2, `${name} has a title and a body shape`);
  }
});

test("buildPptx keeps an empty deck openable with one title-only slide", () => {
  // A presentation part with an empty sldIdLst is a damaged file, so an empty
  // slide list is widened to the deck title rather than failing the caller. The
  // fallback slide is a cover page, not a blank one: `title` lands on it, which
  // is the difference a user sees when they pass `slides: []`.
  const zip = readZip(buildPptx({ title: "Empty deck", slides: [] }));
  assert.equal(zip.text("ppt/presentation.xml").match(/<p:sldId /g)?.length, 1);
  assert.ok(zip.names.includes("ppt/slides/slide1.xml"));
  assert.match(zip.text("docProps/app.xml"), /<Slides>1<\/Slides>/);
  assert.match(zip.text("ppt/slides/slide1.xml"), />Empty deck<\/a:t>/);
  assertWellFormed(zip.text("ppt/slides/slide1.xml"), "ppt/slides/slide1.xml");

  // Only an empty title leaves the fallback page genuinely blank.
  const untitled = readZip(buildPptx({ slides: [] }));
  assert.doesNotMatch(untitled.text("ppt/slides/slide1.xml"), /<a:t>/);
});

test("all three formats survive text that would otherwise break the XML", () => {
  const nasty = 'A & B < C > D "E" \'F\' \u0001\u0008 中文字';
  const docxText = readZip(buildDocx({ title: nasty, paragraphs: [nasty] })).text("word/document.xml");
  const xlsxSheet = readZip(buildXlsx({ sheetName: nasty, rows: [[nasty]] })).text("xl/worksheets/sheet1.xml");
  const xlsxWorkbook = readZip(buildXlsx({ sheetName: nasty, rows: [] })).text("xl/workbook.xml");
  const pptxSlide = readZip(buildPptx({ title: nasty, slides: [{ title: nasty, bullets: [nasty] }] })).text(
    "ppt/slides/slide1.xml",
  );

  for (const [label, xml] of [
    ["docx/document", docxText],
    ["xlsx/sheet", xlsxSheet],
    ["xlsx/workbook", xlsxWorkbook],
    ["pptx/slide", pptxSlide],
  ]) {
    assertWellFormed(xml, label);
    assert.match(xml, /中文字/, `${label} must keep non-ASCII text`);
  }
  // The sheet-name character filter runs before escaping, so the illegal `:` is
  // gone and the text itself is otherwise intact.
  assert.match(xlsxWorkbook, /<sheet name="A &amp; B &lt; C &gt; D &quot;E&quot; &apos;F&apos; {2}中文字"/);
});
