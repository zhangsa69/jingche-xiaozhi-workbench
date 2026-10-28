/**
 * `#` references to earlier conversations (W-30).
 *
 * A reference is written into the draft as `#"Title"` — visible, editable, and
 * parsed at send time. What leaves the composer is a short quoted block naming
 * those conversations and, when the transcript is still in memory, the tail of
 * what that conversation last said. Nothing is summarised: a summary invented
 * at reference time would be a claim the user never saw.
 */

/** How many references one draft may carry. */
export const MAX_CONTEXT_REFERENCES = 6;
/** Characters of a referenced conversation the quote may carry. */
export const MAX_CONTEXT_EXCERPT_CHARS = 300;
/** Characters the whole quoted block may add to one prompt. */
export const MAX_CONTEXT_BLOCK_CHARS = 1_200;

export type ContextReferenceCandidate = {
  id: string;
  title: string;
  messageCount: number;
  /** Tail of the last assistant turn, when the transcript is still loaded. */
  excerpt?: string;
};

export type ContextReferenceSession = {
  id: string;
  title: string;
  messageCount: number;
};

const TOKEN = /#"([^"\n]{1,160})"/g;

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/** Token as written into the draft. */
export function contextReferenceToken(title: string): string {
  return `#"${title.trim()}"`;
}

/**
 * Candidate list for the `#` menu: substrings of the title, most recent first
 * as given, with the conversation being written in excluded — a reference to
 * itself would just restate the draft.
 */
export function contextReferenceCandidates(
  sessions: readonly ContextReferenceSession[],
  query: string,
  options: { excludeId?: string | null; limit?: number } = {},
): ContextReferenceCandidate[] {
  const limit = Math.max(0, options.limit ?? MAX_CONTEXT_REFERENCES);
  const needle = normalize(query);
  const seen = new Set<string>();
  const rows: ContextReferenceCandidate[] = [];
  for (const session of sessions) {
    if (limit && rows.length >= limit) break;
    if (!session.id || session.id === options.excludeId) continue;
    const title = session.title.trim();
    if (!title || seen.has(session.id)) continue;
    if (needle && !normalize(title).includes(needle)) continue;
    seen.add(session.id);
    rows.push({
      id: session.id,
      title,
      messageCount: session.messageCount,
    });
  }
  return rows;
}

/**
 * Resolve the tokens in a draft. Unknown titles are dropped rather than guessed:
 * `#"typo"` is the user's unfinished thought, not consent to quote whatever
 * looked closest.
 */
export function findContextReferences(
  text: string,
  sessions: readonly ContextReferenceSession[],
  options: { excludeId?: string | null; limit?: number } = {},
): ContextReferenceCandidate[] {
  const limit = Math.max(0, options.limit ?? MAX_CONTEXT_REFERENCES);
  const byTitle = new Map<string, ContextReferenceSession>();
  for (const session of sessions) {
    if (!session.id || session.id === options.excludeId) continue;
    const key = normalize(session.title);
    if (key && !byTitle.has(key)) byTitle.set(key, session);
  }
  const seen = new Set<string>();
  const refs: ContextReferenceCandidate[] = [];
  for (const match of text.matchAll(TOKEN)) {
    if (limit && refs.length >= limit) break;
    const session = byTitle.get(normalize(match[1]));
    if (!session || seen.has(session.id)) continue;
    seen.add(session.id);
    refs.push({
      id: session.id,
      title: session.title.trim(),
      messageCount: session.messageCount,
    });
  }
  return refs;
}

/** One line per reference plus its quote, capped as a whole. */
export function buildContextReferenceBlock(
  refs: readonly ContextReferenceCandidate[],
): string {
  if (!refs.length) return "";
  const parts: string[] = [];
  let budget = MAX_CONTEXT_BLOCK_CHARS;
  const header =
    "The draft above references earlier conversations in this workspace. " +
    "Read the quotes as excerpts, not as summaries; ask for the rest instead of guessing.";
  budget -= header.length;
  for (const ref of refs) {
    const count = ref.messageCount === 1 ? "1 message" : `${ref.messageCount} messages`;
    let line = `- "${ref.title}" (${count})`;
    const excerpt = (ref.excerpt ?? "").replace(/\s+/g, " ").trim();
    if (excerpt) {
      const room = Math.min(MAX_CONTEXT_EXCERPT_CHARS, Math.max(0, budget - line.length - 8));
      if (room > 0) line += `: "${excerpt.slice(0, room)}${excerpt.length > room ? "…" : ""}"`;
    }
    if (line.length > budget) break;
    budget -= line.length;
    parts.push(line);
  }
  if (!parts.length) return "";
  return `${header}\n${parts.join("\n")}`;
}

/**
 * Remove only the tokens that resolved. An unresolved `#"typo"` stays visible in
 * the sent text so a mistyped reference is noticed, not silently swallowed.
 */
export function stripContextReferenceTokens(
  text: string,
  titles: readonly string[],
): string {
  if (!titles.length) return text;
  const resolvable = new Set(titles.map(normalize));
  return text
    .replace(TOKEN, (token, title: string) => (resolvable.has(normalize(title)) ? "" : token))
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trimEnd())
    .join("\n");
}
