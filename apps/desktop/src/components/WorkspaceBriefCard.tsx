import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import {
  rememberWorkspaceBrief,
  shouldShowWorkspaceBrief,
  workspaceBrief,
  type WorkspaceBriefRowId,
} from "../lib/workspace-grant";
import { normalizeProjectPath } from "../lib/sidebar-preferences";

/** Dismissals are per folder and survive restarts; this is a reminder, not a run flag. */
const STORAGE_KEY = "pi.workspace-brief.dismissed";

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function writeDismissed(keys: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // A full or blocked storage only costs us the reminder; never the task.
  }
}

/**
 * One-paragraph answer to "what happens if I press send here": where output
 * lands, what gets read, and what never leaves the machine.
 *
 * Shown once per folder on the empty chat home and dismissed into storage, so a
 * returning user is not re-taught their own workspace.
 */
export function WorkspaceBriefCard() {
  const { t } = useTranslation();
  const workspace = useAppStore((state) => state.workspace);
  const activeSession = useAppStore((state) =>
    state.activeSessionId
      ? state.sessions.find((session) => session.id === state.activeSessionId)
      : undefined,
  );
  const openProject = useAppStore((state) => state.openProject);
  const newSession = useAppStore((state) => state.newSession);

  const [dismissed, setDismissed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  const brief = workspaceBrief({
    projectPath: activeSession?.projectPath,
    fallbackPath: workspace?.path,
  });

  const dismiss = useCallback(() => {
    const next = rememberWorkspaceBrief(dismissed, brief);
    setDismissed(next);
    writeDismissed(next);
  }, [brief, dismissed]);

  const chooseFolder = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const previous = normalizeProjectPath(
      useAppStore.getState().workspace?.path,
    );
    try {
      await openProject();
      const nextPath = useAppStore.getState().workspace?.path;
      const nextKey = normalizeProjectPath(nextPath);
      if (nextPath && nextKey && nextKey !== previous) {
        await newSession({ projectPath: nextPath });
      }
    } finally {
      setBusy(false);
    }
  }, [busy, newSession, openProject]);

  if (!shouldShowWorkspaceBrief(brief, dismissed)) return null;

  const rowText: Record<WorkspaceBriefRowId, string> = {
    writes: brief.location
      ? t("workspaceBrief.writesProject", { path: brief.location })
      : t("workspaceBrief.writesNone"),
    reads: t("workspaceBrief.reads"),
    keeps: t("workspaceBrief.keeps"),
  };

  return (
    <div
      className="home-workspace-brief mx-auto w-full max-w-[560px] rounded-lg-plus border border-border-subtle bg-bg-elevated-opaque p-4 text-left shadow-none"
      data-testid="workspace-brief"
      data-brief-kind={brief.kind}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-md-plus font-medium text-text-primary">
            {t("workspaceBrief.title")}
          </div>
          <p className="mt-0.5 text-xs-plus leading-relaxed text-text-muted">
            {brief.location
              ? t("workspaceBrief.subtitleProject", { path: brief.location })
              : t("workspaceBrief.subtitleNone")}
          </p>
        </div>
        <button
          type="button"
          className="flex-none rounded-md px-1.5 py-0.5 text-xs-plus text-text-muted hover:bg-bg-hover hover:text-text-primary"
          onClick={dismiss}
        >
          {t("workspaceBrief.dismiss")}
        </button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {brief.rows.map((id) => (
          <li
            key={id}
            className="flex gap-2.5 text-md text-text-secondary"
            data-brief-row={id}
          >
            <span aria-hidden className="mt-[7px] h-1 w-1 flex-none rounded-full bg-text-muted" />
            <span className="leading-relaxed">{rowText[id]}</span>
          </li>
        ))}
      </ul>
      {brief.needsFolder ? (
        <button
          type="button"
          className="mt-3 rounded-md border border-border-subtle px-2.5 py-1 text-xs-plus text-text-primary hover:bg-bg-hover disabled:opacity-60"
          onClick={() => void chooseFolder()}
          disabled={busy}
          data-testid="workspace-brief-choose"
        >
          {t("workspaceBrief.choose")}
        </button>
      ) : null}
    </div>
  );
}
