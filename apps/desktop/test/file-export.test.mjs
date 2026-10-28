import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const LOCALES = ["zh-CN", "zh-TW", "en", "de", "es", "fr", "ko", "tr"];

test("export is its own channel, not a general write", async () => {
  const [protocol, ipc] = await Promise.all([
    read("../../packages/shared/src/protocol.ts"),
    read("electron/main/ipc/workspace-ipc.ts"),
  ]);

  assert.match(protocol, /fsExport: "pi-desktop\/fs\/export"/);
  assert.match(ipc, /IPC\.invoke\.fsExport/);
  // Same containment check as the other read paths: an export can only start
  // from a file the app could already open.
  assert.match(ipc, /resolveRealOpenablePath\(/);
  // The destination never leaves the main process until the user picks it.
  assert.match(ipc, /dialog\.showSaveDialog/);
  assert.match(ipc, /showOverwriteConfirmation/);
  assert.match(ipc, /copyFile\(source, picked\.filePath\)/);
  // A suggested name is a name, never a path.
  assert.match(ipc, /function sanitizeExportName\(value: unknown\): string/);
  assert.match(ipc, /sanitizeExportName\(input\?\.suggestedName\) \|\| basename\(source\)/);
});

test("a canceled save is silent and a failed one is not", async () => {
  const helper = await read("src/lib/export-file.ts");

  assert.match(helper, /const result = await api\.fsExport\(path, suggestedName\);/);
  assert.match(helper, /if \(result\.canceled\) return;/);
  assert.match(helper, /showToast\(i18n\.t\("panel\.files\.exported", \{ path: result\.path \?\? "" \}\)\)/);
  assert.match(helper, /showToast\(i18n\.t\("panel\.files\.exportError"\), \{ variant: "error" \}\)/);
});

test("both surfaces offer the action, and the row keeps its own label", async () => {
  const [api, files, artifacts] = await Promise.all([
    read("src/lib/api.ts"),
    read("src/components/workpanel/FilesTab.tsx"),
    read("src/components/workpanel/ArtifactsTab.tsx"),
  ]);

  assert.match(api, /fsExport: \(path: string, suggestedName\?: string\) =>/);
  assert.match(files, /onClick=\{\(\) => void exportFile\(selected\)\}/);
  assert.match(files, /<IconDownload size=\{14\} \/>/);
  // The export button sits next to the row rather than inside it, so the row
  // stays one button with one label.
  assert.match(artifacts, /<li key=\{artifact\.path\} className="artifacts-item">/);
  assert.match(artifacts, /ariaLabel=\{`\$\{t\("panel\.files\.export"\)\}: \$\{artifact\.path\}`\}/);
  assert.match(artifacts, /onClick=\{\(\) => void exportFile\(artifact\.path\)\}/);
});

test("every locale names the action and its outcome", async () => {
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
    for (const key of ["export", "exported", "exportError"]) {
      assert.match(
        source,
        new RegExp(`(?<!\\w)["']?${key}["']?\\s*:\\s*"[^"]+"`),
        `${LOCALES[index]} is missing panel.files.${key}`,
      );
    }
    assert.match(
      source,
      /exported["']?\s*:\s*"[^"]*\{\{path\}\}/,
      `${LOCALES[index]} does not name the destination`,
    );
  }
});
