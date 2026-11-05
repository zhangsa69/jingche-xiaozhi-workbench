import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import {
  TASK_STATUS_LENSES,
  taskStatusLamp,
  type TaskStatusLamp,
} from "../lib/task-status-light";

const LAMP_LABEL_KEYS: Record<TaskStatusLamp, string> = {
  idle: "nav.sessionIdle",
  running: "nav.sessionRunning",
  permission: "nav.sessionPermission",
  failed: "nav.sessionStatusFailed",
};

/**
 * The three-lens status lamp left of the top bar's overview button. It only
 * mirrors the active session: a parked permission prompt outranks a live run,
 * and a failed last turn keeps the red lens lit until the next turn replaces
 * that message. The lamp owns the session reads, so the top bar itself still
 * never subscribes to run state.
 */
export function TaskStatusLamps() {
  const { t } = useTranslation();
  const running = useAppStore((state) => {
    const sessionId = state.activeSessionId;
    return sessionId ? Boolean(state.runningSessions[sessionId]) : false;
  });
  const hasPendingPermission = useAppStore((state) => {
    const sessionId = state.activeSessionId;
    return sessionId ? (state.pendingPermissions[sessionId]?.length ?? 0) > 0 : false;
  });
  const failed = useAppStore((state) => {
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const message = state.messages[index];
      if (!message || message.role !== "assistant") continue;
      return message.status === "error";
    }
    return false;
  });

  const lamp = taskStatusLamp({ running, hasPendingPermission, failed });
  const label = t(LAMP_LABEL_KEYS[lamp]);

  return (
    <div
      className="ct-status-lamps"
      data-lamp={lamp}
      role="img"
      aria-label={label}
      title={label}
    >
      {TASK_STATUS_LENSES.map((lens) => (
        <span key={lens} className={`ct-status-lamp ${lens}`} aria-hidden />
      ))}
    </div>
  );
}
