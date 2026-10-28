import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { AgentInstructionFile } from "@pi-desktop/shared";
import { api } from "../lib/api";
import { claimEscapeLayer } from "../lib/modal-escape-stack";
import { Button, Textarea, TooltipButton } from "./ui";
import { IconClose } from "./icons";

export function ProjectInstructionsDialog({
  project,
  onClose,
  onSaved,
  onError,
}: {
  project: { name: string; path: string; groupId?: string; legacy?: boolean };
  onClose: () => void;
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const [file, setFile] = useState<AgentInstructionFile | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  // A failed read leaves `file` null, which disables the editor and the save
  // button. Track the failure separately so the dialog can offer a retry
  // instead of staying permanently read-only.
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    const load = project.groupId && !project.legacy
      ? api.getProjectGroupInstructions(project.groupId).then((result) => ({
          project: {
            scope: "project" as const,
            path: "ChatGPT Project instructions",
            content: result.content,
            exists: true,
          },
        }))
      : api.getAgentInstructions(project.path);
    void load.then((result) => {
      if (cancelled || !result.project) return;
      setFile(result.project);
      setDraft(result.project.content);
    }).catch((error) => {
      if (cancelled) return;
      setLoadError(error);
      onError(error);
    });
    return () => {
      cancelled = true;
    };
  }, [project.groupId, project.legacy, project.path, loadAttempt]);

  useEffect(() => {
    const layer = claimEscapeLayer();
    const onKeyDown = (event: KeyboardEvent) => {
      // Only the dialog on top closes, and never mid-save.
      if (event.key !== "Escape" || saving || !layer.isTop()) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      layer.release();
    };
  }, [onClose, saving]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const handle = requestAnimationFrame(() => {
      const target = dialogRef.current?.querySelector<HTMLElement>("textarea");
      (target ?? dialogRef.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(handle);
      previouslyFocused?.focus?.();
    };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      if (project.groupId && !project.legacy) {
        const result = await api.saveProjectGroupInstructions(project.groupId, draft);
        setFile((current) => current ? { ...current, content: result.content, exists: true } : current);
      } else {
        const result = await api.saveAgentInstructions("project", draft, project.path);
        setFile(result.file);
      }
      onSaved();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  };

  const dirty = file !== null && draft !== file.content;
  const dialog = (
    <div
      className="overlay project-instructions-dialog-overlay"
      role="presentation"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="dialog project-instructions-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-instructions-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="project-instructions-dialog-head">
          <div>
            <h3 id="project-instructions-dialog-title" className="project-instructions-dialog-title">
              {t("project.editInstructions")}
            </h3>
            <div className="project-instructions-dialog-project">{project.name}</div>
          </div>
          <TooltipButton
            type="button"
            className="project-instructions-dialog-close"
            tooltip={t("settings.cancel")}
            ariaLabel={t("settings.cancel")}
            disabled={saving}
            onClick={onClose}
          >
            <IconClose size={16} />
          </TooltipButton>
        </div>
        <div className="project-instructions-dialog-path">{file?.path ?? ""}</div>
        {loadError ? (
          <div className="project-instructions-dialog-error" role="alert">
            <span>{t("project.loadFailed")}</span>
            <Button
              variant="ghost"
              onClick={() => setLoadAttempt((count) => count + 1)}
            >
              {t("project.retryLoad")}
            </Button>
          </div>
        ) : null}
        <Textarea
          className="settings-instruction-editor project-instructions-dialog-editor"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={t("project.editInstructions")}
          disabled={!file || saving}
        />
        <div className="project-instructions-dialog-actions">
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {t("settings.cancel")}
          </Button>
          <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? t("settings.saving") : t("settings.instructionsSave")}
          </Button>
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined"
    ? dialog
    : createPortal(dialog, document.body);
}
