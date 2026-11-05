import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { IconExternal, IconFolderOpen } from "../icons";

/*
  Right-click actions for a file row in the work panel. The panel previews on a
  single click, so these are the two things a preview cannot do: hand the file to
  the OS default app, or reveal it in the file manager. Both calls go through the
  existing `fs/open` and `fs/reveal` channels, which keep the containment check.
*/

const EDGE_MARGIN = 8;

export type FileContextMenuProps = {
  /** Absolute or workspace-relative path; also names the menu for screen readers. */
  path: string;
  x: number;
  y: number;
  onOpenExternal: () => void;
  onReveal: () => void;
  onClose: () => void;
};

export function FileContextMenu({
  path,
  x,
  y,
  onOpenExternal,
  onReveal,
  onClose,
}: FileContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Measure before paint so a click near an edge never opens a clipped menu.
  useLayoutEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(EDGE_MARGIN, Math.min(x, window.innerWidth - rect.width - EDGE_MARGIN)),
      top: Math.max(EDGE_MARGIN, Math.min(y, window.innerHeight - rect.height - EDGE_MARGIN)),
    });
  }, [x, y]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => firstItemRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || menuRef.current?.contains(target)) return;
      onClose();
    };
    // A moved or resized window invalidates the fixed anchor.
    const onViewportChange = () => onClose();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("blur", onViewportChange);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("blur", onViewportChange);
    };
  }, [onClose]);

  const run = (action: () => void) => {
    onClose();
    action();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Tab") {
      onClose();
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

  return createPortal(
    <div
      ref={menuRef}
      className="file-context-menu"
      role="menu"
      aria-label={path}
      style={{ left: position.left, top: position.top }}
      onKeyDown={onKeyDown}
    >
      <button
        ref={firstItemRef}
        type="button"
        role="menuitem"
        onClick={() => run(onOpenExternal)}
      >
        <IconExternal size={13} aria-hidden />
        <span>{t("panel.files.preview.openExternal")}</span>
      </button>
      <button type="button" role="menuitem" onClick={() => run(onReveal)}>
        <IconFolderOpen size={13} aria-hidden />
        <span>{t("panel.files.revealInFolder")}</span>
      </button>
    </div>,
    document.body,
  );
}
