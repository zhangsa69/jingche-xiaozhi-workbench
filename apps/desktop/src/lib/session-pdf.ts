import { marked } from "marked";
import type { UiMessage } from "@pi-desktop/shared";

/** Role labels come from the caller so this stays testable without i18n. */
export type SessionPdfLabels = { user: string; assistant: string };

const STYLE = `
  @page { size: A4; margin: 16mm 14mm; }
  body {
    margin: 0;
    color: #1a1a1a;
    font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 11pt;
    line-height: 1.65;
  }
  h1 { font-size: 18pt; margin: 0 0 4pt; }
  .turn { margin: 0 0 16px; break-inside: avoid-page; }
  .who {
    margin-bottom: 2pt;
    color: #666;
    font-size: 8pt;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .prose > :first-child { margin-top: 0; }
  .prose > :last-child { margin-bottom: 0; }
  .prose h1, .prose h2, .prose h3 { font-size: 13pt; margin: 12pt 0 6pt; }
  .prose p { margin: 0 0 8pt; }
  .prose ul, .prose ol { margin: 0 0 8pt; padding-left: 18pt; }
  .prose blockquote {
    margin: 0 0 8pt;
    padding-left: 10pt;
    border-left: 2pt solid #ccc;
    color: #444;
  }
  .prose code {
    padding: 1pt 3pt;
    background: #f2f2f2;
    border-radius: 3pt;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 9.5pt;
  }
  .prose pre {
    margin: 0 0 8pt;
    padding: 8pt;
    background: #f6f6f6;
    border-radius: 4pt;
    font-size: 9pt;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .prose pre code { padding: 0; background: none; }
  .prose table { border-collapse: collapse; margin: 0 0 8pt; font-size: 10pt; }
  .prose th, .prose td { padding: 4pt 6pt; border: 0.5pt solid #ddd; text-align: left; }
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The transcript as a printable document (W-13).
 *
 * Tool rows and system notes are deliberately dropped: they are the machinery
 * behind the answer, and a PDF is what a person reads or forwards. Markdown is
 * rendered here rather than in the main process so the document the user sees
 * in the panel and the document in the file come from the same parser.
 */
export function buildSessionDocument(
  title: string,
  messages: UiMessage[],
  labels: SessionPdfLabels,
): string {
  const turns = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      text: message.content.trim(),
    }))
    .filter((turn) => turn.text.length > 0)
    .map((turn) => ({
      role: turn.role,
      html: marked.parse(turn.text, { async: false }) as string,
    }));

  const body = turns
    .map(
      (turn) =>
        `<section class="turn"><div class="who">${escapeHtml(labels[turn.role])}</div>` +
        `<div class="prose">${turn.html}</div></section>`,
    )
    .join("\n");

  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style>`,
    "</head><body>",
    `<h1>${escapeHtml(title)}</h1>`,
    body,
    "</body></html>",
  ].join("\n");
}
