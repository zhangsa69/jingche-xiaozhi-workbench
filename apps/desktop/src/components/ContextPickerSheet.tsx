import type { TFunction } from "i18next";
import type { ContextPinCandidate } from "@pi-desktop/shared";

import { AnchoredMenu } from "./settings/AnchoredMenu";
import { TooltipButton } from "./ui";
import { IconCheck, IconListChecks, IconX } from "./icons";

export type ContextPickerController = {
  open: boolean;
  toggleOpen: () => void;
  close: () => void;
  candidates: ContextPinCandidate[];
  selected: readonly string[];
  toggle: (id: string) => void;
  clear: () => void;
  /** Characters the current ticks will add to the prompt. */
  used: number;
  budget: number;
};

type ContextPickerSheetProps = {
  t: TFunction;
  controller: ContextPickerController;
};

/**
 * Context picker, docked above the composer.
 *
 * A tick list, not a search box: the turns worth pinning are the ones the user
 * just read in the transcript, so the rows keep transcript order and show a
 * one-line excerpt with the role label. The footer states the budget in
 * characters instead of tokens, because the token count is the model's
 * estimate and this count is the one the user controls.
 */
export function ContextPickerSheet({ t, controller }: ContextPickerSheetProps) {
  return (
    <AnchoredMenu
      className="context-pins-anchor"
      open={controller.open}
      onClose={controller.close}
      menuClassName="composer-menu context-pins-menu"
      label={t("contextPins.title")}
      role="dialog"
      side="top"
      align="start"
      initialFocus="none"
      trigger={(ref) => (
        <TooltipButton
          ref={ref}
          type="button"
          className={`icon-btn context-pins-trigger${controller.open ? " active" : ""}${
            controller.selected.length ? " is-on" : ""
          }`}
          tooltip={t("contextPins.open")}
          ariaLabel={t("contextPins.open")}
          aria-haspopup="dialog"
          aria-expanded={controller.open}
          onClick={controller.toggleOpen}
        >
          <IconListChecks size={15} aria-hidden="true" />
          {controller.selected.length ? (
            <span className="context-pins-count">{controller.selected.length}</span>
          ) : null}
        </TooltipButton>
      )}
    >
      <div className="context-pins-head">
        <span className="context-pins-title">{t("contextPins.title")}</span>
        <span className="context-pins-budget">
          {t("contextPins.budget", {
            used: controller.used,
            total: controller.budget,
          })}
        </span>
        <TooltipButton
          type="button"
          className="icon-btn context-pins-close"
          tooltip={t("common.close")}
          ariaLabel={t("common.close")}
          onClick={controller.close}
        >
          <IconX size={13} />
        </TooltipButton>
      </div>

      <p className="context-pins-hint">{t("contextPins.hint")}</p>

      {controller.candidates.length ? (
        <ul className="context-pins-list" role="group" aria-label={t("contextPins.title")}>
          {controller.candidates.map((candidate) => {
            const checked = controller.selected.includes(candidate.id);
            return (
              <li key={candidate.id}>
                <button
                  type="button"
                  className="context-pins-row"
                  role="checkbox"
                  aria-checked={checked}
                  data-checked={checked ? "true" : undefined}
                  title={candidate.text}
                  onClick={() => controller.toggle(candidate.id)}
                >
                  <span className="context-pins-box" aria-hidden="true">
                    {checked ? <IconCheck size={11} /> : null}
                  </span>
                  <span className="context-pins-role">{t(`contextPins.role.${candidate.role}`)}</span>
                  <span className="context-pins-excerpt">{candidate.excerpt}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="context-pins-empty">{t("contextPins.empty")}</p>
      )}

      <div className="context-pins-foot">
        <span className="context-pins-selected">
          {t("contextPins.selected", { count: controller.selected.length })}
        </span>
        <button
          type="button"
          className="context-pins-clear"
          disabled={!controller.selected.length}
          onClick={controller.clear}
        >
          {t("contextPins.clear")}
        </button>
      </div>
    </AnchoredMenu>
  );
}
