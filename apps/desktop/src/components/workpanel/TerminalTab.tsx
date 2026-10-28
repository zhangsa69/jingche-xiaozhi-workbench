import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFollowScroll } from "../../hooks/use-follow-scroll";
import { locateTranscriptMessage } from "../../lib/locate-message";
import {
  terminalEntries,
  terminalState,
  terminalText,
} from "../../lib/terminal-log";
import { formatToolDuration } from "../../lib/tool-display";
import { useAppStore } from "../../stores/app-store";
import { IconArrowDown, IconExternal, IconTerminalSquare } from "../icons";
import { TooltipButton } from "../ui";
import { WorkTabEmpty } from "./WorkTabEmpty";

/**
 * W-15: every command this session ran, in one scrolling stream.
 *
 * Read-only on purpose. The rows are a projection of the transcript — the same
 * tool calls the chat already shows — so the panel needs no process, no channel,
 * and nothing of its own to persist; it exists so a run can be read end to end
 * without hunting for the collapsed tool rows between messages.
 *
 * It is not a shell: no stdin, no prompts, no resize. Those need a pty and a
 * permission model for arbitrary input, which is a different feature with a
 * different threat model rather than a bigger version of this one.
 */
export function TerminalTab() {
  const { t } = useTranslation();
  const messages = useAppStore((state) => state.messages);
  const showToast = useAppStore((state) => state.showToast);
  const entries = useMemo(() => terminalEntries(messages), [messages]);
  const { scrollRef, contentRef, showJump, handleScroll, jumpToLatest } =
    useFollowScroll();

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(terminalText(entries));
      showToast(t("chat.copied"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    }
  };

  if (entries.length === 0) {
    return (
      <WorkTabEmpty
        icon={IconTerminalSquare}
        title={t("panel.terminal.empty")}
        body={t("panel.terminal.emptyHint")}
      />
    );
  }

  return (
    <div className="terminal-tab">
      <div className="terminal-toolbar">
        <span className="terminal-count">
          {t("panel.terminal.count", { commands: entries.length })}
        </span>
        <button type="button" className="terminal-copy" onClick={copyAll}>
          {t("panel.terminal.copyAll")}
        </button>
      </div>
      <div className="terminal-body">
        {/*
          `aria-live` stays off: a command stream can drop hundreds of lines in a
          second, and the transcript already announces runs. The region is still
          a log, so it can be navigated as one.
        */}
        <div
          className="terminal-list"
          role="log"
          aria-live="off"
          ref={scrollRef}
          onScroll={handleScroll}
        >
          <div className="terminal-entries" ref={contentRef}>
            {entries.map((entry, index) => {
              const state = terminalState(entry.outcome);
              return (
                <div className="terminal-entry" key={entry.id || index}>
                  <div className="terminal-command">
                    <span className="terminal-prompt" aria-hidden>
                      $
                    </span>
                    <code className="terminal-command-text">{entry.command}</code>
                    {state && (
                      <span className={`terminal-state is-${state}`}>
                        {t(`panel.terminal.${state}`)}
                      </span>
                    )}
                    {entry.exitCode !== null && entry.exitCode !== 0 && (
                      <span className="terminal-exit">
                        {t("panel.terminal.exit", { code: entry.exitCode })}
                      </span>
                    )}
                    {entry.durationMs !== null && (
                      <span className="terminal-duration">
                        {formatToolDuration(entry.durationMs / 1000)}
                      </span>
                    )}
                    {entry.id && (
                      <TooltipButton
                        className="terminal-open"
                        tooltip={t("panel.terminal.openInChat")}
                        ariaLabel={t("panel.terminal.openInChat")}
                        onClick={() => locateTranscriptMessage(entry.id)}
                      >
                        <IconExternal size={12} />
                      </TooltipButton>
                    )}
                  </div>
                  {entry.stdout !== "" && (
                    <pre className="terminal-output">{entry.stdout}</pre>
                  )}
                  {entry.stderr !== "" && (
                    <>
                      {/* Labelled even when it stands alone: stderr is not
                          stdout, and the difference is often the diagnosis. */}
                      <span className="terminal-stream-label">
                        {t("panel.terminal.stderr")}
                      </span>
                      <pre className="terminal-output is-stderr">
                        {entry.stderr}
                      </pre>
                    </>
                  )}
                  {entry.notices.map((notice, noticeIndex) => (
                    <p
                      className="terminal-notice"
                      key={`${entry.id || index}-notice-${noticeIndex}`}
                    >
                      {notice}
                    </p>
                  ))}
                  {entry.omittedChars > 0 && (
                    <p className="terminal-notice">
                      {t("panel.terminal.clipped", { chars: entry.omittedChars })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {showJump && (
          <button
            type="button"
            className="jump-latest-btn"
            onClick={jumpToLatest}
            aria-label={t("panel.terminal.jump")}
          >
            <IconArrowDown size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
