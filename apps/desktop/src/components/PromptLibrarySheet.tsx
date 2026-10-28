import { useState, type FormEvent } from "react";
import type { TFunction } from "i18next";
import type { PromptLibraryEntry } from "@pi-desktop/shared";
import type { PromptLibraryController } from "../hooks/use-prompt-library";
import { AnchoredMenu } from "./settings/AnchoredMenu";
import { TooltipButton } from "./ui";
import {
  IconClock,
  IconPin,
  IconSearch,
  IconStar,
  IconTrash,
  IconX,
} from "./icons";

type PromptLibrarySheetProps = {
  t: TFunction;
  controller: PromptLibraryController;
};

/**
 * The prompt library, docked above the composer.
 *
 * Rows insert on click and the row actions sit outside the insert button: a
 * pin that lives inside the click target is how people delete the thing they
 * meant to keep.
 */
export function PromptLibrarySheet({ t, controller }: PromptLibrarySheetProps) {
  const [tagDraft, setTagDraft] = useState<{ id: string; value: string } | null>(null);
  const { status } = controller;

  const submitTags = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tagDraft) return;
    controller.saveTags(
      tagDraft.id,
      tagDraft.value.split(",").map((tag) => tag.trim()),
    );
    setTagDraft(null);
  };

  const renderRow = (entry: PromptLibraryEntry) => (
    <li key={entry.id} className="prompt-library-row" data-pinned={entry.pinned ? "true" : undefined}>
      <button
        type="button"
        className="prompt-library-copy"
        onClick={() => controller.insert(entry.text)}
        title={entry.text}
      >
        <span className="prompt-library-text">{entry.text}</span>
        <span className="prompt-library-meta">
          <IconClock size={11} aria-hidden="true" />
          {t("promptLibrary.uses", { count: entry.uses })}
          {entry.tags.length ? (
            <span className="prompt-library-tags">
              {entry.tags.map((tag) => (
                <span key={tag} className="prompt-library-tag">
                  {tag}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </button>
      <div className="prompt-library-actions">
        <TooltipButton
          type="button"
          className={`icon-btn prompt-library-action${entry.pinned ? " is-on" : ""}`}
          tooltip={entry.pinned ? t("promptLibrary.unpin") : t("promptLibrary.pin")}
          ariaLabel={entry.pinned ? t("promptLibrary.unpin") : t("promptLibrary.pin")}
          aria-pressed={entry.pinned}
          onClick={() => controller.togglePin(entry.id)}
        >
          {entry.pinned ? <IconStar size={13} /> : <IconPin size={13} />}
        </TooltipButton>
        <TooltipButton
          type="button"
          className="icon-btn prompt-library-action"
          tooltip={t("promptLibrary.editTags")}
          ariaLabel={t("promptLibrary.editTags")}
          onClick={() =>
            setTagDraft(
              tagDraft?.id === entry.id
                ? null
                : { id: entry.id, value: entry.tags.join(", ") },
            )
          }
        >
          <span className="prompt-library-hash" aria-hidden="true">
            #
          </span>
        </TooltipButton>
        <TooltipButton
          type="button"
          className="icon-btn prompt-library-action"
          tooltip={t("promptLibrary.remove")}
          ariaLabel={t("promptLibrary.remove")}
          onClick={() => controller.remove(entry.id)}
        >
          <IconTrash size={13} />
        </TooltipButton>
      </div>
      {tagDraft?.id === entry.id ? (
        <form className="prompt-library-tag-form" onSubmit={submitTags}>
          <input
            className="prompt-library-tag-input"
            value={tagDraft.value}
            autoFocus
            aria-label={t("promptLibrary.tagsLabel")}
            placeholder={t("promptLibrary.tagsPlaceholder")}
            onChange={(event) => setTagDraft({ id: entry.id, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setTagDraft(null);
              }
            }}
          />
          <button type="submit" className="prompt-library-tag-save">
            {t("common.save")}
          </button>
        </form>
      ) : null}
    </li>
  );

  return (
    <AnchoredMenu
      className="prompt-library-anchor"
      open={controller.open}
      onClose={controller.close}
      menuClassName="composer-menu prompt-library-menu"
      label={t("promptLibrary.title")}
      role="dialog"
      side="top"
      align="start"
      initialFocus="none"
      trigger={(ref) => (
        <TooltipButton
          ref={ref}
          type="button"
          className={`icon-btn prompt-library-trigger${controller.open ? " active" : ""}`}
          tooltip={t("promptLibrary.open")}
          ariaLabel={t("promptLibrary.open")}
          aria-haspopup="dialog"
          aria-expanded={controller.open}
          onClick={controller.toggleOpen}
        >
          <IconStar size={15} aria-hidden="true" />
        </TooltipButton>
      )}
    >
      <div className="prompt-library-head">
        <span className="prompt-library-title">{t("promptLibrary.title")}</span>
        <span className="prompt-library-count">
          {t("promptLibrary.count", { count: status.total })}
        </span>
        <TooltipButton
          type="button"
          className="icon-btn prompt-library-action prompt-library-close"
          tooltip={t("common.close")}
          ariaLabel={t("common.close")}
          onClick={controller.close}
        >
          <IconX size={13} />
        </TooltipButton>
      </div>

      <label className="prompt-library-search">
        <IconSearch size={13} aria-hidden="true" />
        <input
          className="prompt-library-search-input"
          value={controller.query}
          placeholder={t("promptLibrary.searchPlaceholder")}
          aria-label={t("promptLibrary.searchPlaceholder")}
          onChange={(event) => controller.setQuery(event.target.value)}
        />
      </label>

      {status.tags.length ? (
        <div className="prompt-library-filters" role="group" aria-label={t("promptLibrary.tagsLabel")}>
          <button
            type="button"
            className={`prompt-library-filter${controller.tagFilter === null ? " is-active" : ""}`}
            aria-pressed={controller.tagFilter === null}
            onClick={() => controller.setTagFilter(null)}
          >
            {t("promptLibrary.filterAll")}
          </button>
          {status.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`prompt-library-filter${controller.tagFilter === tag ? " is-active" : ""}`}
              aria-pressed={controller.tagFilter === tag}
              onClick={() =>
                controller.setTagFilter(controller.tagFilter === tag ? null : tag)
              }
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}

      {controller.visible.length ? (
        <ul className="prompt-library-list">{controller.visible.map(renderRow)}</ul>
      ) : (
        <div className="prompt-library-empty">
          <p className="prompt-library-empty-title">
            {controller.entries.length ? t("promptLibrary.noResults") : t("promptLibrary.empty")}
          </p>
          <p className="prompt-library-empty-hint">{t("promptLibrary.emptyHint")}</p>
        </div>
      )}

      <p className="prompt-library-foot">{t("promptLibrary.recallHint")}</p>
    </AnchoredMenu>
  );
}
