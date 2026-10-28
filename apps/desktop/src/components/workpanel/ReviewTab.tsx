import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { locateTranscriptMessage } from "../../lib/locate-message";
import {
  groupReviewChanges,
  type ReviewChangeGroup,
} from "../../lib/review-groups";
import {
  reviewChangesFromMessages,
  summarizeReviewChanges,
} from "../../lib/workspace-review";
import { useAppStore } from "../../stores/app-store";
import { IconDiff, IconSnapshot } from "../icons";
import { ReviewChangeCard } from "../ReviewChangeCard";
import { WorkTabEmpty } from "./WorkTabEmpty";

/**
 * The session's changes, one block per file (W-16).
 *
 * A file edited five times used to be five rows with no way to say "undo this
 * file"; grouping restores the file as the unit of review, and the group's
 * undo replays the snapshots newest first.
 */
export function ReviewTab() {
  const { t } = useTranslation();
  const messages = useAppStore((state) => state.messages);
  const rollbackMany = useAppStore((state) => state.rollbackWorkspaceChanges);
  const showToast = useAppStore((state) => state.showToast);
  const entries = useMemo(() => reviewChangesFromMessages(messages), [messages]);
  const groups = useMemo(() => groupReviewChanges(entries), [entries]);
  const summary = useMemo(() => summarizeReviewChanges(entries), [entries]);
  const [rollingBackPath, setRollingBackPath] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <WorkTabEmpty
        icon={IconDiff}
        title={t("panel.review.noChanges")}
        body={t("panel.review.noChangesHint")}
      />
    );
  }

  const runGroupRollback = async (group: ReviewChangeGroup) => {
    if (rollingBackPath !== null || group.rollbackTargets.length === 0) return;
    setRollingBackPath(group.path);
    const result = await rollbackMany(group.rollbackTargets);
    setRollingBackPath(null);
    if (!result) return;
    if (result.failed === 0) {
      showToast(t("panel.review.rollbackFileDone"), { variant: "success" });
      return;
    }
    showToast(
      t("panel.review.rollbackFilePartial", {
        done: result.rolledBack,
        failed: result.failed,
      }),
      { variant: "warning" },
    );
  };

  return (
    <div className="review-tab">
      <div className="review-toolbar">
        <span className="review-summary">
          {t("panel.review.changes", { count: summary.changeCount })}
        </span>
        <span className="review-toolbar-counts diff-counts">
          <span className="diff-count-add">+{summary.additions}</span>
          <span className="diff-count-del">−{summary.deletions}</span>
        </span>
      </div>
      <div className="review-scroll">
        {groups.map((group) => {
          const rolling = rollingBackPath === group.path;
          return (
            <section className="review-file-group" key={group.path}>
              <div className="review-file-head">
                <span className="review-file-path" title={group.path}>
                  {group.path}
                </span>
                <span className="review-file-snapshots">
                  {t("panel.review.fileSnapshots", { count: group.entries.length })}
                </span>
                <span className="review-file-counts diff-counts">
                  {group.additions > 0 ? (
                    <span className="diff-count-add">+{group.additions}</span>
                  ) : null}
                  {group.deletions > 0 ? (
                    <span className="diff-count-del">−{group.deletions}</span>
                  ) : null}
                </span>
                {group.rollbackTargets.length > 0 ? (
                  <button
                    type="button"
                    className="review-file-rollback"
                    onClick={() => void runGroupRollback(group)}
                    disabled={rollingBackPath !== null}
                  >
                    <IconSnapshot size={13} />
                    {rolling
                      ? t("panel.review.rollingBack")
                      : t("panel.review.rollbackFile")}
                  </button>
                ) : (
                  <span className="review-file-state">
                    {group.activeCount === 0
                      ? t("panel.review.rolledBack")
                      : t("panel.review.rollbackUnavailable")}
                  </span>
                )}
              </div>
              <div className="review-file-changes">
                {group.entries.map((entry) => (
                  <ReviewChangeCard
                    key={entry.change.snapshotId}
                    message={entry.message}
                    compact
                    onLocate={() => locateTranscriptMessage(entry.message.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
