#!/usr/bin/env node
/**
 * The seven gates from the plan, run as one command so a queue entry can quote
 * a single verbatim result.
 *
 * Every gate is independent: one failing gate does not stop the others, because
 * the report needs to say what is broken, not just that something is. Exit code
 * is 1 if any gate failed.
 *
 * Usage:
 *   node scripts/run-gates.mjs              # desktop + styles + types
 *   node scripts/run-gates.mjs --all        # also shared, agent-runtime, i18n, host-core
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const all = process.argv.includes("--all");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok ? "ok  " : "FAIL";
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ""}`);
}

function run(command, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    // Only cmd shims need a shell. Routing node.exe through one breaks as soon
    // as the install path contains a space.
    shell: options.shell ?? false,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    ms: Date.now() - started,
  };
}

/** Last matching line, so a passing run reports counts instead of the log. */
function tail(output, pattern) {
  const lines = output.split(/\r?\n/).filter((line) => pattern.test(line));
  return lines.length > 0 ? lines[lines.length - 1].trim() : "";
}

const desktop = join(root, "apps", "desktop");

// 1. Desktop suite. The file list is expanded here instead of by the shell so
//    the same script works from PowerShell and from a bare `node`.
const testFiles = readdirSync(join(desktop, "test"))
  .filter((name) => name.endsWith(".test.mjs"))
  .map((name) => join("test", name));
{
  const { status, output, ms } = run(process.execPath, ["--test", ...testFiles], {
    cwd: desktop,
  });
  const summary = [
    tail(output, /^ℹ tests /),
    tail(output, /^ℹ pass /),
    tail(output, /^ℹ fail /),
  ]
    .filter(Boolean)
    .join(" · ");
  record("desktop node --test", status === 0, `${summary} (${(ms / 1000).toFixed(1)}s)`);
  if (status !== 0) {
    console.log(output.split(/\r?\n/).filter((line) => /✖|not ok/.test(line)).slice(0, 12).join("\n"));
  }
}

// 2. Style tokens.
{
  const { status, output } = run(process.execPath, ["scripts/check-style-tokens.mjs"]);
  record("style tokens", status === 0, status === 0 ? "clean" : tail(output, /./));
}

// 3. Types.
{
  const { status, output } = run(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsc", "-p", "tsconfig.json", "--noEmit"],
    { cwd: desktop, shell: true },
  );
  record("tsc --noEmit", status === 0, status === 0 ? "clean" : output.slice(0, 800));
}

if (all) {
  for (const [name, cwd] of [
    ["shared vitest", "packages/shared"],
    ["agent-runtime vitest", "packages/agent-runtime"],
    ["i18n vitest", "packages/i18n"],
  ]) {
    const { status, output } = run(pnpm, ["test"], {
      cwd: join(root, cwd),
      shell: true,
    });
    const summary = [
      tail(output, /Tests\s/),
      tail(output, /Test Files/),
    ]
      .filter(Boolean)
      .join(" · ");
    record(name, status === 0, summary || (status === 0 ? "clean" : output.slice(0, 400)));
  }
  {
    const { status, output } = run("cargo", ["test", "-p", "host-core"]);
    record("cargo host-core", status === 0, tail(output, /test result:/));
  }
}

const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log(
  failed.length === 0
    ? `all ${results.length} gates passed`
    : `${failed.length} of ${results.length} gates failed: ${failed.map((entry) => entry.name).join(", ")}`,
);
process.exit(failed.length === 0 ? 0 : 1);
