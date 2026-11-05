import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { WORKSPACE_TOOL_IDS, type WorkspaceToolId } from "@pi-desktop/shared";
import { useAppStore } from "../stores/app-store";
import { api } from "../lib/api";
import {
  IconExternal,
  IconFileText,
  IconNotebook,
  IconPencil,
  IconToolbox,
  IconWorkflow,
} from "./icons";
import { TooltipButton } from "./ui";

/*
  The companion tools are intranet web apps on their own hosts, so they open in
  the system browser instead of a pane: a pane would carry this app's session and
  a failed load would look like a broken workbench. The renderer only sends a
  tool id; Main owns the addresses (D428).
*/
const TOOL_ICONS: Record<WorkspaceToolId, typeof IconFileText> = {
  pdf: IconFileText,
  cad: IconPencil,
  mindmap: IconWorkflow,
  minutes: IconNotebook,
};

const MENU_WIDTH = 208;
const EDGE_MARGIN = 8;
const ANCHOR_GAP = 6;

type Anchor = { left: number; bottom: number };

export function ToolsMenu() {
  const { t } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState<WorkspaceToolId | null>(null);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setAnchor(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // The chip sits at the sidebar's right edge, so the panel hangs upward with
    // its right edge on the chip; the clamps keep it on screen in a narrow window.
    const left = Math.min(
      Math.max(EDGE_MARGIN, rect.right - MENU_WIDTH),
      Math.max(EDGE_MARGIN, window.innerWidth - MENU_WIDTH - EDGE_MARGIN),
    );
    setAnchor({ left, bottom: window.innerHeight - rect.top + ANCHOR_GAP });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => firstItemRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    // A moved or resized window invalidates the fixed anchor.
    const onViewportChange = () => close(false);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("blur", onViewportChange);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("blur", onViewportChange);
    };
  }, [open, close]);

  const launch = useCallback(
    async (toolId: WorkspaceToolId) => {
      close(true);
      setBusy(toolId);
      try {
        await api.openWorkspaceTool(toolId);
      } catch (error) {
        showToast(
          error instanceof Error && error.message
            ? `${t("tools.openFailed")}: ${error.message}`
            : t("tools.openFailed"),
          { variant: "error" },
        );
      } finally {
        setBusy(null);
      }
    },
    [close, showToast, t],
  );

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (current + 1) % items.length
            : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <>
      <TooltipButton
        ref={triggerRef}
        type="button"
        className="footer-toolset"
        data-nav="tools"
        tooltip={t("tools.title")}
        ariaLabel={t("tools.title")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "tools-menu" : undefined}
        onClick={() => (open ? close(true) : openMenu())}
      >
        <IconToolbox size={14} aria-hidden />
      </TooltipButton>
      {open && anchor
        ? createPortal(
            <div
              ref={menuRef}
              id="tools-menu"
              className="sidebar-popover sidebar-floating-menu tools-menu"
              role="menu"
              aria-label={t("tools.title")}
              onKeyDown={onMenuKeyDown}
              style={{ left: anchor.left, bottom: anchor.bottom }}
            >
              <div className="sidebar-popover-title">{t("tools.title")}</div>
              {WORKSPACE_TOOL_IDS.map((toolId, index) => {
                const Icon = TOOL_ICONS[toolId];
                return (
                  <button
                    key={toolId}
                    ref={index === 0 ? firstItemRef : undefined}
                    type="button"
                    role="menuitem"
                    data-tool={toolId}
                    disabled={busy !== null}
                    onClick={() => void launch(toolId)}
                  >
                    <Icon size={14} aria-hidden />
                    <span>{t(`tools.${toolId}`)}</span>
                    <IconExternal
                      size={12}
                      aria-hidden
                      className="tools-menu-external"
                    />
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
