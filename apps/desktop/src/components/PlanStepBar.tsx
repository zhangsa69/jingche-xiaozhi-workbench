import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { UiMessage } from "@pi-desktop/shared";
import { parsePlanSteps, planStepProgress } from "@pi-desktop/shared";
import { isActivePlanExecution } from "../lib/plan-mode-state";
import { useAppStore } from "../stores/app-store";

/**
 * Persistent `第 3/8 步` bar for one approved execution (W-05).
 *
 * Both halves are derived, never stored: the step list comes from the approved
 * Markdown snapshot in the plan checkpoint, the position comes from the
 * `UpdateStep` rows already in the transcript. A restart, a second window and
 * the sidebar therefore read the same numbers without a synced counter.
 */
export function PlanStepBar({
  sessionId,
  messages,
}: {
  sessionId: string;
  messages: UiMessage[];
}) {
  const { t } = useTranslation();
  const checkpoint = useAppStore((state) => state.planCheckpoints[sessionId]);
  const steps = useMemo(
    () => parsePlanSteps(checkpoint?.markdown),
    [checkpoint?.markdown],
  );
  const progress = useMemo(
    () => planStepProgress(steps, messages),
    [steps, messages],
  );

  // Only a run in progress has a position worth pinning above the transcript:
  // before approval the plan card owns the steps, after completion the result
  // report does.
  if (!isActivePlanExecution(checkpoint) || steps.length < 2) return null;

  const locate = (messageId: string | undefined) => {
    if (!messageId) return;
    const row = document.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageId)}"]`,
    );
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const countLabel =
    progress.current > 0
      ? t("chat.stepsProgress", {
          current: progress.current,
          total: progress.total,
        })
      : t("chat.stepsPending", { total: progress.total });

  return (
    <div className="plan-steps" data-plan-step-bar="true">
      <div className="plan-steps-head">
        <span className="plan-steps-count">{countLabel}</span>
        <span className="plan-steps-title" title={progress.step?.title}>
          {progress.step?.title ?? steps[0]?.title}
        </span>
      </div>
      <ol className="plan-steps-list">
        {steps.map((step) => {
          const active = step.index === progress.current;
          const done = step.index < progress.current;
          const anchor = progress.anchors[step.index];
          return (
            <li key={step.index}>
              <button
                type="button"
                className={`plan-step ${done ? "done" : ""} ${active ? "active" : ""}`}
                aria-current={active ? "step" : undefined}
                aria-label={t("chat.stepsGoTo", {
                  step: step.index,
                  title: step.title,
                })}
                title={step.title}
                disabled={!anchor}
                onClick={() => locate(anchor)}
              >
                <span className="plan-step-index">{step.index}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
