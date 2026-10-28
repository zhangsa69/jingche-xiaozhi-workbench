import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * pi.office — the plugin shell.
 *
 * These cases drive the shipped `main.js` directly with a fake `pi` global
 * rather than through PluginRuntime: the shell's whole job is "validate, build,
 * hand the bytes to the host", so the interesting contract is the arguments
 * and the one `pi.fs.writeBase64` call, not process plumbing.
 *
 * The OOXML builders in `lib/` are covered by `office-ooxml.test.mjs`; these
 * cases only care that the shell hands their bytes through untouched. The
 * builders-missing guard keeps the path-validation cases runnable if the
 * plugin tree is ever split up, but in a complete tree nothing is skipped.
 */

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = resolve(here, "../resources/plugins/pi.office");
const MAIN_ENTRY = join(PLUGIN_DIR, "main.js");
const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, "manifest.json"), "utf8"));
const mainSource = readFileSync(MAIN_ENTRY, "utf8");

const TOOL_NAMES = ["OfficeDoc", "OfficeSheet", "OfficeSlides"];

const GENERATORS = { docx: "lib/docx.js", xlsx: "lib/xlsx.js", pptx: "lib/pptx.js" };
const missing = Object.entries(GENERATORS)
  .filter(([, file]) => !existsSync(join(PLUGIN_DIR, file)))
  .map(([, file]) => file);
const buildersSkip = missing.length
  ? `OOXML builders not in place yet (missing ${missing.join(", ")})`
  : false;

register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const { validateManifest, PLUGIN_PERMISSIONS } = await import("../../../packages/plugin-sdk/src/index.ts");

/** A fake host: records tool registration and every binary write. */
function fakeHost({ onWrite } = {}) {
  const writes = [];
  const tools = new Map();
  const unregistered = [];
  globalThis.pi = {
    workspace: { get: async () => ({ root: "/work/project", name: "project" }) },
    fs: {
      writeBase64: async (path, base64) => {
        writes.push({ path, base64 });
        if (onWrite) return onWrite(path, base64);
        return { ok: true, bytes: Buffer.from(base64, "base64").length, path };
      },
    },
    agent: {
      registerTool: async (tool) => {
        tools.set(tool.name, tool);
        return { ok: true };
      },
      unregisterTool: async (name) => {
        tools.delete(name);
        unregistered.push(name);
        return { ok: true };
      },
    },
  };
  return { writes, tools, unregistered };
}

let loads = 0;

/** Each case gets its own module instance, so no state leaks between them. */
async function loadPlugin() {
  loads += 1;
  return import(`${pathToFileURL(MAIN_ENTRY).href}?load=${loads}`);
}

async function loadedTools(t, options) {
  const host = fakeHost(options);
  t.after(() => {
    delete globalThis.pi;
  });
  const plugin = await loadPlugin();
  await plugin.onLoad();
  return { host, plugin };
}

test("onLoad registers exactly the three office tools and onUnload releases them", async (t) => {
  const { host, plugin } = await loadedTools(t);

  assert.deepEqual([...host.tools.keys()], TOOL_NAMES);

  const required = {
    OfficeDoc: ["path", "paragraphs"],
    OfficeSheet: ["path", "rows"],
    OfficeSlides: ["path", "slides"],
  };
  for (const [name, tool] of host.tools) {
    assert.equal(tool.risk, "medium", `${name} writes files, so it is a medium risk`);
    // Writing tools must stay out of Plan/Goal mode: no plan-safe actions.
    assert.equal(tool.planSafeActions, undefined, `${name} must not declare planSafeActions`);
    assert.equal(tool.schema.type, "object");
    assert.deepEqual(tool.schema.required, required[name]);
    assert.equal(typeof tool.execute, "function");
    // Self-sufficient for a model that never read the docs.
    assert.match(tool.description, /ToolSearch/);
    assert.match(tool.description, new RegExp(name.replace("Office", ""), "i"));
  }

  await plugin.onUnload();
  assert.deepEqual(host.unregistered, TOOL_NAMES);
  assert.equal(host.tools.size, 0);
});

test("the shell writes only through the host binary write, never through Node fs", () => {
  assert.match(mainSource, /pi\.fs\.writeBase64\(/);
  assert.doesNotMatch(mainSource, /from\s+["']node:fs["']/);
  assert.doesNotMatch(mainSource, /require\(["'](?:node:)?fs["']\)/);
});

test("OfficeDoc writes a .docx into the workspace and reports the path", { skip: buildersSkip }, async (t) => {
  const { host } = await loadedTools(t);
  const tool = host.tools.get("OfficeDoc");

  const result = await tool.execute({
    path: "reports/q3/summary.docx",
    title: "Q3 summary",
    paragraphs: ["Revenue grew.", "", "Costs held flat."],
  });

  assert.equal(result.ok, true);
  assert.equal(result.isError, undefined);
  assert.equal(result.path, "reports/q3/summary.docx");

  assert.equal(host.writes.length, 1);
  const [write] = host.writes;
  // Workspace-relative, not an OS path the host would have to reject.
  assert.equal(write.path, "reports/q3/summary.docx");
  assert.doesNotMatch(write.path, /^[/\\]|^[a-zA-Z]:/);
  // A real OOXML package is a zip: valid base64 that decodes to "PK\x03\x04".
  assert.match(write.base64, /^[A-Za-z0-9+/]+={0,2}$/);
  const bytes = Buffer.from(write.base64, "base64");
  assert.equal(bytes.subarray(0, 4).toString("latin1"), "PK\u0003\u0004");
  assert.ok(bytes.length > 100, `expected a real package, got ${bytes.length} bytes`);

  assert.equal(result.bytes, bytes.length);
  assert.equal(result.content, `Wrote a Word document (${bytes.length} bytes) to reports/q3/summary.docx.`);
});

test("invalid paths are refused before the host is touched", async (t) => {
  const { host } = await loadedTools(t);

  const cases = [
    ["OfficeDoc", undefined],
    ["OfficeDoc", ""],
    ["OfficeDoc", "   "],
    ["OfficeDoc", "/tmp/escape.docx"],
    ["OfficeDoc", "C:\\Users\\me\\doc.docx"],
    ["OfficeDoc", "C:/Users/me/doc.docx"],
    ["OfficeDoc", "..\\outside.docx"],
    ["OfficeDoc", "notes/../../outside.docx"],
    ["OfficeDoc", "notes/todo.txt"],
    ["OfficeDoc", "notes/todo"],
    ["OfficeDoc", "reports/"],
    ["OfficeSheet", "/tmp/escape.xlsx"],
    ["OfficeSheet", "notes/todo.docx"],
    ["OfficeSlides", "C:/decks/review.pptx"],
  ];

  for (const [name, path] of cases) {
    const result = await host.tools.get(name).execute({ path, paragraphs: [], rows: [], slides: [] });
    assert.equal(result.ok, false, `${name} accepted ${JSON.stringify(path)}`);
    assert.equal(result.isError, true);
    assert.ok(
      typeof result.content === "string" && result.content.startsWith(`${name}: `),
      `refusal must name the tool: ${result.content}`,
    );
    assert.ok(result.content.length > `${name}: `.length, "refusal must explain itself");
  }

  assert.deepEqual(host.writes, [], "no invalid path may reach the host");
});

test("wrong argument shapes are refused instead of writing a blank file", async (t) => {
  const { host } = await loadedTools(t);

  // `lib/*.js` reads a non-array as "nothing to write", so without these
  // refusals a shape mistake would come back as a successful empty document.
  const cases = [
    ["OfficeDoc", { path: "notes/a.docx", paragraphs: "Revenue grew. Costs flat." }, /`paragraphs` must be an array/],
    ["OfficeDoc", { path: "notes/a.docx", paragraphs: ["ok", { text: "no" }] }, /`paragraphs\[1\]` must be a string/],
    ["OfficeSheet", { path: "notes/a.xlsx", rows: "Month,Revenue" }, /`rows` must be an array/],
    ["OfficeSheet", { path: "notes/a.xlsx", rows: [["Month"], "July"] }, /`rows\[1\]` must be an array of cells/],
    ["OfficeSheet", { path: "notes/a.xlsx", rows: [["Month"], [{ n: 1 }]] }, /`rows\[1\]\[0\]`/],
    ["OfficeSlides", { path: "notes/a.pptx", slides: "Intro" }, /`slides` must be an array/],
    ["OfficeSlides", { path: "notes/a.pptx", slides: ["Intro"] }, /`slides\[0\]` must be an object/],
    ["OfficeSlides", { path: "notes/a.pptx", slides: [{ bullets: ["x"] }] }, /`slides\[0\]\.title` is required/],
    ["OfficeSlides", { path: "notes/a.pptx", slides: [{ title: "Intro", bullets: "one" }] }, /`slides\[0\]\.bullets` must be an array/],
    // `lib/pptx.js` stringifies bullet entries, so an object would otherwise be
    // written out as a literal "[object Object]" bullet.
    ["OfficeSlides", { path: "notes/a.pptx", slides: [{ title: "Intro", bullets: [{ text: "a" }] }] }, /`slides\[0\]\.bullets\[0\]` must be a string, got an object/],
    // `lib/` keeps a heading only when it is a string, so an object title would
    // otherwise vanish from the file while the tool still reported success.
    ["OfficeDoc", { path: "notes/a.docx", paragraphs: [], title: { q: "Q3" } }, /`title` must be a string/],
    ["OfficeSheet", { path: "notes/a.xlsx", rows: [["a"]], sheetName: ["Q3"] }, /`sheetName` must be a string/],
    ["OfficeSlides", { path: "notes/a.pptx", slides: [], title: { q: "Q3" } }, /`title` must be a string/],
    ["OfficeSlides", { path: "notes/a.pptx", slides: [{ title: { q: "Q3" } }] }, /`slides\[0\]\.title` must be a string/],
  ];

  for (const [name, args, expected] of cases) {
    const result = await host.tools.get(name).execute(args);
    assert.equal(result.ok, false, `${name} accepted ${JSON.stringify(args)}`);
    assert.equal(result.isError, true);
    assert.ok(result.content.startsWith(`${name}: `), result.content);
    assert.match(result.content, expected);
  }

  assert.deepEqual(host.writes, [], "a shape mistake may not reach the host");
});

test("scalar titles reach the file instead of being silently dropped", { skip: buildersSkip }, async (t) => {
  const { host } = await loadedTools(t);

  // The builders write a heading only for `typeof === "string"`, so a numeric
  // year has to be stringified on this side or it disappears from the output.
  const doc = await host.tools.get("OfficeDoc").execute({ path: "notes/year.docx", title: 2026, paragraphs: [] });
  const deck = await host.tools.get("OfficeSlides").execute({ path: "decks/year.pptx", slides: [{ title: 42 }] });
  const sheet = await host.tools.get("OfficeSheet").execute({ path: "reports/year.xlsx", sheetName: 2026, rows: [["a"]] });

  for (const result of [doc, deck, sheet]) assert.equal(result.ok, true);
  assert.equal(host.writes.length, 3);
  const text = host.writes.map((write) => Buffer.from(write.base64, "base64").toString("latin1"));
  assert.ok(text[0].includes("2026"), "document title");
  assert.ok(text[1].includes("42"), "slide title");
  assert.ok(text[2].includes("2026"), "worksheet name");
});

test("the ESM/CJS split is declared on both sides", async () => {
  const root = JSON.parse(readFileSync(join(PLUGIN_DIR, "package.json"), "utf8"));
  const lib = JSON.parse(readFileSync(join(PLUGIN_DIR, "lib/package.json"), "utf8"));

  // `main.js` uses `import`, `lib/*.js` uses `module.exports`, and each half
  // needs its own declaration: dropping `module` parses the entry as CJS,
  // dropping `commonjs` parses the builders as ESM ("module is not defined").
  assert.equal(root.type, "module", "pi.office/package.json must stay type=module");
  assert.equal(lib.type, "commonjs", "pi.office/lib/package.json must stay type=commonjs");
});

test("an empty paragraphs array is a title-only document, not an error", { skip: buildersSkip }, async (t) => {
  const { host } = await loadedTools(t);

  const result = await host.tools.get("OfficeDoc").execute({
    path: "notes/cover.docx",
    title: "Cover",
    paragraphs: [],
  });

  assert.equal(result.ok, true);
  assert.equal(host.writes.length, 1);
  // The title still lands in the package instead of an empty body.
  assert.ok(Buffer.from(host.writes[0].base64, "base64").toString("latin1").includes("Cover"));
});

test("OfficeSheet writes a .xlsx", { skip: buildersSkip }, async (t) => {
  const { host } = await loadedTools(t);

  const result = await host.tools.get("OfficeSheet").execute({
    path: "reports/q3/numbers.xlsx",
    sheetName: "Q3",
    rows: [
      ["Month", "Revenue"],
      ["July", "1200"],
      ["August", "1350"],
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.path, "reports/q3/numbers.xlsx");
  assert.equal(host.writes.length, 1);
  assert.equal(host.writes[0].path, "reports/q3/numbers.xlsx");
  const bytes = Buffer.from(host.writes[0].base64, "base64");
  assert.equal(bytes.subarray(0, 4).toString("latin1"), "PK\u0003\u0004");
  assert.equal(result.content, `Wrote an Excel workbook (${bytes.length} bytes) to reports/q3/numbers.xlsx.`);
});

test("OfficeSlides writes a .pptx", { skip: buildersSkip }, async (t) => {
  const { host } = await loadedTools(t);

  const result = await host.tools.get("OfficeSlides").execute({
    path: "decks/q3-review.pptx",
    title: "Q3 review",
    slides: [
      { title: "Where we are", bullets: ["Revenue up", "Churn flat"] },
      { title: "Next" },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.path, "decks/q3-review.pptx");
  assert.equal(host.writes.length, 1);
  const bytes = Buffer.from(host.writes[0].base64, "base64");
  assert.equal(bytes.subarray(0, 4).toString("latin1"), "PK\u0003\u0004");
  assert.equal(result.content, `Wrote a PowerPoint deck (${bytes.length} bytes) to decks/q3-review.pptx.`);
});

test("an empty slides array yields a one-slide deck, and the tool says so", { skip: buildersSkip }, async (t) => {
  const { host } = await loadedTools(t);
  const tool = host.tools.get("OfficeSlides");

  // An empty `sldIdLst` is a deck PowerPoint calls corrupt, so the builder
  // falls back to a cover slide; that is a documented feature, not a failure.
  assert.match(tool.description, /empty `slides` array is not an error/);

  const result = await tool.execute({ path: "decks/cover.pptx", title: "Q3 review", slides: [] });

  assert.equal(result.ok, true);
  assert.equal(result.path, "decks/cover.pptx");
  assert.equal(host.writes.length, 1);
  const bytes = Buffer.from(host.writes[0].base64, "base64");
  assert.equal(bytes.subarray(0, 4).toString("latin1"), "PK\u0003\u0004");
  // The title still lands on the fallback slide instead of an empty deck.
  assert.ok(bytes.toString("latin1").includes("Q3 review"));
});

test("a host write failure comes back as an error that keeps the reason", { skip: buildersSkip }, async (t) => {
  const reason = "PERMISSION_DENIED: outside manifest.fs.write.scope: /etc/evil.docx";
  const { host } = await loadedTools(t, {
    onWrite: () => {
      throw new Error(reason);
    },
  });

  const result = await host.tools.get("OfficeDoc").execute({
    path: "notes/inside.docx",
    paragraphs: ["one line"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.isError, true);
  assert.match(result.content, /^OfficeDoc: /);
  assert.ok(result.content.includes(reason), `the cause must survive: ${result.content}`);
});

test("the manifest declares a narrow fs.write scope and localized safety notes", () => {
  const checked = validateManifest(manifest);
  assert.equal(checked.ok, true, checked.error);

  assert.equal(manifest.id, "pi.office");
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.main, "main.js");
  assert.equal(manifest.version, "0.1.0");

  // `fs.writeBase64` is a host API name, not a permission: writeBase64 goes
  // through resolveFsRequest(..., "write", ...) and asserts `fs.write`, so
  // declaring a `fs.writeBase64` permission would only read as unknown.
  assert.deepEqual([...manifest.permissions].sort(), ["agent.tool.register", "fs.write"]);
  // `pi-plugin check` treats a permission outside this list as an error and
  // `pack` then refuses to build, so the manifest has to stay inside it.
  for (const permission of manifest.permissions) {
    assert.ok(PLUGIN_PERMISSIONS.includes(permission), `unknown permission: ${permission}`);
  }
  assert.equal(manifest.fs.write.root, "workspace");
  assert.deepEqual(
    [...manifest.fs.write.scope].sort(),
    ["**/*.docx", "**/*.pptx", "**/*.xlsx"],
  );
  // Pure tool plugin: no panel surface to install.
  assert.equal(manifest.contributes, undefined);

  assert.ok(manifest.description.trim());
  for (const locale of ["en", "zh-CN"]) {
    const entry = manifest.i18n?.[locale] ?? {};
    assert.ok(entry.name?.trim(), `i18n.${locale}.name`);
    assert.ok(entry.description?.trim(), `i18n.${locale}.description`);
    assert.ok(entry.safetyNotes?.trim(), `i18n.${locale}.safetyNotes`);
  }
  // The Chinese notes are the ones the install review shows, and they have to
  // name the three promises: scoped writes, no network, no bundled libraries.
  assert.ok(manifest.safetyNotes.trim());
  assert.match(manifest.safetyNotes, /fs\.write/);
  assert.match(manifest.safetyNotes, /网络/);
  assert.match(manifest.safetyNotes, /第三方库/);
});
