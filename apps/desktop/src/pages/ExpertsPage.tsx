import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  EXPERT_CATEGORIES,
  EXPERT_PRESETS,
  MAX_EXPERT_PANEL_MEMBERS,
  buildExpertPanelPrompt,
  expertsInCategory,
  findExpertPreset,
  matchExperts,
  type ExpertCategory,
  type ExpertPreset,
} from "@pi-desktop/shared";
import { useAppStore } from "../stores/app-store";
import { IconCheck, IconPlus, IconSearch, IconSparkles, IconUser, IconX } from "../components/icons";

const ALL = "all" as const;

/**
 * Expert center (W-23) and expert panel (W-25).
 *
 * Picking an expert writes its brief into the composer: the persona is prompt
 * text, not a hidden session setting, so the user can read and edit what was
 * handed over. The same holds for a panel — the dispatch prompt is visible
 * before it is sent, and the model is still chosen in the composer, because a
 * page click should not silently move a user onto a different model.
 */
export function ExpertsPage() {
  const { t } = useTranslation();
  const appendComposerDraftText = useAppStore((state) => state.appendComposerDraftText);
  const setPage = useAppStore((state) => state.setPage);
  const showToast = useAppStore((state) => state.showToast);

  const [category, setCategory] = useState<ExpertCategory | typeof ALL>(ALL);
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState("");
  const [team, setTeam] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");

  const labels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const preset of EXPERT_PRESETS) {
      map[preset.id] = t(`experts.items.${preset.id}.name`);
    }
    return map;
  }, [t]);

  const visible = useMemo(() => {
    const matched = new Set(matchExperts(query, labels));
    return expertsInCategory(category).filter((preset) => matched.has(preset.id));
  }, [category, query, labels]);

  const detail = findExpertPreset(detailId) ?? null;

  const useExpert = (preset: ExpertPreset) => {
    appendComposerDraftText(preset.brief);
    setPage("chat");
  };

  const toggleTeam = (preset: ExpertPreset) => {
    setTeam((current) => {
      if (current.includes(preset.id)) return current.filter((id) => id !== preset.id);
      if (current.length >= MAX_EXPERT_PANEL_MEMBERS) {
        showToast(t("experts.teamFull", { max: MAX_EXPERT_PANEL_MEMBERS }), {
          variant: "info",
        });
        return current;
      }
      return [...current, preset.id];
    });
  };

  const launchPanel = () => {
    const prompt = buildExpertPanelPrompt({ instruction, expertIds: team, labels });
    if (!prompt) {
      showToast(t("experts.needInstruction"), { variant: "info" });
      return;
    }
    appendComposerDraftText(prompt);
    setInstruction("");
    setPage("chat");
  };

  return (
    <div className="experts-page">
      <header className="experts-head">
        <div>
          <h1 className="text-md-plus font-semibold text-text-primary">{t("experts.title")}</h1>
          <p className="mt-1 text-xs-plus text-text-muted">{t("experts.subtitle")}</p>
        </div>
        <span className="experts-count">
          {t("experts.count", { count: visible.length })}
        </span>
      </header>

      <div className="experts-body">
        <nav className="experts-rail" aria-label={t("experts.title")}>
          {[ALL, ...EXPERT_CATEGORIES].map((id) => (
            <button
              key={id}
              type="button"
              className={`experts-rail-item ${category === id ? "active" : ""}`}
              aria-pressed={category === id}
              onClick={() => setCategory(id)}
            >
              {t(`experts.categories.${id}`)}
            </button>
          ))}
        </nav>

        <div className="experts-main">
          <label className="experts-search">
            <IconSearch size={13} aria-hidden />
            <input
              type="search"
              value={query}
              placeholder={t("experts.searchPlaceholder")}
              aria-label={t("experts.search")}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button
                type="button"
                className="experts-search-clear"
                aria-label={t("experts.clearSearch")}
                onClick={() => setQuery("")}
              >
                <IconX size={12} aria-hidden />
              </button>
            ) : null}
          </label>

          {visible.length === 0 ? (
            <section className="experts-empty">
              <IconUser size={20} aria-hidden />
              <p className="text-sm-plus text-text-primary">{t("experts.empty")}</p>
              <p className="mt-1 text-xs-plus text-text-muted">{t("experts.emptyHint")}</p>
            </section>
          ) : (
            <ul className="experts-grid">
              {visible.map((preset) => {
                const inTeam = team.includes(preset.id);
                return (
                  <li key={preset.id}>
                    <div
                      className={`expert-card ${detailId === preset.id ? "active" : ""}`}
                      data-expert={preset.id}
                    >
                      <button
                        type="button"
                        className="expert-open"
                        aria-pressed={detailId === preset.id}
                        onClick={() =>
                          setDetailId((current) => (current === preset.id ? "" : preset.id))
                        }
                      >
                        <span className="expert-avatar" aria-hidden>
                          {preset.initials}
                        </span>
                        <span className="expert-text">
                          <span className="expert-name text-sm-plus text-text-primary">
                            {t(`experts.items.${preset.id}.name`)}
                          </span>
                          <span className="expert-desc text-xs-plus text-text-muted">
                            {t(`experts.items.${preset.id}.description`)}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`expert-team-toggle ${inTeam ? "on" : ""}`}
                        aria-pressed={inTeam}
                        aria-label={
                          inTeam
                            ? t("experts.removeFromTeam", {
                                name: t(`experts.items.${preset.id}.name`),
                              })
                            : t("experts.addToTeam", {
                                name: t(`experts.items.${preset.id}.name`),
                              })
                        }
                        onClick={() => toggleTeam(preset)}
                      >
                        {inTeam ? <IconCheck size={12} aria-hidden /> : <IconPlus size={12} aria-hidden />}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {detail ? (
            <section className="expert-detail" data-expert-detail={detail.id}>
              <h2 className="text-sm-plus font-semibold text-text-primary">
                {t(`experts.items.${detail.id}.name`)}
              </h2>
              <p className="mt-1 text-xs-plus text-text-muted">
                {t(`experts.items.${detail.id}.description`)}
              </p>
              <p className="expert-detail-line text-2xs text-text-faint">
                {detail.defaultModel
                  ? t("experts.prefersModel", { model: detail.defaultModel })
                  : t("experts.noModel")}
              </p>
              <p className="expert-detail-line text-2xs text-text-faint">
                {t("experts.delegatesTo", { agent: detail.delegate })}
              </p>
              <div className="expert-detail-actions">
                <button
                  type="button"
                  className="expert-use"
                  onClick={() => useExpert(detail)}
                >
                  <IconSparkles size={13} aria-hidden />
                  {t("experts.use")}
                </button>
                <button
                  type="button"
                  className="expert-secondary"
                  aria-pressed={team.includes(detail.id)}
                  onClick={() => toggleTeam(detail)}
                >
                  {team.includes(detail.id) ? t("experts.inTeam") : t("experts.addToTeamShort")}
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <section className="experts-team" aria-label={t("experts.team")}>
        <div className="experts-team-head">
          <IconUser size={13} aria-hidden />
          <span className="text-xs-plus font-semibold text-text-primary">
            {t("experts.team")}
          </span>
          <span className="experts-team-count">
            {t("experts.teamCount", { count: team.length, max: MAX_EXPERT_PANEL_MEMBERS })}
          </span>
        </div>
        <p className="text-2xs text-text-faint">{t("experts.teamHint", { max: MAX_EXPERT_PANEL_MEMBERS })}</p>
        <div className="experts-team-chips">
          {team.length === 0 ? (
            <span className="text-2xs text-text-faint">{t("experts.teamEmpty")}</span>
          ) : (
            team.map((id) => (
              <button
                key={id}
                type="button"
                className="experts-chip"
                onClick={() => setTeam((current) => current.filter((item) => item !== id))}
                aria-label={t("experts.removeFromTeam", { name: t(`experts.items.${id}.name`) })}
              >
                {t(`experts.items.${id}.name`)}
                <IconX size={10} aria-hidden />
              </button>
            ))
          )}
        </div>
        <textarea
          className="experts-instruction"
          rows={2}
          value={instruction}
          placeholder={t("experts.instructionPlaceholder")}
          aria-label={t("experts.instruction")}
          onChange={(event) => setInstruction(event.target.value)}
        />
        <div className="experts-team-actions">
          <button
            type="button"
            className="expert-use"
            onClick={launchPanel}
            disabled={team.length === 0 || !instruction.trim()}
          >
            {t("experts.launch")}
          </button>
        </div>
      </section>
    </div>
  );
}
