/**
 * The in-app privacy page is generated from this list instead of being written
 * as prose, so the two columns cannot drift apart and a future data path has one
 * obvious place to be declared.
 *
 * Keys are spelled out in full: the page renders them directly, and
 * `test/privacy-manifest.test.mjs` resolves each one against the eight shipped
 * locales, which turns a renamed key into a failing test rather than a raw
 * `settings.privacyTopic.prompt` on screen.
 */

export type PrivacyRowId =
  | "prompt"
  | "tools"
  | "files"
  | "credentials"
  | "usage"
  | "telemetry";

export type PrivacyRow = {
  id: PrivacyRowId;
  /** Row header: the kind of data being compared. */
  topicKey: string;
  /** What that data does as part of a request to the selected provider. */
  upstreamKey: string;
  /** What stays in the local data directory. */
  localKey: string;
};

function row(id: PrivacyRowId): PrivacyRow {
  return {
    id,
    topicKey: `settings.privacyTopic.${id}`,
    upstreamKey: `settings.privacyUpstream.${id}`,
    localKey: `settings.privacyLocal.${id}`,
  };
}

/**
 * Screen order: what you type, what tools bring back, what files are read, then
 * the three promises (credentials, usage counters, telemetry). Boring facts
 * first, guarantees last — a user scanning for "does my key leave" finds it
 * without reading the table top to bottom.
 */
export const PRIVACY_ROWS: readonly PrivacyRow[] = [
  row("prompt"),
  row("tools"),
  row("files"),
  row("credentials"),
  row("usage"),
  row("telemetry"),
];
