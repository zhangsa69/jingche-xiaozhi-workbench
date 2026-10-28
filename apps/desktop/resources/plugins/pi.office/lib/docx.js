"use strict";

/**
 * Minimal WordprocessingML (.docx) generator.
 *
 * The intent is a document Word opens without a repair prompt, not a full
 * writer: one title paragraph plus one paragraph per input line, stored as a
 * store-only zip. Everything Word needs to resolve parts by relationship is
 * present so the package validates as an ordinary OPC package.
 */

const { buildZip } = require("./zip.js");

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const NS_CP = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const NS_DC = "http://purl.org/dc/elements/1.1/";
const NS_DCTERMS = "http://purl.org/dc/terms/";
const NS_XSI = "http://www.w3.org/2001/XMLSchema-instance";
const NS_EP = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";

// Word reports "file is corrupt" for a package whose XML is not well-formed, so
// one raw `&` or a stray C0 control byte from the chat transcript is fatal
// rather than cosmetic. Escaping and stripping happen here, in one place, so no
// call site can forget.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
// Unpaired surrogates are also illegal in XML 1.0 and cannot be represented in
// UTF-8 output at all — they would turn into replacement bytes.
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

/**
 * Render `value` as the run content of one paragraph.
 *
 * A newline inside a paragraph string becomes `<w:br/>` instead of a literal
 * newline inside `<w:t>`, which Word would collapse into a space.
 */
function runs(value) {
  const lines = String(value === null || value === undefined ? "" : value).split(/\r\n|\r|\n/);
  const out = [];
  lines.forEach((line, index) => {
    if (index > 0) {
      out.push("<w:br/>");
    }
    out.push(`<w:t xml:space="preserve">${text(line)}</w:t>`);
  });
  return out.join("");
}

function paragraph(value) {
  return `<w:p><w:r>${runs(value)}</w:r></w:p>`;
}

/**
 * Title paragraph.
 *
 * `w:pStyle` is the Word-native way to mark a heading, but a viewer that
 * ignores styles.xml (or a converter that drops it) would then render plain
 * text, so the same typography is also applied directly as run properties.
 * Duplicating the look costs one line and removes the whole class of "my title
 * is not bold" reports.
 */
function titleParagraph(title) {
  return (
    '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r>' +
    '<w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr>' +
    `${runs(title)}</w:r></w:p>`
  );
}

function contentTypesXml() {
  return (
    `${XML_DECL}<Types xmlns="${NS_CT}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    "</Types>"
  );
}

function rootRelsXml() {
  return (
    `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="word/document.xml"/>` +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    `<Relationship Id="rId3" Type="${NS_R}/extended-properties" Target="docProps/app.xml"/>` +
    "</Relationships>"
  );
}

function documentRelsXml() {
  return (
    `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_R}/styles" Target="styles.xml"/>` +
    "</Relationships>"
  );
}

function stylesXml() {
  return (
    `${XML_DECL}<w:styles xmlns:w="${NS_W}">` +
    "<w:docDefaults>" +
    '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
    '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
    "</w:docDefaults>" +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>' +
    '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:spacing w:before="240" w:after="240"/><w:jc w:val="left"/></w:pPr>' +
    '<w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>' +
    "</w:styles>"
  );
}

function documentXml(title, paragraphs) {
  const body = [];
  const heading = title === null || title === undefined ? "" : String(title);
  if (heading !== "") {
    body.push(titleParagraph(heading));
  }
  for (const value of paragraphs) {
    const line = value === null || value === undefined ? "" : String(value);
    // An empty string means "blank line"; `<w:p/>` is the way to write one that
    // still occupies a line in the layout.
    body.push(line === "" ? "<w:p/>" : paragraph(line));
  }
  // A4 portrait with 1in margins, the same geometry Word uses by default.
  const sectPr =
    "<w:sectPr>" +
    '<w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/>' +
    "</w:sectPr>";

  return (
    `${XML_DECL}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}">` +
    `<w:body>${body.join("")}${sectPr}</w:body></w:document>`
  );
}

function coreXml(title) {
  // Fixed timestamps: reproducible packages are testable packages.
  const created = "2020-01-01T00:00:00Z";
  return (
    `${XML_DECL}<cp:coreProperties xmlns:cp="${NS_CP}" xmlns:dc="${NS_DC}" ` +
    `xmlns:dcterms="${NS_DCTERMS}" xmlns:xsi="${NS_XSI}">` +
    `<dc:title>${text(title)}</dc:title>` +
    "<dc:creator>PI Desktop</dc:creator>" +
    "<cp:lastModifiedBy>PI Desktop</cp:lastModifiedBy>" +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>` +
    "</cp:coreProperties>"
  );
}

function appXml(paragraphCount) {
  // Element order follows the extended-properties schema; Word tolerates
  // reordering but other consumers do not always.
  return (
    `${XML_DECL}<Properties xmlns="${NS_EP}" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    "<Template>Normal.dotm</Template><TotalTime>0</TotalTime><Pages>1</Pages>" +
    `<Words>0</Words><Characters>0</Characters>` +
    "<Application>PI Desktop</Application><DocSecurity>0</DocSecurity>" +
    `<Lines>${paragraphCount}</Lines><Paragraphs>${paragraphCount}</Paragraphs>` +
    "<ScaleCrop>false</ScaleCrop><Company></Company>" +
    "<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc>" +
    "<HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion>" +
    "</Properties>"
  );
}

/**
 * Build a .docx package.
 *
 * `title` may be empty (then no heading paragraph is written); `paragraphs` is
 * plain text, one entry per paragraph, and an empty string is a blank line.
 */
function buildDocx(options) {
  const input = options === null || options === undefined ? {} : options;
  const title = typeof input.title === "string" ? input.title : "";
  const paragraphs = Array.isArray(input.paragraphs) ? input.paragraphs : [];
  const paragraphCount = paragraphs.length + (title === "" ? 0 : 1);

  const entries = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml(), "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRelsXml(), "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml(title, paragraphs), "utf8") },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(documentRelsXml(), "utf8") },
    { name: "word/styles.xml", data: Buffer.from(stylesXml(), "utf8") },
    { name: "docProps/core.xml", data: Buffer.from(coreXml(title), "utf8") },
    { name: "docProps/app.xml", data: Buffer.from(appXml(paragraphCount), "utf8") },
  ];

  return buildZip(entries);
}

module.exports = { buildDocx };
