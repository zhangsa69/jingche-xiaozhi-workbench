import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { parsePlanSteps, planStepProgress } from "@pi-desktop/shared";
import { isActivePlanExecution } from "../lib/plan-mode-state";
import { useAppStore } from "../stores/app-store";

/**
 * W-10: `3/8` on a running session row.
 *
 * The number is the same derived value the transcript bar renders (W-05): the
 * list comes from the approved snapshot, the position from the `UpdateStep`
 * rows. Nothing is stored twice, so the row cannot drift from the bar.
 */
export function SessionPlanProgress({ sessionId }: { sessionId: string }) {
  // Only a running row has a live position worth showing, and only that row
  // should pay for replaying the transcript on every stream tick.
  const running = useAppStore((state) => state.runningSessions[sessionId] === true);
  return running ? <RunningPlanProgress sessionId={sessionId} /> : null;
}

function RunningPlanProgress({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const checkpoint = useAppStore((state) => state.planCheckpoints[sessionId]);
  // The active transcript is the live one; a retained pane still holds what its
  // session last painted, which is the honest position the sidebar can show.
  const messages = useAppStore((state) =>
    state.activeSessionId === sessionId
      ? state.messages
      : state.retainedTranscripts[sessionId],
  );
  const steps = useMemo(
    () => parsePlanSteps(checkpoint?.markdown),
    [checkpoint?.markdown],
  );
  const progress = useMemo(
    // A session the window never painted has no transcript: no `0/8` guesses.
    () => (messages ? planStepProgress(steps, messages) : null),
    [steps, messages],
  );

  if (!progress || !isActivePlanExecution(checkpoint) || steps.length < 2) {
    return null;
  }

  const label =
    progress.current > 0
      ? t("chat.stepsProgress", {
          current: progress.current,
          total: progress.total,
        })
      : t("chat.stepsPending", { total: progress.total });

  return (
    <span className="thread-item-steps" title={label} aria-label={label}>
      {progress.current}/{progress.total}
    </span>
  );
}
