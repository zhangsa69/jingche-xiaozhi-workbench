import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addLibrarySource,
  libraryStatus,
  removeLibrarySource,
  type LibrarySource,
} from "@pi-desktop/shared";
import { api } from "../lib/api";
import { loadLibrarySources, saveLibrarySources } from "../lib/library-store";
import { useAppStore } from "../stores/app-store";
import { IconFolder, IconPlus, IconTrash } from "../components/icons";

function formatAddedAt(addedAt: number, locale: string): string {
  if (!addedAt) return "";
  const date = new Date(addedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Library page (W-26): folders the user keeps on hand across workspaces.
 *
 * Entries are pointers, not copies. Removing one never touches disk, and the
 * page says so — a "library" that silently deleted files would be unusable.
 */
export function LibraryPage() {
  const { t, i18n } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);

  const [sources, setSources] = useState<LibrarySource[]>(() => loadLibrarySources());
  const [activeId, setActiveId] = useState<string>("");
  const [picking, setPicking] = useState(false);

  const status = useMemo(() => libraryStatus(sources), [sources]);
  const active = sources.find((source) => source.id === activeId) ?? sources[0] ?? null;

  const commit = (next: LibrarySource[]) => {
    setSources(next);
    saveLibrarySources(next);
  };

  const addFolders = async () => {
    if (picking) return;
    setPicking(true);
    const result = await api.pickProjectFolders();
    setPicking(false);
    if (result.canceled) return;
    let next = sources;
    let added = 0;
    let duplicate = 0;
    let rejected = 0;
    for (const folder of result.folders ?? []) {
      const outcome = addLibrarySource(next, { path: folder, kind: "folder" });
      next = outcome.sources;
      if (outcome.ok) added += 1;
      else if (outcome.reason === "duplicate") duplicate += 1;
      else rejected += 1;
    }
    commit(next);
    if (added > 0) {
      showToast(t("library.added", { count: added }), { variant: "success" });
    } else if (duplicate > 0) {
      showToast(t("library.duplicate"), { variant: "info" });
    } else if (rejected > 0) {
      showToast(t("library.limit"), { variant: "error" });
    }
  };

  const remove = (source: LibrarySource) => {
    const next = removeLibrarySource(sources, source.id);
    commit(next);
    if (activeId === source.id) setActiveId("");
    showToast(t("library.removed", { name: source.name }), { variant: "success" });
  };

  const copyReference = async (source: LibrarySource) => {
    const reference = `@${source.path}${source.kind === "folder" ? "/" : ""}`;
    try {
      await navigator.clipboard.writeText(reference);
      showToast(t("library.copied"), { variant: "success" });
    } catch {
      showToast(t("library.copyFailed"), { variant: "error" });
    }
  };

  return (
    <div className="library-page">
      <header className="library-head">
        <div>
          <h1 className="text-md-plus font-semibold text-text-primary">
            {t("library.title")}
          </h1>
          <p className="mt-1 text-xs-plus text-text-muted">{t("library.subtitle")}</p>
        </div>
        <button
          type="button"
          className="library-add"
          onClick={() => void addFolders()}
          disabled={picking}
        >
          <IconPlus size={13} aria-hidden />
          {picking ? t("library.adding") : t("library.addFolder")}
        </button>
      </header>

      {status === "empty" ? (
        <section className="library-empty">
          <IconFolder size={20} aria-hidden />
          <p className="text-sm-plus text-text-primary">{t("library.empty")}</p>
          <p className="mt-1 text-xs-plus text-text-muted">{t("library.emptyHint")}</p>
        </section>
      ) : (
        <div className="library-body">
          <ul className="library-list" aria-label={t("library.title")}>
            {sources.map((source) => (
              <li key={source.id}>
                <button
                  type="button"
                  className={`library-row ${active?.id === source.id ? "active" : ""}`}
                  onClick={() => setActiveId(source.id)}
                  aria-pressed={active?.id === source.id}
                >
                  <IconFolder size={13} aria-hidden />
                  {source.name}
                </button>
              </li>
            ))}
          </ul>

          {active ? (
            <section className="library-detail">
              <h2 className="text-sm-plus font-semibold text-text-primary">{active.name}</h2>
              <dl className="library-facts">
                <dt>{t("library.path")}</dt>
                <dd className="font-mono text-2xs">{active.path}</dd>
                <dt>{t("library.addedAt")}</dt>
                <dd>{formatAddedAt(active.addedAt, i18n.language)}</dd>
              </dl>
              <p className="library-note text-xs-plus text-text-muted">{t("library.refHint")}</p>
              <div className="library-actions">
                <button
                  type="button"
                  className="library-action"
                  onClick={() => void copyReference(active)}
                >
                  {t("library.copyRef")}
                </button>
                <button
                  type="button"
                  className="library-action danger"
                  onClick={() => remove(active)}
                >
                  <IconTrash size={12} aria-hidden />
                  {t("library.remove")}
                </button>
              </div>
              <p className="mt-2 text-2xs text-text-faint">{t("library.removeHint")}</p>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
