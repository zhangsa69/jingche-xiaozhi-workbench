import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FsIndexEntry } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import {
  collectTaskArtifacts,
  groupTaskChanges,
  shortArtifactPath,
} from "../../lib/task-artifacts";
import { fileWorkPanelTab, toolWorkPanelTab } from "../../lib/work-panel-tabs";
import { useAppStore } from "../../stores/app-store";
import { IconArchive, IconFileText } from "../icons";
import { WorkTabEmpty } from "./WorkTabEmpty";

/**
 * The workspace index is a flat list of every file, and a panel row is cheap
 * but not free. The cap keeps a monorepo from turning the tab into a scrollbar;
 * the remainder is stated in words rather than silently dropped.
 */
const FILE_ROWS = 200;

type IndexState =
  | { status: "idle" | "loading" }
  | { status: "ready"; entries: FsIndexEntry[]; truncated: boolean }
  | { status: "error" };

/**
 * W-11: the session's output in one place. Three groups over two sources — the
 * transcript's review records (what the task wrote, what it changed) and the
 * workspace index (what else is there to open). The artifact rows deliberately
 * reuse the same derivation as the top bar's badge, so the count the user sees
 * in the popover and the count here are the same number.
 */
export function ArtifactsTab() {
  const { t } = useTranslation();
  const messages = useAppStore((state) => state.messages);
  const workspace = useAppStore((state) => state.workspace);
  const openWorkPanelTab = useAppStore((state) => state.openWorkPanelTab);

  const artifacts = useMemo(() => collectTaskArtifacts(messages), [messages]);
  const changes = useMemo(() => groupTaskChanges(messages), [messages]);
  const [index, setIndex] = useState<IndexState>({ status: "idle" });

  const workspacePath = workspace?.path ?? null;

  useEffect(() => {
    if (!workspacePath) {
      setIndex({ status: "idle" });
      return;
    }
    let cancelled = false;
    setIndex({ status: "loading" });
    void api
      .fsIndex()
      .then((result) => {
        if (cancelled) return;
        setIndex({
          status: "ready",
          entries: result.entries,
          truncated: result.truncated === true,
        });
      })
      .catch(() => {
        if (!cancelled) setIndex({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  const files = useMemo(
    () =>
      index.status === "ready"
        ? index.entries
            .filter((entry) => entry.kind === "file")
            .map((entry) => entry.path)
            .sort((left, right) => left.localeCompare(right))
        : [],
    [index],
  );

  const openFile = (path: string) => {
    openWorkPanelTab(fileWorkPanelTab(path));
  };

  // Diffs live in the review tab; a change row points there instead of
  // re-implementing a diff renderer inside a list.
  const openReview = () => {
    openWorkPanelTab(toolWorkPanelTab("review"));
  };

  return (
    <div className="artifacts-tab">
      <div className="artifacts-scroll">
        <section className="artifacts-section" aria-labelledby="artifacts-produced">
          <header className="artifacts-section-head">
            <span className="artifacts-section-title" id="artifacts-produced">
              {t("panel.artifacts.produced")}
            </span>
            <span className="artifacts-count">{artifacts.length}</span>
          </header>
          {artifacts.length === 0 ? (
            <p className="artifacts-empty">{t("panel.artifacts.noProduced")}</p>
          ) : (
            <ul className="artifacts-list">
              {artifacts.map((artifact) => (
                <li key={artifact.path}>
                  <button
                    type="button"
                    className="artifacts-row"
                    title={artifact.path}
                    onClick={() => openFile(artifact.path)}
                  >
                    <IconFileText size={14} />
                    <span className="artifacts-path">
                      {shortArtifactPath(artifact.path)}
                    </span>
                    <span className="diff-counts">
                      <span className="diff-count-add">+{artifact.additions}</span>
                      <span className="diff-count-del">−{artifact.deletions}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="artifacts-section" aria-labelledby="artifacts-changed">
          <header className="artifacts-section-head">
            <span className="artifacts-section-title" id="artifacts-changed">
              {t("panel.artifacts.changed")}
            </span>
            <span className="artifacts-count">{changes.length}</span>
          </header>
          {changes.length === 0 ? (
            <p className="artifacts-empty">{t("panel.artifacts.noChanged")}</p>
          ) : (
            <ul className="artifacts-list">
              {changes.map((change) => (
                <li key={change.path}>
                  <button
                    type="button"
                    className="artifacts-row"
                    title={change.path}
                    onClick={openReview}
                  >
                    <IconFileText size={14} />
                    <span className="artifacts-path">
                      {shortArtifactPath(change.path)}
                    </span>
                    <span className="artifacts-status">
                      {change.rolledBack
                        ? t("panel.artifacts.rolledBack")
                        : t(`panel.review.status.${change.status}`)}
                    </span>
                    <span className="diff-counts">
                      <span className="diff-count-add">+{change.additions}</span>
                      <span className="diff-count-del">−{change.deletions}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="artifacts-section" aria-labelledby="artifacts-files">
          <header className="artifacts-section-head">
            <span className="artifacts-section-title" id="artifacts-files">
              {t("panel.artifacts.files")}
            </span>
            <span className="artifacts-count">{files.length}</span>
          </header>
          {!workspacePath ? (
            <WorkTabEmpty
              icon={IconArchive}
              title={t("panel.artifacts.noWorkspace")}
            />
          ) : index.status === "loading" || index.status === "idle" ? (
            <p className="artifacts-empty">{t("panel.artifacts.loading")}</p>
          ) : index.status === "error" ? (
            <p className="artifacts-empty">{t("panel.artifacts.loadError")}</p>
          ) : files.length === 0 ? (
            <p className="artifacts-empty">{t("panel.artifacts.noFiles")}</p>
          ) : (
            <>
              <ul className="artifacts-list">
                {files.slice(0, FILE_ROWS).map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      className="artifacts-row"
                      title={path}
                      onClick={() => openFile(path)}
                    >
                      <IconFileText size={14} />
                      <span className="artifacts-path">
                        {shortArtifactPath(path)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {files.length > FILE_ROWS || index.truncated ? (
                <p className="artifacts-empty">
                  {t("panel.artifacts.more", {
                    count: Math.max(0, files.length - FILE_ROWS),
                  })}
                </p>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
