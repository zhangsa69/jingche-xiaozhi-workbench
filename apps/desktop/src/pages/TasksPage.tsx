import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import { api } from "../lib/api";
import {
  deriveTaskHistory,
  groupTaskHistory,
  taskReusePlan,
  taskSourcePrompt,
  type TaskHistoryRow,
  type TaskReuseMode,
} from "../lib/task-history";
import { Badge, Button } from "../components/ui";
import { IconClock, IconFolder, IconRefresh } from "../components/icons";

const PROMPT_READ = { messageLimit: 200, contentLimit: 64 * 1024 } as const;

export function TasksPage() {
  const { t, i18n } = useTranslation();
  const sessions = useAppStore((state) => state.sessions);
  const refreshSessions = useAppStore((state) => state.refreshSessions);
  const newSession = useAppStore((state) => state.newSession);
  const sendPrompt = useAppStore((state) => state.sendPrompt);
  const setPage = useAppStore((state) => state.setPage);
  const showToast = useAppStore((state) => state.showToast);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<TaskReuseMode | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const rows = useMemo(() => deriveTaskHistory(sessions), [sessions]);
  const groups = useMemo(() => groupTaskHistory(rows, new Date()), [rows]);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;

  const clock = (value: string) => {
    const at = Date.parse(value);
    if (Number.isNaN(at)) return "";
    return new Date(at).toLocaleTimeString(i18n.language, {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const start = async (mode: TaskReuseMode, row: TaskHistoryRow) => {
    if (busy) return;
    const plan = taskReusePlan(mode, row);
    setBusy(mode);
    try {
      let prompt: string | null = null;
      if (plan.needsPrompt) {
        const history = await api.getSession(row.id, PROMPT_READ);
        prompt = history.session ? taskSourcePrompt(history.session.messages) : null;
        if (!prompt) {
          showToast(t("tasks.noPrompt"), { variant: "info" });
          return;
        }
      }
      setPage("chat");
      await newSession({ projectPath: plan.projectPath });
      const createdId = useAppStore.getState().activeSessionId;
      if (plan.sendPrompt && prompt && createdId) {
        await sendPrompt(prompt, undefined, createdId);
      }
      showToast(
        plan.sendPrompt ? t("tasks.started") : t("tasks.workspaceReady"),
        { variant: "success" },
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const move = (delta: number) => {
    if (rows.length === 0) return;
    const index = selected ? rows.findIndex((row) => row.id === selected.id) : 0;
    const next = rows[Math.min(Math.max(index + delta, 0), rows.length - 1)];
    setSelectedId(next.id);
  };

  const dayLabel = (key: string) => {
    if (key === "today") return t("tasks.today");
    if (key === "yesterday") return t("tasks.yesterday");
    if (key === "unknown") return t("tasks.unknownDate");
    return key;
  };

  return (
    <div className="thread-scroll">
      <div className="page-frame tasks-page">
        <div className="page-header">
          <div className="tasks-title-block">
            <span className="tasks-title-icon" aria-hidden>
              <IconClock size={14} />
            </span>
            <div>
              <h1 className="page-title">{t("tasks.title")}</h1>
              <p className="tasks-subtitle">{t("tasks.subtitle")}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refreshSessions()}
            title={t("tasks.refresh")}
          >
            <IconRefresh size={14} />
            {t("tasks.refresh")}
          </Button>
        </div>

        {rows.length === 0 ? (
          <div className="tasks-empty">
            <p className="tasks-empty-title">{t("tasks.empty")}</p>
            <p className="tasks-empty-hint">{t("tasks.emptyHint")}</p>
          </div>
        ) : (
          <div className="tasks-split">
            <div
              className="tasks-list"
              ref={listRef}
              role="listbox"
              aria-label={t("tasks.title")}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  move(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  move(-1);
                } else if (event.key === "Enter" && selected && !selected.readOnly) {
                  event.preventDefault();
                  void start("rerun", selected);
                }
              }}
            >
              {groups.map((group) => (
                <div key={group.key} className="tasks-group">
                  <div className="tasks-group-label">{dayLabel(group.key)}</div>
                  {group.rows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      role="option"
                      aria-selected={selected?.id === row.id}
                      className={`tasks-row ${selected?.id === row.id ? "is-active" : ""}`}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <span className="tasks-row-title">
                        {row.title || t("tasks.untitled")}
                      </span>
                      <span className="tasks-row-meta">
                        <span>{clock(row.updatedAt)}</span>
                        <span>·</span>
                        <span>{t("tasks.messageCount", { count: row.messageCount })}</span>
                        {row.readOnly ? (
                          <Badge tone="neutral">{t("tasks.readOnly")}</Badge>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {selected ? (
              <div className="tasks-detail">
                <h2 className="tasks-detail-title">
                  {selected.title || t("tasks.untitled")}
                </h2>
                <dl className="tasks-facts">
                  <div>
                    <dt>{t("tasks.lastActivity")}</dt>
                    <dd>{new Date(selected.updatedAt).toLocaleString(i18n.language)}</dd>
                  </div>
                  <div>
                    <dt>{t("tasks.workspace")}</dt>
                    <dd className="font-mono">
                      {selected.projectPath ?? t("tasks.noProject")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("tasks.model")}</dt>
                    <dd className="font-mono">{selected.modelId ?? t("tasks.defaultModel")}</dd>
                  </div>
                </dl>

                <p className="tasks-detail-hint">{t("tasks.actionHint")}</p>
                <div className="tasks-actions">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={Boolean(busy) || selected.readOnly}
                    onClick={() => void start("rerun", selected)}
                  >
                    {t("tasks.rerun")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={Boolean(busy) || selected.readOnly}
                    onClick={() => void start("input", selected)}
                  >
                    {t("tasks.reuseInput")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={Boolean(busy) || selected.readOnly || !selected.projectPath}
                    onClick={() => void start("workspace", selected)}
                  >
                    <IconFolder size={14} />
                    {t("tasks.reuseWorkspace")}
                  </Button>
                </div>
                <p className="tasks-detail-note">
                  {selected.readOnly ? t("tasks.readOnlyHint") : t("tasks.keepsHistory")}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
