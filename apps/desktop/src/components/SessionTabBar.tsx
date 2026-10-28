import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { hiddenSessionTabCount } from "@pi-desktop/shared";
import { IconClose } from "./icons";
import { SessionPlanProgress } from "./SessionPlanProgress";
import { isDefaultSessionTitle, useAppStore } from "../stores/app-store";

/**
 * W-29: the conversations this window keeps within reach.
 *
 * The bar is a view of the session list, never a second copy of it: every tab
 * resolves to a real session row, and closing a tab removes nothing but the
 * shortcut. One tab is not a bar — it would cost a row of vertical space on
 * every chat to say "you are here" — so the bar appears from two onwards.
 */
export function SessionTabBar() {
  const { t } = useTranslation();
  const sessions = useAppStore((state) => state.sessions);
  const sessionTabs = useAppStore((state) => state.sessionTabs);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const selectingSessionId = useAppStore((state) => state.selectingSessionId);
  const runningSessions = useAppStore((state) => state.runningSessions);
  const selectSession = useAppStore((state) => state.selectSession);
  const closeSessionTab = useAppStore((state) => state.closeSessionTab);

  const byId = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const tabs = useMemo(
    () =>
      sessionTabs.flatMap((id) => {
        const session = byId.get(id);
        return session ? [{ id, title: session.title }] : [];
      }),
    [sessionTabs, byId],
  );

  if (tabs.length < 2) return null;
  const hidden = hiddenSessionTabCount(sessionTabs);

  return (
    <div className="stb-bar" role="tablist" aria-label={t("chat.sessionTabs")}>
      <div className="stb-track">
        {tabs.map((tab) => {
          const selected = tab.id === activeSessionId;
          const running = runningSessions[tab.id] === true;
          const rawTitle = (tab.title || "").trim();
          const title = isDefaultSessionTitle(rawTitle)
            ? t("chat.untitledTask")
            : rawTitle;
          return (
            <div
              key={tab.id}
              className={`stb-tab${selected ? " is-active" : ""}${
                running ? " is-running" : ""
              }`}
              data-session-tab={tab.id}
            >
              <button
                type="button"
                className="stb-tab-main"
                role="tab"
                aria-selected={selected}
                title={title}
                onClick={() => {
                  if (selected) return;
                  void selectSession(tab.id);
                }}
              >
                {running ? <span className="stb-dot" aria-hidden="true" /> : null}
                <span className="stb-title">{title}</span>
                <SessionPlanProgress sessionId={tab.id} />
                {selectingSessionId === tab.id ? (
                  <span className="stb-spinner" aria-hidden="true" />
                ) : null}
              </button>
              <button
                type="button"
                className="stb-close"
                aria-label={t("chat.sessionTabClose", { title })}
                title={t("chat.sessionTabClose", { title })}
                onClick={() => void closeSessionTab(tab.id)}
              >
                <IconClose size={11} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      {hidden > 0 ? (
        <span className="stb-overflow" title={t("chat.sessionTabOverflow", { count: hidden })}>
          +{hidden}
        </span>
      ) : null}
    </div>
  );
}
