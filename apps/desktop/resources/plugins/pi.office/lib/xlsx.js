"use strict";

/**
 * Minimal SpreadsheetML (.xlsx) generator.
 *
 * One worksheet, string cells only. Text is written as inline strings
 * (`t="inlineStr"`) rather than through a shared-string table: shared strings
 * would need a second part plus a relationship and dedupe bookkeeping, and the
 * only thing they buy — smaller files — does not matter for a few dozen cells.
 */

const { buildZip } = require("./zip.js");

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const NS_S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const NS_CP = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const NS_DC = "http://purl.org/dc/elements/1.1/";
const NS_DCTERMS = "http://purl.org/dc/terms/";
const NS_XSI = "http://www.w3.org/2001/XMLSchema-instance";
const NS_EP = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";

// Excel refuses to open a sheet whose XML is malformed, so escaping and control
// character stripping happen here rather than at each call site.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const LONE_SURROGATES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function text(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(CONTROL_CHARS, "")
    .replace(LONE_SURROGATES, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Excel rejects these characters in a sheet name and silently truncates names
// past 31 characters, so both are fixed before the name reaches workbook.xml.
const INVALID_SHEET_CHARS = /[\\/?*[\]:]/g;
const MAX_SHEET_NAME = 31;

function sheetNameOf(value) {
  const raw = typeof value === "string" ? value : "";
  const cleaned = raw.replace(INVALID_SHEET_CHARS, " ").trim().slice(0, MAX_SHEET_NAME).trim();
  return cleaned === "" ? "Sheet1" : cleaned;
}

/** A1-style column letters, needed because row length is unbounded. */
function columnName(index) {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function normaliseRows(rows) {
  const input = Array.isArray(rows) ? rows : [];
  return input.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []));
}

function contentTypesXml() {
  return (
    `${XML_DECL}<Types xmlns="${NS_CT}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    "</Types>"
  );
}

function rootRelsXml() {
  return (
    `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/>` +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    `<Relationship Id="rId3" Type="${NS_R}/extended-properties" Target="docProps/app.xml"/>` +
    "</Relationships>"
  );
}

function workbookXml(sheetName) {
  return (
    `${XML_DECL}<workbook xmlns="${NS_S}" xmlns:r="${NS_R}">` +
    "<bookViews><workbookView/></bookViews>" +
    `<sheets><sheet name="${text(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
    "</workbook>"
  );
}

function workbookRelsXml() {
  return (
    `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_R}/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="${NS_R}/styles" Target="styles.xml"/>` +
    "</Relationships>"
  );
}

/**
 * Style table with exactly two cell formats: 0 = normal, 1 = bold.
 *
 * The two fills are not decorative — the schema requires `fillId 0` to be a
 * `none` pattern and `fillId 1` to be `gray125`, and Excel treats a workbook
 * missing either as damaged.
 */
function stylesXml() {
  return (
    `${XML_DECL}<styleSheet xmlns="${NS_S}">` +
    '<fonts count="2">' +
    '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>' +
    "</fonts>" +
    '<fills count="2">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    "</fills>" +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    "</cellXfs>" +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>"
  );
}

function cellXml(reference, value, bold) {
  const style = bold ? ' s="1"' : "";
  // `xml:space="preserve"` keeps leading/trailing spaces, which Excel would
  // otherwise strip on load.
  return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${text(value)}</t></is></c>`;
}

function worksheetXml(rows) {
  const rowXml = [];
  let widest = 0;

  rows.forEach((cells, rowIndex) => {
    widest = Math.max(widest, cells.length);
    // Row 1 is the header by contract, so it gets the bold style id.
    const bold = rowIndex === 0;
    const cellsXml = cells
      .map((value, columnIndex) => cellXml(`${columnName(columnIndex)}${rowIndex + 1}`, value, bold))
      .join("");
    rowXml.push(`<row r="${rowIndex + 1}">${cellsXml}</row>`);
  });

  const dimension =
    rows.length === 0 || widest === 0
      ? '<dimension ref="A1"/>'
      : `<dimension ref="A1:${columnName(widest - 1)}${rows.length}"/>`;

  return (
    `${XML_DECL}<worksheet xmlns="${NS_S}" xmlns:r="${NS_R}">` +
    dimension +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<sheetData>${rowXml.join("")}</sheetData>` +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    "</worksheet>"
  );
}

function coreXml(sheetName) {
  // Fixed timestamps keep the package byte-reproducible.
  const created = "2020-01-01T00:00:00Z";
  return (
    `${XML_DECL}<cp:coreProperties xmlns:cp="${NS_CP}" xmlns:dc="${NS_DC}" ` +
    `xmlns:dcterms="${NS_DCTERMS}" xmlns:xsi="${NS_XSI}">` +
    `<dc:title>${text(sheetName)}</dc:title>` +
    "<dc:creator>PI Desktop</dc:creator>" +
    "<cp:lastModifiedBy>PI Desktop</cp:lastModifiedBy>" +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>` +
    "</cp:coreProperties>"
  );
}

function appXml(sheetName) {
  return (
    `${XML_DECL}<Properties xmlns="${NS_EP}" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    "<Application>PI Desktop</Application><DocSecurity>0</DocSecurity>" +
    "<ScaleCrop>false</ScaleCrop>" +
    '<HeadingPairs><vt:vector size="2" baseType="variant">' +
    "<vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>" +
    "<vt:variant><vt:i4>1</vt:i4></vt:variant>" +
    "</vt:vector></HeadingPairs>" +
    '<TitlesOfParts><vt:vector size="1" baseType="lpstr">' +
    `<vt:lpstr>${text(sheetName)}</vt:lpstr>` +
    "</vt:vector></TitlesOfParts>" +
    "<Company></Company><LinksUpToDate>false</LinksUpToDate>" +
    "<SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged>" +
    "<AppVersion>16.0300</AppVersion></Properties>"
  );
}

/**
 * Build a .xlsx package.
 *
 * `rows` is a rectangular-ish array of string cells; the first row is treated as
 * the header and rendered bold. Every cell is an inline string so numbers and
 * dates the caller formatted stay exactly as written.
 */
function buildXlsx(options) {
  const input = options === null || options === undefined ? {} : options;
  const sheetName = sheetNameOf(input.sheetName);
  const rows = normaliseRows(input.rows);

  const entries = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml(), "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRelsXml(), "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml(sheetName), "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRelsXml(), "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(worksheetXml(rows), "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(stylesXml(), "utf8") },
    { name: "docProps/core.xml", data: Buffer.from(coreXml(sheetName), "utf8") },
    { name: "docProps/app.xml", data: Buffer.from(appXml(sheetName), "utf8") },
  ];

  return buildZip(entries);
}

module.exports = { buildXlsx };
