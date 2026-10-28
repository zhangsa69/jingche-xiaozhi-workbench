import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, "..");
const hostProcessEntry = join(desktopRoot, "electron/main/plugin-host-process.mjs");

// Set before the runtime is imported so the write ledger and per-plugin data
// land in a throwaway directory instead of the developer's real one.
process.env.PI_DESKTOP_DATA_DIR = mkdtempSync(join(tmpdir(), "pi-fs-binary-data-"));

register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const { MAX_FS_WRITE_BYTES, PluginRuntime } = await import(
  "../electron/main/plugin-runtime.ts"
);

function forkPluginProcess({ entry }) {
  const child = fork(entry, [], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  return {
    postMessage: (message) => {
      if (child.connected) child.send(message);
    },
    onMessage: (handler) => child.on("message", handler),
    onExit: (handler) => child.on("exit", (code) => handler(code ?? 0)),
    kill: () => child.kill(),
  };
}

/**
 * A plugin that turns one fs call into data instead of a thrown error, so a
 * refusal can be asserted on without unwrapping it across the process
 * boundary. The channel is deliberately not a host channel, so the call is
 * forwarded to the plugin and reaches `pi.fs.writeBase64` exactly the way a
 * real plugin's code does.
 */
const PLUGIN_MAIN = `
  async function attempt(fn) {
    try {
      return { ok: true, value: (await fn()) ?? null };
    } catch (error) {
      return { ok: false, code: error?.code ?? "UNKNOWN", message: String(error?.message ?? "") };
    }
  }
  module.exports = {
    async onPanelInvoke(channel, payload) {
      if (channel === "writeBase64") {
        return attempt(() => pi.fs.writeBase64(payload.path, payload.base64));
      }
      if (channel === "remove") return attempt(() => pi.fs.remove(payload.path));
      throw new Error("unknown channel: " + channel);
    },
  };
`;

/** A zip container's first bytes: invalid UTF-8 on purpose, like a real docx. */
const BINARY = Buffer.from([
  0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0xff, 0xfe, 0x80, 0x00, 0xc3, 0x28,
]);

function writePlugin({ id, permissions, fs: fsPolicy }) {
  const dir = mkdtempSync(join(tmpdir(), "pi-fs-binary-plugin-"));
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      id,
      name: id,
      version: "0.0.1",
      main: "main.js",
      permissions,
      ...(fsPolicy ? { fs: fsPolicy } : {}),
    }),
    "utf8",
  );
  writeFileSync(join(dir, "main.js"), PLUGIN_MAIN, "utf8");
  return dir;
}

/** A workspace holding the files a write must be able to leave alone. */
function makeWorkspace(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pi-fs-binary-ws-"));
  for (const [rel, content] of Object.entries({ "notes.txt": "notes", ...files })) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return dir;
}

/**
 * No consent service is wired: a host that cannot ask must refuse, which is
 * what makes a scope-breach assertion about the permission rather than about a
 * dialog.
 */
async function harness(t, { id, permissions, fs: fsPolicy }) {
  const ws = makeWorkspace();
  const audits = [];
  const trashed = [];
  const runtime = new PluginRuntime({
    hostEntry: hostProcessEntry,
    spawnProcess: forkPluginProcess,
    getWorkspacePath: () => ws,
    audit: (entry) => audits.push(entry),
    trashItem: async (fullPath) => trashed.push(fullPath),
  });
  t.after(async () => {
    for (const loaded of runtime.listLoaded()) await runtime.unload(loaded.manifest.id);
  });
  const dir = writePlugin({ id, permissions, fs: fsPolicy });
  await runtime.loadFromPath(dir, permissions);
  return { runtime, ws, audits, trashed };
}

/** One `pi.fs.writeBase64` call through the plugin process. */
function write(runtime, id, path, base64) {
  return runtime.invokePanelBridge(id, "writeBase64", { path, base64 });
}

test("a base64 write inside the declared scope lands byte for byte", async (t) => {
  const { runtime, ws, audits } = await harness(t, {
    id: "fs.binary.write",
    permissions: ["fs.write"],
    fs: { write: { scope: ["out/**"] } },
  });

  const result = await write(runtime, "fs.binary.write", "out/nested/report.docx", BINARY.toString("base64"));
  assert.equal(result.ok, true, result.message);
  // The documented contract: { ok, bytes, path }.
  assert.equal(result.value.ok, true);
  assert.equal(result.value.bytes, BINARY.length);
  assert.equal(result.value.path, "out/nested/report.docx");
  assert.deepEqual(readFileSync(join(ws, "out/nested/report.docx")), BINARY);

  const recorded = audits.find((entry) => entry.api === "fs.writeBase64" && entry.ok === true);
  assert.ok(recorded, "the write is audited under its own api name");
  assert.equal(recorded.path, "out/nested/report.docx");
  assert.equal(recorded.data?.bytes, BINARY.length);
});

test("the panel bridge exposes the same call as fs.writeBase64", async (t) => {
  const { runtime, ws } = await harness(t, {
    id: "fs.binary.panel",
    permissions: ["fs.write"],
    fs: { write: { scope: ["out/**"] } },
  });

  // No plugin code involved: the host channel is reached directly, the way a
  // panel page calls it.
  const result = await runtime.invokePanelBridge("fs.binary.panel", "fs.writeBase64", {
    path: "out/panel.xlsx",
    base64: BINARY.toString("base64"),
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.bytes, BINARY.length);
  assert.equal(result.path, "out/panel.xlsx");
  assert.deepEqual(readFileSync(join(ws, "out/panel.xlsx")), BINARY);
});

test("a base64 write outside the declared scope is refused and writes nothing", async (t) => {
  const { runtime, ws } = await harness(t, {
    id: "fs.binary.scoped",
    permissions: ["fs.write"],
    fs: { write: { scope: ["out/**"] } },
  });

  const result = await write(runtime, "fs.binary.scoped", "notes.txt", BINARY.toString("base64"));
  assert.equal(result.ok, false);
  assert.equal(result.code, "PERMISSION_DENIED");
  assert.match(result.message, /outside manifest\.fs\.write\.scope: notes\.txt/);
  assert.equal(readFileSync(join(ws, "notes.txt"), "utf8"), "notes");
});

test("a base64 write without the fs.write permission is refused", async (t) => {
  // No `fs` block at all: a manifest that declares a write scope without the
  // permission is refused at load, so the missing permission is what is left to
  // observe at call time.
  const { runtime, ws } = await harness(t, {
    id: "fs.binary.denied",
    permissions: ["fs.read"],
  });

  const result = await write(runtime, "fs.binary.denied", "out/report.docx", BINARY.toString("base64"));
  assert.equal(result.ok, false);
  assert.equal(result.code, "PERMISSION_DENIED");
  assert.match(result.message, /missing permission: fs\.write/);
  assert.equal(existsSync(join(ws, "out/report.docx")), false);
});

test("invalid base64 is refused instead of being decoded to a short file", async (t) => {
  const { runtime, ws, audits } = await harness(t, {
    id: "fs.binary.invalid",
    permissions: ["fs.write"],
    fs: { write: { scope: ["out/**"] } },
  });

  // Characters outside the alphabet, a length that is not a whole group, a
  // non-string, and the empty payload that would otherwise create a 0-byte
  // file. Every one of them has to fail before anything touches the disk.
  for (const [index, base64] of ["@@@@", "abc", 12345, null, ""].entries()) {
    const path = `out/broken-${index}.docx`;
    const result = await write(runtime, "fs.binary.invalid", path, base64);
    assert.equal(result.ok, false, `${JSON.stringify(base64)} must be refused`);
    assert.equal(result.code, "INVALID_ARGUMENT", `${JSON.stringify(base64)}: ${result.message}`);
    assert.equal(existsSync(join(ws, path)), false, `${JSON.stringify(base64)} must not create a file`);
  }
  assert.ok(
    audits.some((entry) => entry.api === "fs.write" && entry.errorCode === "INVALID_ARGUMENT"),
    "a refused payload is audited too",
  );
});

test("a payload above the byte cap is refused without writing", async (t) => {
  const { runtime, ws } = await harness(t, {
    id: "fs.binary.cap",
    permissions: ["fs.write"],
    fs: { write: { scope: ["out/**"] } },
  });

  const oversize = Buffer.alloc(MAX_FS_WRITE_BYTES + 1).toString("base64");
  const result = await write(runtime, "fs.binary.cap", "out/huge.pptx", oversize);
  assert.equal(result.ok, false, String(result.message));
  assert.equal(result.code, "INVALID_ARGUMENT", String(result.message));
  assert.match(result.message, new RegExp(`exceeds the ${MAX_FS_WRITE_BYTES}-byte write limit`));
  assert.equal(existsSync(join(ws, "out/huge.pptx")), false);
});

test("a generated document stays the plugin's own for fs.delete", async (t) => {
  const { runtime, ws, trashed } = await harness(t, {
    id: "fs.binary.own",
    permissions: ["fs.write", "fs.delete"],
    fs: { write: { scope: ["out/**"] }, delete: { own: true } },
  });

  const written = await write(runtime, "fs.binary.own", "out/report.docx", BINARY.toString("base64"));
  assert.equal(written.ok, true, written.message);

  // The delete scope is empty, so only the write ledger can authorize this:
  // if `recordWrite` were skipped the call would fall to consent and fail.
  const removed = await runtime.invokePanelBridge("fs.binary.own", "remove", {
    path: "out/report.docx",
  });
  assert.equal(removed.ok, true, removed.message);
  // The ledger holds the native path; compare on one separator spelling so the
  // assertion holds on Windows too.
  assert.deepEqual(
    trashed.map((path) => path.replace(/\\/g, "/").endsWith("out/report.docx")),
    [true],
  );
});
