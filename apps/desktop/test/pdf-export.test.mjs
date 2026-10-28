import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildSessionDocument } from "../src/lib/session-pdf.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const LOCALES = ["zh-CN", "zh-TW", "en", "de", "es", "fr", "ko", "tr"];
const LABELS = { user: "U", assistant: "A" };

const message = (role, content) => ({ id: `${role}-${content}`, role, content });

test("the document is prose only, and markdown becomes HTML", () => {
  const html = buildSessionDocument(
    "招标附件 <script>",
    [
      message("user", "帮我总结 **要点**"),
      message("tool", "read_file: internal machinery"),
      message("system", "system note"),
      message("assistant", "1. 第一点\n2. 第二点"),
      message("assistant", "   "),
    ],
    LABELS,
  );

  assert.ok(html.includes("<h1>招标附件 &lt;script&gt;</h1>"), "title is escaped");
  assert.ok(html.includes("<strong>要点</strong>"), "markdown is rendered");
  assert.ok(html.includes("<ol>"), "lists survive");
  assert.ok(!html.includes("internal machinery"), "tool rows are dropped");
  assert.ok(!html.includes("system note"), "system notes are dropped");
  assert.equal(html.match(/class="turn"/g)?.length, 2);
  assert.ok(html.includes('<div class="who">U</div>'));
});

test("rendering happens in a throwaway window and lands in scratch", async () => {
  const [protocol, ipc] = await Promise.all([
    read("../../packages/shared/src/protocol.ts"),
    read("electron/main/ipc/workspace-ipc.ts"),
  ]);

  assert.match(protocol, /pdfRender: "pi-desktop\/pdf\/render"/);
  assert.match(ipc, /IPC\.invoke\.pdfRender/);
  // No node, no visible window, and the same scratch directory the file
  // panel already reads.
  assert.match(ipc, /show: false,/);
  assert.match(ipc, /nodeIntegration: false/);
  assert.match(ipc, /sessionScratchRoot\(input\?\.sessionId\)/);
  assert.match(ipc, /printToPDF\(\{/);
  // The window and the intermediate HTML both go away, whatever happens.
  assert.match(ipc, /renderer\.destroy\(\)/);
  assert.match(ipc, /rm\(source, \{ force: true \}\)/);
  // Bounded input: a page this large is a bug.
  assert.match(ipc, /const PDF_HTML_LIMIT = 4 \* 1024 \* 1024;/);
  assert.match(ipc, /Buffer\.byteLength\(html, "utf8"\) > PDF_HTML_LIMIT/);
});

test("the PDF goes out through the export channel, not a second write path", async () => {
  const [api, exporter, commands, builtins] = await Promise.all([
    read("src/lib/api.ts"),
    read("src/lib/export-session-pdf.ts"),
    read("src/lib/commands.ts"),
    read("electron/main/builtin-commands.ts"),
  ]);

  assert.match(api, /pdfRender: \(request: PdfRenderRequest\) =>/);
  assert.match(exporter, /const result = await api\.pdfRender\(\{/);
  assert.match(exporter, /await exportFile\(result\.path, `\$\{title\}\.pdf`\)/);
  assert.match(exporter, /showToast\(i18n\.t\("panel\.files\.pdfEmpty"\)/);
  assert.match(builtins, /id: "builtin\.session\.exportPdf"/);
  assert.match(builtins, /slash: "pdf"/);
  assert.match(commands, /case "builtin\.session\.exportPdf":\s*\n\s*await exportSessionPdf\(\);/);
});

test("every locale can label a PDF", async () => {
  const catalogs = await Promise.all(
    LOCALES.map((locale) =>
      readFile(
        new URL(
          `../../../packages/i18n/src/locales/${locale}/index.ts`,
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );

  for (const [index, source] of catalogs.entries()) {
    for (const key of ["pdfUser", "pdfAssistant", "pdfEmpty", "pdfFallbackTitle", "pdfError"]) {
      assert.match(
        source,
        new RegExp(`(?<!\\w)["']?${key}["']?\\s*:\\s*"[^"]+"`),
        `${LOCALES[index]} is missing panel.files.${key}`,
      );
    }
  }
});
