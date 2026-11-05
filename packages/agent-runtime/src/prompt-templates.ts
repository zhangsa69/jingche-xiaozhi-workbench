/**
 * Bridge to pi's prompt-template ("slash command") system for the composer
 * (D123, ADR 0024). Loading and expansion reuse pi-agent-core verbatim so
 * `.pi/prompts` assets behave identically in pi CLI and PI-Desktop.
 *
 * Discovery: `<workspace>/.pi/prompts/*.md` (project) and
 * `~/.pi/agent/prompts/*.md` (user-global); project wins name conflicts.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  BACKGROUND_CONTEXT,
  loadSourcedPromptTemplates,
  parseCommandArgs,
  substituteArgs,
  type PromptTemplate,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

/**
 * Static prompt for Composer's one-shot draft enhancement (D430).
 *
 * The earlier wording — "clearer, more concise", "preserving the original
 * meaning, intent, tone", "at most minor polish" — described proofreading, so
 * models returned the draft with a comma moved: the prompt itself licensed the
 * smallest possible edit. It now asks for a prompt engineer's rewrite, states
 * what a rewrite must add, and names a synonym-level edit a failure.
 */
export const PROMPT_ENHANCEMENT_SYSTEM_PROMPT = `You are a prompt engineer. Turn the user's draft into the prompt they should
have written: a complete, specific, executable instruction for an AI assistant.
Write the rewrite in the draft's own language.

Keep the user's real goal, subject, language, and every concrete detail the
draft already carries.

Add what the draft leaves implicit:
- the role or perspective the assistant should take;
- the concrete deliverable and who it is for;
- the constraints and acceptance criteria that follow from the request;
- the output shape (sections, list, table, code, document outline) whenever the
  shape matters;
- explicit placeholders such as [audience] or [deadline] where a fact is
  missing, instead of inventing names, numbers, dates, or sources.

Turn vague wording ("better", "professional", "some ideas") into checkable
requirements.

A synonym swap, a grammar fix, or a punctuation change is a failure, not a
result. Unless the draft already states the role, the deliverable, the
constraints, and the output shape, the rewrite must be materially more complete
than the draft — typically 1.5 to 3 times its length — and never a shortened
summary.

Output only the rewritten prompt — no explanations, no preamble, no code
fences, no quotation marks, no lead-in such as "Here is".`;

export const PROMPT_ENHANCEMENT_USER_PREFIX = "Draft:\n";

export type ComposerTemplateSource = "project" | "user";

export type ComposerTemplate = PromptTemplate & {
  source: ComposerTemplateSource;
  /** Frontmatter `argument-hint`, e.g. "<file> [focus]". */
  argumentHint?: string;
};

export type ComposerTemplateDirs = {
  project?: string;
  user: string;
};

function normalizeTemplateName(name: string): string {
  const normalized = name.replace(/\\/g, "/").replace(/\/+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  const basename = slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
  return basename.replace(/\.md$/i, "");
}

/** Template directories for a workspace (project dir absent without one). */
export function composerTemplateDirs(
  workspaceRoot: string | null | undefined,
): ComposerTemplateDirs {
  return {
    ...(workspaceRoot ? { project: join(workspaceRoot, ".pi", "prompts") } : {}),
    user: join(homedir(), ".pi", "agent", "prompts"),
  };
}

/**
 * pi's loader keeps only name/description/content; `argument-hint` needs a
 * second look at the file's frontmatter block. Missing/unreadable files are
 * non-fatal — the hint is cosmetic.
 */
async function readArgumentHint(filePath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!normalized.startsWith("---")) return undefined;
    const end = normalized.indexOf("\n---", 3);
    if (end === -1) return undefined;
    const frontmatter = normalized.slice(4, end);
    const match = frontmatter.match(/^argument-hint:[ \t]*(.+)$/m);
    if (!match) return undefined;
    const value = match[1].trim().replace(/^["']|["']$/g, "");
    return value || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Load the merged template list for the composer "/" menu. Project templates
 * shadow user-global templates with the same name. Load failures degrade to
 * diagnostics, never throw.
 */
export async function loadComposerTemplates(
  workspaceRoot: string | null | undefined,
  overrideDirs?: ComposerTemplateDirs,
): Promise<{ templates: ComposerTemplate[]; diagnostics: string[] }> {
  const dirs = overrideDirs ?? composerTemplateDirs(workspaceRoot);
  const env = new NodeExecutionEnv({ cwd: workspaceRoot || homedir() });
  const inputs: Array<{ path: string; source: ComposerTemplateSource }> = [
    ...(dirs.project ? [{ path: dirs.project, source: "project" as const }] : []),
    { path: dirs.user, source: "user" as const },
  ];
  const loaded = await loadSourcedPromptTemplates(
    env,
    inputs,
    undefined,
    BACKGROUND_CONTEXT,
  );

  const byName = new Map<string, ComposerTemplate>();
  for (const { promptTemplate, source } of loaded.promptTemplates) {
    // Inputs are ordered project-first, so the first occurrence wins.
    const name = normalizeTemplateName(promptTemplate.name);
    if (byName.has(name)) continue;
    const dir = source === "project" ? dirs.project : dirs.user;
    const argumentHint = dir
      ? await readArgumentHint(join(dir, `${name}.md`))
      : undefined;
    byName.set(name, {
      ...promptTemplate,
      name,
      source,
      ...(argumentHint ? { argumentHint } : {}),
    });
  }
  return {
    templates: [...byName.values()],
    diagnostics: loaded.diagnostics.map(
      (d) => `${d.source}:${d.code}: ${d.message} (${d.path})`,
    ),
  };
}

const PLACEHOLDER_RE = /\$\d+|\$\{@:\d+(?::\d+)?\}|\$ARGUMENTS|\$@/;

export type SlashExpansion = {
  /** Expanded prompt text the model receives (persisted as `content`). */
  expanded: string;
  /** The typed invocation, e.g. "/review src/a.ts" (persisted as `command`). */
  command: string;
};

/**
 * Expand a leading `/name args` invocation against loaded templates using
 * pi's exact argument grammar. Returns null when the draft is not a
 * template invocation (unknown names stay literal text, D123).
 *
 * One deliberate extension over pi: when a template has no placeholder at
 * all, non-empty arguments are appended after a blank line instead of being
 * silently dropped.
 */
export function expandSlashInvocation(
  content: string,
  templates: ReadonlyArray<Pick<ComposerTemplate, "name" | "content">>,
): SlashExpansion | null {
  if (!content.startsWith("/")) return null;
  const tokenEnd = content.search(/[\s]/);
  const token = tokenEnd === -1 ? content : content.slice(0, tokenEnd);
  const name = token.slice(1);
  if (!name) return null;
  const template = templates.find((t) => t.name === name);
  if (!template) return null;

  const rest = (tokenEnd === -1 ? "" : content.slice(tokenEnd)).trim();
  // parseCommandArgs only splits on spaces/tabs; fold newlines in first.
  const args = parseCommandArgs(rest.replace(/[\n\r]+/g, " "));
  let expanded = substituteArgs(template.content, args);
  if (rest && !PLACEHOLDER_RE.test(template.content)) {
    expanded = `${expanded}\n\n${rest}`;
  }
  return { expanded, command: content.trim() };
}

export { parseCommandArgs, substituteArgs };
export type { PromptTemplate };
