"use strict";

/**
 * Minimal PresentationML (.pptx) generator.
 *
 * A slide is not a standalone part: PowerPoint resolves it through
 * presentation -> slideMaster -> slideLayout -> theme, and a missing link in
 * that chain shows up as a repair prompt rather than an error message. So the
 * whole chain is emitted here even though every slide uses the same layout:
 * one master, one "Title and Content" layout, one theme, N slides.
 */

const { buildZip } = require("./zip.js");

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const NS_CP = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const NS_DC = "http://purl.org/dc/elements/1.1/";
const NS_DCTERMS = "http://purl.org/dc/terms/";
const NS_XSI = "http://www.w3.org/2001/XMLSchema-instance";
const NS_EP = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";

// Widescreen 16:9, the default new-deck geometry since Office 2013.
const SLIDE_CX = 12192000;
const SLIDE_CY = 6858000;

const TITLE_BOX = { x: 838200, y: 365125, cx: 10515600, cy: 1325563 };
const BODY_BOX = { x: 838200, y: 1825625, cx: 10515600, cy: 4351338 };

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const LONE_SURROGATES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Escape text for XML.
 *
 * PowerPoint reports a package as unreadable when a part is not well-formed, so
 * a raw `&` or a control byte copied out of the transcript has to be removed
 * here — there is no second chance downstream.
 */
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

function xfrm(box) {
  return `<a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.cx}" cy="${box.cy}"/></a:xfrm>`;
}

function paragraphOf(value, { size, bold }) {
  const props = `<a:rPr lang="en-US" sz="${size}"${bold ? ' b="1"' : ""}/>`;
  return `<a:p><a:r>${props}<a:t>${text(value)}</a:t></a:r></a:p>`;
}

/**
 * Bullet paragraph with the bullet set explicitly.
 *
 * Bullets would normally come from the master's `txStyles`, which this writer
 * does not ship; carrying `buChar` per paragraph means the deck looks right in
 * PowerPoint, LibreOffice and the macOS preview without depending on inherited
 * list styles that are easy to get subtly wrong.
 */
function bulletParagraph(value) {
  return (
    "<a:p>" +
    '<a:pPr marL="285750" indent="-285750">' +
    '<a:spcBef><a:spcPts val="600"/></a:spcBef>' +
    '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>' +
    "</a:pPr>" +
    '<a:r><a:rPr lang="en-US" sz="2000"/><a:t>' +
    `${text(value)}</a:t></a:r></a:p>`
  );
}

function spTree(shapes) {
  return (
    "<p:spTree>" +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    shapes.join("") +
    "</p:spTree>"
  );
}

function shape({ id, name, placeholder, box, bodyProperties, paragraphs }) {
  return (
    "<p:sp>" +
    `<p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr>${placeholder}</p:nvPr></p:nvSpPr>` +
    `<p:spPr>${xfrm(box)}</p:spPr>` +
    `<p:txBody>${bodyProperties}<a:lstStyle/>${paragraphs}</p:txBody>` +
    "</p:sp>"
  );
}

// ---------------------------------------------------------------- master/layout

function slideMasterXml() {
  return (
    `${XML_DECL}<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">` +
    `<p:cSld>${spTree([])}</p:cSld>` +
    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"' +
    ' accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6"' +
    ' hlink="hlink" folHlink="folHlink"/>' +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
    "</p:sldMaster>"
  );
}

function slideMasterRelsXml() {
  return (
    `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
    `<Relationship Id="rId2" Type="${NS_R}/theme" Target="../theme/theme1.xml"/>` +
    "</Relationships>"
  );
}

function slideLayoutXml() {
  const shapes = [
    shape({
      id: "2",
      name: "Title 1",
      placeholder: '<p:ph type="title"/>',
      box: TITLE_BOX,
      bodyProperties: '<a:bodyPr anchor="b"/>',
      paragraphs: '<a:p><a:endParaRPr lang="en-US"/></a:p>',
    }),
    shape({
      id: "3",
      name: "Content Placeholder 2",
      placeholder: '<p:ph idx="1"/>',
      box: BODY_BOX,
      bodyProperties: "<a:bodyPr/>",
      paragraphs: '<a:p><a:endParaRPr lang="en-US"/></a:p>',
    }),
  ];
  return (
    `${XML_DECL}<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="obj" preserve="1">` +
    `<p:cSld name="Title and Content">${spTree(shapes)}</p:cSld>` +
    "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>" +
    "</p:sldLayout>"
  );
}

function slideLayoutRelsXml() {
  return (
    `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_R}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>` +
    "</Relationships>"
  );
}

// ------------------------------------------------------------------- slides

function slideXml(slide) {
  const title = typeof slide.title === "string" ? slide.title : "";
  const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
  const bulletXml = bullets.map((item) => bulletParagraph(item)).join("");

  const shapes = [
    shape({
      id: "2",
      name: "Title 1",
      placeholder: '<p:ph type="title"/>',
      box: TITLE_BOX,
      bodyProperties: '<a:bodyPr anchor="b"/>',
      paragraphs: title === "" ? '<a:p><a:endParaRPr lang="en-US"/></a:p>' : paragraphOf(title, { size: 4000, bold: true }),
    }),
    shape({
      id: "3",
      name: "Content Placeholder 2",
      placeholder: '<p:ph idx="1"/>',
      box: BODY_BOX,
      bodyProperties: "<a:bodyPr/>",
      // An empty body still needs one paragraph; `<a:p/>` is the smallest legal
      // one, and PowerPoint rejects a txBody with no paragraphs at all.
      paragraphs: bulletXml === "" ? '<a:p><a:endParaRPr lang="en-US"/></a:p>' : bulletXml,
    }),
  ];

  return (
    `${XML_DECL}<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">` +
    `<p:cSld>${spTree(shapes)}</p:cSld>` +
    "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>" +
    "</p:sld>"
  );
}

function slideRelsXml() {
  return (
    `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
    "</Relationships>"
  );
}

// --------------------------------------------------------------- presentation

function presentationXml(slideCount) {
  const ids = [];
  for (let i = 0; i < slideCount; i += 1) {
    ids.push(`<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`);
  }
  return (
    `${XML_DECL}<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" saveSubsetFonts="1">` +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    `<p:sldIdLst>${ids.join("")}</p:sldIdLst>` +
    `<p:sldSz cx="${SLIDE_CX}" cy="${SLIDE_CY}"/>` +
    '<p:notesSz cx="6858000" cy="9144000"/>' +
    "</p:presentation>"
  );
}

function presentationRelsXml(slideCount) {
  const rels = [
    `<Relationship Id="rId1" Type="${NS_R}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
  ];
  for (let i = 0; i < slideCount; i += 1) {
    rels.push(`<Relationship Id="rId${i + 2}" Type="${NS_R}/slide" Target="slides/slide${i + 1}.xml"/>`);
  }
  return `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">${rels.join("")}</Relationships>`;
}

// -------------------------------------------------------------------- theme

/**
 * A complete theme, not a stub.
 *
 * `fmtScheme` requires exactly three fills, three lines, three effects and three
 * background fills; PowerPoint refuses a theme with fewer. The colours are the
 * stock Office palette so tables and charts the user later adds keep their
 * expected look.
 */
function themeXml() {
  const solid = (value) =>
    `<a:solidFill><a:schemeClr val="${value}"/></a:solidFill>`;
  return (
    `${XML_DECL}<a:theme xmlns:a="${NS_A}" name="Office">` +
    "<a:themeElements>" +
    '<a:clrScheme name="Office">' +
    '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
    '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
    '<a:dk2><a:srgbClr val="44546A"/></a:dk2>' +
    '<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
    '<a:accent1><a:srgbClr val="4472C4"/></a:accent1>' +
    '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
    '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>' +
    '<a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
    '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>' +
    '<a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
    '<a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
    '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
    "</a:clrScheme>" +
    '<a:fontScheme name="Office">' +
    '<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>' +
    "</a:fontScheme>" +
    '<a:fmtScheme name="Office">' +
    `<a:fillStyleLst>${solid("phClr")}${solid("phClr")}${solid("phClr")}</a:fillStyleLst>` +
    "<a:lnStyleLst>" +
    '<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
    '<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
    '<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
    "</a:lnStyleLst>" +
    "<a:effectStyleLst>" +
    "<a:effectStyle><a:effectLst/></a:effectStyle>" +
    "<a:effectStyle><a:effectLst/></a:effectStyle>" +
    "<a:effectStyle><a:effectLst/></a:effectStyle>" +
    "</a:effectStyleLst>" +
    `<a:bgFillStyleLst>${solid("phClr")}${solid("phClr")}${solid("phClr")}</a:bgFillStyleLst>` +
    "</a:fmtScheme>" +
    "</a:themeElements>" +
    "<a:objectDefaults/><a:extraClrSchemeLst/>" +
    "</a:theme>"
  );
}

// --------------------------------------------------------------- package glue

function contentTypesXml(slideCount) {
  const slides = [];
  for (let i = 0; i < slideCount; i += 1) {
    slides.push(
      `<Override PartName="/ppt/slides/slide${i + 1}.xml" ` +
        'ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>',
    );
  }
  return (
    `${XML_DECL}<Types xmlns="${NS_CT}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
    slides.join("") +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    "</Types>"
  );
}

function rootRelsXml() {
  return (
    `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="ppt/presentation.xml"/>` +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    `<Relationship Id="rId3" Type="${NS_R}/extended-properties" Target="docProps/app.xml"/>` +
    "</Relationships>"
  );
}

function coreXml(title) {
  // Fixed timestamps keep the package byte-reproducible.
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

function appXml(slideCount) {
  return (
    `${XML_DECL}<Properties xmlns="${NS_EP}" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    "<TotalTime>0</TotalTime><Words>0</Words><Application>PI Desktop</Application>" +
    "<PresentationFormat>Widescreen</PresentationFormat><Paragraphs>0</Paragraphs>" +
    `<Slides>${slideCount}</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides>` +
    "<MMClips>0</MMClips><ScaleCrop>false</ScaleCrop><Company></Company>" +
    "<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc>" +
    "<HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion>" +
    "</Properties>"
  );
}

/**
 * Build a .pptx package.
 *
 * `slides` is `[{ title, bullets }]`. An empty deck would produce a presentation
 * part with an empty `<p:sldIdLst>`, which PowerPoint treats as damaged, so an
 * empty list still yields one slide instead of failing the caller's export.
 * That fallback slide carries the deck `title`, so it is a cover page rather
 * than an empty one -- it only comes out blank when `title` is empty too.
 */
function buildPptx(options) {
  const input = options === null || options === undefined ? {} : options;
  const title = typeof input.title === "string" ? input.title : "";
  const slides = Array.isArray(input.slides) && input.slides.length > 0 ? input.slides : [{ title, bullets: [] }];

  const entries = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml(slides.length), "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRelsXml(), "utf8") },
    { name: "ppt/presentation.xml", data: Buffer.from(presentationXml(slides.length), "utf8") },
    {
      name: "ppt/_rels/presentation.xml.rels",
      data: Buffer.from(presentationRelsXml(slides.length), "utf8"),
    },
    { name: "ppt/slideMasters/slideMaster1.xml", data: Buffer.from(slideMasterXml(), "utf8") },
    {
      name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      data: Buffer.from(slideMasterRelsXml(), "utf8"),
    },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: Buffer.from(slideLayoutXml(), "utf8") },
    {
      name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      data: Buffer.from(slideLayoutRelsXml(), "utf8"),
    },
  ];

  slides.forEach((slide, index) => {
    const safe = slide === null || typeof slide !== "object" ? { title: "", bullets: [] } : slide;
    entries.push({
      name: `ppt/slides/slide${index + 1}.xml`,
      data: Buffer.from(slideXml(safe), "utf8"),
    });
    entries.push({
      name: `ppt/slides/_rels/slide${index + 1}.xml.rels`,
      data: Buffer.from(slideRelsXml(), "utf8"),
    });
  });

  entries.push({ name: "ppt/theme/theme1.xml", data: Buffer.from(themeXml(), "utf8") });
  entries.push({ name: "docProps/core.xml", data: Buffer.from(coreXml(title), "utf8") });
  entries.push({ name: "docProps/app.xml", data: Buffer.from(appXml(slides.length), "utf8") });

  return buildZip(entries);
}

module.exports = { buildPptx };
