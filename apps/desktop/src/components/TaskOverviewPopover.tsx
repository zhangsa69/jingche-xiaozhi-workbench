import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { UiMessage } from "@pi-desktop/shared";
import { useAppStore } from "../stores/app-store";
import {
  placeContextInspector,
  type ContextInspectorPlacement,
} from "../lib/context-inspector-position";
import { formatToolDuration } from "../lib/tool-display";
import { fileWorkPanelTab } from "../lib/work-panel-tabs";
import { reviewChangesFromMessages } from "../lib/workspace-review";
import { IconListChecks } from "./icons";
import { TooltipButton } from "./ui";

/** One file the agent wrote to during this task, newest change wins. */
export type TaskArtifact = {
  path: string;
  additions: number;
  deletions: number;
};

/** One tool call, shaped for the "task progress" list. */
export type TaskProgressRow = {
  id: string;
  /** 1-based position in the whole task, so a truncated list keeps real numbers. */
  index: number;
  name: string;
  running: boolean;
  durationMs?: number;
};

const PROGRESS_ROWS = 6;

/**
 * Collect the files this task produced.
 *
 * "Artifact" here means a workspace write the transcript can prove: the review
 * record embedded in a successful `Write`/`Edit` message. Rolled-back changes
 * are excluded — the file's current state no longer matches them.
 */
export function collectTaskArtifacts(messages: UiMessage[]): TaskArtifact[] {
  const byPath = new Map<string, TaskArtifact>();
  for (const entry of reviewChangesFromMessages(messages)) {
    const { change } = entry;
    if (change.state !== "active") continue;
    byPath.set(change.path, {
      path: change.path,
      additions: change.additions,
      deletions: change.deletions,
    });
  }
  return [...byPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

/** The tail of the tool calls, with their task-wide positions preserved. */
export function collectTaskProgress(messages: UiMessage[]): {
  total: number;
  rows: TaskProgressRow[];
} {
  const toolMessages = messages.filter((message) => message.role === "tool");
  const start = Math.max(0, toolMessages.length - PROGRESS_ROWS);
  const rows = toolMessages.slice(start).map((message, offset) => ({
    id: message.id,
    index: start + offset + 1,
    name: message.toolName || "tool",
    running: message.toolStatus === "running",
    ...(typeof message.toolDurationMs === "number"
      ? { durationMs: message.toolDurationMs }
      : {}),
  }));
  return { total: toolMessages.length, rows };
}

/**
 * Wall-clock time this task has been worked on: first message to the end of the
 * last one. `now` is supplied only while a run is in flight, so a finished task
 * keeps a frozen figure instead of drifting every second.
 */
export function taskWorkSeconds(
  messages: UiMessage[],
  now?: number | null,
): number | null {
  const first = messages[0]?.createdAt;
  const startedAt = first ? Date.parse(first) : Number.NaN;
  if (!Number.isFinite(startedAt)) return null;
  if (typeof now === "number") {
    return Math.max(0, Math.floor((now - startedAt) / 1000));
  }
  const endedAt = messages.reduce((latest, message) => {
    const created = Date.parse(message.createdAt) || 0;
    if (!created) return latest;
    const end = created + (message.responseDurationMs ?? message.toolDurationMs ?? 0);
    return end > latest ? end : latest;
  }, startedAt);
  return Math.max(0, Math.floor((endedAt - startedAt) / 1000));
}

/** Keep the tail of a long workspace path; the popover is narrow. */
function shortPath(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : path;
}

/**
 * W-03: the task overview behind the top bar's checklist icon — what this task
 * has produced and where it is in its run. The artifact rows open the file in
 * the work panel, so the popover doubles as the entry point to the output.
 */
export function TaskOverviewPopover() {
  const { t } = useTranslation();
  const panelId = useId();
  const messages = useAppStore((state) => state.messages);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const running = useAppStore((state) =>
    activeSessionId ? Boolean(state.runningSessions[activeSessionId]) : false,
  );
  const openWorkPanelTab = useAppStore((state) => state.openWorkPanelTab);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<ContextInspectorPlacement | null>(
    null,
  );
  const [now, setNow] = useState(Date.now);

  const artifacts = useMemo(() => collectTaskArtifacts(messages), [messages]);
  const progress = useMemo(() => collectTaskProgress(messages), [messages]);
  const elapsed = taskWorkSeconds(messages, running && open ? now : null);

  const close = useCallback(() => {
    setOpen(false);
    setPlacement(null);
  }, []);

  const toggle = useCallback(() => {
    setOpen((previous) => {
      if (previous) setPlacement(null);
      return !previous;
    });
  }, []);

  // Only a running task needs a moving clock, and only while the panel is open.
  useEffect(() => {
    if (!open || !running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open, running]);

  const updatePlacement = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;
    const triggerRect = trigger.getBoundingClientRect();
    if (triggerRect.bottom <= 0 || triggerRect.top >= window.innerHeight) {
      close();
      return;
    }
    const popoverRect = popover.getBoundingClientRect();
    const paneRect = trigger.closest(".main-pane")?.getBoundingClientRect();
    const next = placeContextInspector({
      trigger: {
        left: triggerRect.left,
        top: triggerRect.top,
        bottom: triggerRect.bottom,
      },
      popover: { width: popoverRect.width, height: popoverRect.height },
      pane: paneRect ? { left: paneRect.left, right: paneRect.right } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    if (!next) {
      close();
      return;
    }
    setPlacement((previous) =>
      previous?.top === next.top &&
      previous.left === next.left &&
      previous.maxWidth === next.maxWidth
        ? previous
        : next,
    );
  }, [close]);

  useLayoutEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(updatePlacement);
    return () => window.cancelAnimationFrame(frame);
  }, [open, artifacts.length, progress.total, updatePlacement]);

  useEffect(() => {
    if (!open) return;
    const handleViewportChange = () => updatePlacement();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, updatePlacement]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, open]);

  const openArtifact = useCallback(
    (path: string) => {
      openWorkPanelTab(fileWorkPanelTab(path));
      close();
    },
    [close, openWorkPanelTab],
  );

  const panel = open ? (
    <div
      ref={popoverRef}
      id={panelId}
      role="dialog"
      aria-label={t("chat.overviewTitle", {
        defaultValue: "Task overview",
      })}
      className={`task-overview-popover${placement ? " is-open" : ""}`}
      style={
        placement
          ? {
              top: `${placement.top}px`,
              left: `${placement.left}px`,
              maxWidth: `${placement.maxWidth}px`,
            }
          : undefined
      }
    >
      <div className="task-overview-status">
        <span
          className={`task-overview-dot${running ? " is-running" : ""}`}
          aria-hidden
        />
        <span className="task-overview-state">
          {running ? t("nav.sessionRunning") : t("nav.sessionCompleted")}
        </span>
        {elapsed !== null ? (
          <span className="task-overview-elapsed">
            {t("chat.overviewElapsed", {
              time: formatToolDuration(elapsed),
              defaultValue: "Elapsed {{time}}",
            })}
          </span>
        ) : null}
      </div>

      <section className="task-overview-section">
        <header className="task-overview-section-head">
          <strong>
            {t("chat.overviewArtifacts", { defaultValue: "Artifacts" })}
          </strong>
          <span className="task-overview-count">{artifacts.length}</span>
        </header>
        {artifacts.length === 0 ? (
          <p className="task-overview-empty">
            {t("chat.overviewNoArtifacts", {
              defaultValue: "No artifact files yet",
            })}
          </p>
        ) : (
          <ul className="task-overview-list">
            {artifacts.map((artifact) => (
              <li key={artifact.path}>
                <button
                  type="button"
                  className="task-overview-artifact"
                  title={artifact.path}
                  onClick={() => openArtifact(artifact.path)}
                >
                  <span className="task-overview-artifact-path">
                    {shortPath(artifact.path)}
                  </span>
                  <span className="task-overview-artifact-counts diff-counts">
                    <span className="diff-count-add">+{artifact.additions}</span>
                    <span className="diff-count-del">−{artifact.deletions}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="task-overview-section">
        <header className="task-overview-section-head">
          <strong>{t("chat.overviewSteps", { defaultValue: "Progress" })}</strong>
          <span className="task-overview-count">
            {t("chat.overviewToolCalls", {
              count: progress.total,
              defaultValue: "{{count}} calls",
            })}
          </span>
        </header>
        {progress.rows.length === 0 ? (
          <p className="task-overview-empty">
            {t("chat.overviewNoSteps", {
              defaultValue: "No steps yet",
            })}
          </p>
        ) : (
          <ol className="task-overview-list">
            {progress.rows.map((row) => (
              <li key={row.id} className="task-overview-step">
                <span className="task-overview-step-index">#{row.index}</span>
                <span className="task-overview-step-name">{row.name}</span>
                {row.running ? (
                  <span className="task-overview-step-state is-running">
                    {t("nav.sessionRunning")}
                  </span>
                ) : row.durationMs !== undefined ? (
                  <span className="task-overview-step-state">
                    {formatToolDuration(row.durationMs / 1000)}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  ) : null;

  return (
    <div className="task-overview">
      <TooltipButton
        ref={triggerRef}
        type="button"
        className="ct-icon-btn ct-overview-btn"
        tooltip={t("chat.overviewTitle", { defaultValue: "Task overview" })}
        ariaLabel={t("chat.overviewTitle", { defaultValue: "Task overview" })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
      >
        <IconListChecks size={15} />
        {artifacts.length > 0 ? (
          <span className="ct-overview-badge" aria-hidden>
            {artifacts.length > 99 ? "99+" : artifacts.length}
          </span>
        ) : null}
      </TooltipButton>
      {panel ? createPortal(panel, document.body) : null}
    </div>
  );
}
