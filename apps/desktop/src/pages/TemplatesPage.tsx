import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DOCUMENT_TEMPLATES,
  applyTemplate,
  applyTemplateBatch,
  parseBatchTable,
  renderFileName,
  templateTaskPrompt,
  templateVarKeys,
  templatesByKind,
  type DocumentTemplate,
  type TemplateValues,
} from "@pi-desktop/shared";
import { useAppStore } from "../stores/app-store";
import { IconCopy, IconFileText } from "../components/icons";

const KIND_LABEL_KEYS: Record<DocumentTemplate["kind"], string> = {
  docx: "templates.kindDocx",
  xlsx: "templates.kindSheet",
  pptx: "templates.kindSlides",
};

/** A template is only useful if the filled result is visible before it is sent. */
export function TemplatesPage() {
  const { t } = useTranslation();
  const appendComposerDraftText = useAppStore(
    (state) => state.appendComposerDraftText,
  );
  const setPage = useAppStore((state) => state.setPage);
  const showToast = useAppStore((state) => state.showToast);

  const [activeId, setActiveId] = useState(DOCUMENT_TEMPLATES[0]?.id ?? "");
  const [values, setValues] = useState<TemplateValues>({});
  const [batchText, setBatchText] = useState("");

  const template =
    DOCUMENT_TEMPLATES.find((entry) => entry.id === activeId) ??
    DOCUMENT_TEMPLATES[0];

  const applied = useMemo(
    () => (template ? applyTemplate(template, values) : null),
    [template, values],
  );

  const batch = useMemo(() => {
    if (!template || !batchText.trim()) return null;
    const parsed = parseBatchTable(batchText, template);
    if (!parsed.ok) return { parsed, outcome: null as ReturnType<typeof applyTemplateBatch> | null };
    return { parsed, outcome: applyTemplateBatch(template, parsed.rows) };
  }, [template, batchText]);

  if (!template || !applied) return null;

  const fileName = renderFileName(template, values);
  const prompt = applied.ok
    ? templateTaskPrompt({ template, fileName, blocks: applied.blocks })
    : "";

  const select = (next: DocumentTemplate) => {
    setActiveId(next.id);
    setValues({});
    setBatchText("");
  };

  const insert = (text: string) => {
    if (!text) return;
    appendComposerDraftText(text);
    setPage("chat");
  };

  const copy = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast(t("templates.copied"), { variant: "success" });
    } catch {
      showToast(t("templates.copyFailed"), { variant: "error" });
    }
  };

  const batchPrompt = (() => {
    if (!batch?.outcome?.files.length) return "";
    return batch.outcome.files
      .map((file) =>
        templateTaskPrompt({
          template,
          fileName: file.fileName,
          blocks: file.blocks,
        }),
      )
      .join("\n\n---\n\n");
  })();

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-6 py-5">
      <header>
        <div className="flex items-center gap-2">
          <span className="text-text-muted">
            <IconFileText size={16} />
          </span>
          <h1 className="text-lg font-semibold text-text-primary">
            {t("templates.title")}
          </h1>
        </div>
        <p className="mt-1 max-w-[68ch] text-xs-plus leading-relaxed text-text-muted">
          {t("templates.subtitle")}
        </p>
      </header>

      <div className="grid grid-cols-[minmax(0,260px)_minmax(0,1fr)] gap-4 max-[900px]:grid-cols-1">
        <nav
          className="flex max-h-[calc(100vh-220px)] flex-col gap-4 overflow-y-auto pr-1"
          aria-label={t("templates.title")}
        >
          {templatesByKind().map((group) => (
            <div key={group.kind} className="flex flex-col gap-1">
              <div className="px-2 text-2xs font-medium uppercase text-text-muted">
                {t(KIND_LABEL_KEYS[group.kind])}
              </div>
              {group.templates.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  data-template-id={entry.id}
                  aria-pressed={entry.id === template.id}
                  onClick={() => select(entry)}
                  className={`flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                    entry.id === template.id
                      ? "bg-bg-hover text-text-primary"
                      : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                  }`}
                >
                  <span className="text-md">{t(entry.nameKey)}</span>
                  <span className="line-clamp-2 text-2xs text-text-muted">
                    {t(entry.descriptionKey)}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <section className="flex flex-col gap-4">
          <div className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
            <h2 className="text-md-plus font-medium text-text-primary">
              {t(template.nameKey)}
            </h2>
            <p className="mt-0.5 text-xs-plus text-text-muted">
              {t(template.descriptionKey)}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2.5 max-[720px]:grid-cols-1">
              {template.vars.map((variable) => (
                <label key={variable.key} className="flex flex-col gap-1">
                  <span className="text-2xs text-text-muted">
                    {variable.key}
                    {variable.required ? (
                      <span aria-hidden className="ml-0.5 text-error">
                        *
                      </span>
                    ) : null}
                  </span>
                  <input
                    className="rounded-md border border-border-subtle bg-bg-inset px-2 py-1 text-md text-text-primary outline-none focus-visible:border-border-strong"
                    value={values[variable.key] ?? ""}
                    placeholder={variable.example}
                    data-template-var={variable.key}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [variable.key]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>

            {!applied.ok ? (
              <p className="mt-3 text-xs-plus text-error" role="status">
                {t("templates.missing", {
                  keys: applied.missing.join(", "),
                })}
              </p>
            ) : null}
            {applied.warnings.length ? (
              <p className="mt-2 text-2xs text-text-muted" role="status">
                {t("templates.warnings", {
                  keys: [
                    ...new Set(
                      applied.warnings.map((item) =>
                        item.kind === "assumedOrder" ? "columnOrder" : item.key,
                      ),
                    ),
                  ].join(", "),
                })}
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="rounded bg-bg-chip px-2 py-0.5 text-2xs text-text-secondary">
                {fileName}
              </code>
              <button
                type="button"
                className="rounded-md border border-border-subtle px-2.5 py-1 text-xs-plus text-text-primary hover:bg-bg-hover disabled:opacity-50"
                onClick={() => insert(prompt)}
                disabled={!applied.ok}
                data-testid="templates-insert"
              >
                {t("templates.insert")}
              </button>
              <button
                type="button"
                className="flex items-center gap-1 rounded-md border border-border-subtle px-2.5 py-1 text-xs-plus text-text-primary hover:bg-bg-hover disabled:opacity-50"
                onClick={() => void copy(prompt)}
                disabled={!applied.ok}
              >
                <IconCopy size={13} />
                {t("templates.copy")}
              </button>
            </div>

            <pre className="mt-3 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg-chip p-2.5 text-2xs leading-relaxed text-text-secondary">
              {applied.ok ? prompt : t("templates.previewEmpty")}
            </pre>
          </div>

          <details className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
            <summary className="cursor-pointer text-md-plus text-text-primary">
              {t("templates.batchTitle")}
            </summary>
            <p className="mt-1 text-xs-plus text-text-muted">
              {t("templates.batchHint", {
                keys: templateVarKeys(template).join(", "),
              })}
            </p>
            <textarea
              className="mt-2 h-28 w-full resize-y rounded-md border border-border-subtle bg-bg-inset p-2 font-mono text-2xs text-text-primary outline-none focus-visible:border-border-strong"
              value={batchText}
              placeholder={t("templates.batchPlaceholder")}
              onChange={(event) => setBatchText(event.target.value)}
              data-testid="templates-batch-input"
            />
            {batch ? (
              batch.parsed.ok && batch.outcome ? (
                <div className="mt-2 flex flex-col gap-1.5">
                  <div className="text-2xs text-text-muted">
                    {t("templates.batchSummary", {
                      files: batch.outcome.files.length,
                      skipped: batch.outcome.skipped.length,
                    })}
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {batch.outcome.files.map((file) => (
                      <li key={file.fileName} className="text-2xs text-text-secondary">
                        {file.fileName}
                      </li>
                    ))}
                    {batch.outcome.skipped.map((entry) => (
                      <li key={entry.index} className="text-2xs text-error">
                        {t("templates.batchSkipped", {
                          row: entry.index + 1,
                          keys: entry.missing.join(", "),
                        })}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-border-subtle px-2.5 py-1 text-xs-plus text-text-primary hover:bg-bg-hover disabled:opacity-50"
                      onClick={() => insert(batchPrompt)}
                      disabled={!batchPrompt}
                    >
                      {t("templates.batchInsert")}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-border-subtle px-2.5 py-1 text-xs-plus text-text-primary hover:bg-bg-hover disabled:opacity-50"
                      onClick={() => void copy(batchPrompt)}
                      disabled={!batchPrompt}
                    >
                      {t("templates.copy")}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-2xs text-error">
                  {batch.parsed.ok
                    ? t("templates.batchEmpty")
                    : t(`templates.batchError.${batch.parsed.reason}`)}
                </p>
              )
            ) : null}
          </details>
        </section>
      </div>
    </div>
  );
}
