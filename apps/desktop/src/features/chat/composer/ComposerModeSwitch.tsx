import type { CSSProperties, KeyboardEvent } from "react";
import { useRef } from "react";
import type { TFunction } from "i18next";
import type { Mode } from "@pi-desktop/shared";
import { ModeIcon } from "./ComposerModeIcon";
import { MODE_CYCLE, MODE_LABEL_KEYS } from "./model";

/*
  Four modes, one track: the chip used to cycle and hid three quarters of the
  state behind clicks. A segmented control with a sliding glider shows every
  choice at once and still fits the toolbar — labels collapse to icons through
  the composer container query before the row can overflow its shell.
*/

export type ComposerModeSwitchProps = {
  t: TFunction;
  mode: Mode;
  planningLive: boolean;
  disabled: boolean;
  onSelect: (mode: Mode) => void;
};

export function ComposerModeSwitch({
  t,
  mode,
  planningLive,
  disabled,
  onSelect,
}: ComposerModeSwitchProps) {
  const optionRefs = useRef<Partial<Record<Mode, HTMLButtonElement | null>>>({});
  const index = Math.max(0, MODE_CYCLE.indexOf(mode));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const last = MODE_CYCLE.length - 1;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowRight"
            ? (index + 1) % MODE_CYCLE.length
            : (index - 1 + MODE_CYCLE.length) % MODE_CYCLE.length;
    const next = MODE_CYCLE[nextIndex];
    if (!next) return;
    // Move focus with the selection so the roving tabindex never strands it.
    optionRefs.current[next]?.focus();
    onSelect(next);
  };

  return (
    <div
      className="mode-switch"
      role="radiogroup"
      aria-label={t("chat.mode")}
      data-mode={mode}
      data-planning={planningLive ? "true" : undefined}
      style={{ "--mode-switch-index": index } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      <span className="mode-switch-glider" aria-hidden="true" />
      {MODE_CYCLE.map((candidate) => {
        const label = t(MODE_LABEL_KEYS[candidate]);
        const selected = candidate === mode;
        return (
          <button
            key={candidate}
            ref={(node) => {
              optionRefs.current[candidate] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            className="mode-switch-option"
            disabled={disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!selected) onSelect(candidate);
            }}
          >
            <ModeIcon mode={candidate} />
            <span className="mode-switch-label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
