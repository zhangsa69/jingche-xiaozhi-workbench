import { useCallback, useEffect, useRef, useState } from "react";
import { formatBeans } from "@pi-desktop/shared";
import { useControlPlane } from "./ControlPlaneGate";

/**
 * Sidebar identity chip: current employee, live Xiaozhi-bean balance, manual
 * quota refresh, and sign-out. Renders nothing when the deployment has no
 * control plane, so local installs keep their previous sidebar.
 */
export function ControlPlaneAccountChip() {
  const { status, refresh, signOut } = useControlPlane();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setConfirming(false);
  }, [open]);

  const runRefresh = useCallback(async () => {
    setBusy(true);
    try {
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const runSignOut = useCallback(async () => {
    setBusy(true);
    try {
      await signOut();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }, [signOut]);

  if (!status?.required || !status.signedIn || !status.user) return null;

  const user = status.user;
  const quota = status.quota;
  const balance = quota?.balanceBeans ?? user.balanceBeans;
  const initial = (user.displayName || user.email).trim().slice(0, 1).toUpperCase();

  return (
    <div className="relative px-2 pb-1" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-bg-hover"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-xs font-medium text-text-secondary">
          {initial || "·"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-text-primary">{user.displayName || user.email}</span>
          <span className="block truncate text-2xs text-text-muted">剩余 {formatBeans(balance)} 小智豆</span>
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="账户与小智豆"
          className="absolute bottom-full left-2 right-2 z-50 mb-2 rounded-md border border-border-default bg-bg-elevated p-3 shadow-2xl backdrop-blur-xl"
        >
          <p className="m-0 truncate text-sm font-medium text-text-primary">{user.displayName || user.email}</p>
          <p className="m-0 mt-0.5 truncate text-2xs text-text-muted">{user.email}</p>

          <dl className="mt-2.5 grid grid-cols-2 gap-2 border-t border-border-subtle pt-2.5 text-xs">
            <div>
              <dt className="m-0 text-text-muted">剩余额度</dt>
              <dd className="m-0 text-text-primary">{formatBeans(balance)}</dd>
            </div>
            <div>
              <dt className="m-0 text-text-muted">本周期已用</dt>
              <dd className="m-0 text-text-primary">{formatBeans(quota?.periodUsedBeans ?? user.todayUsedBeans)}</dd>
            </div>
            <div>
              <dt className="m-0 text-text-muted">今日已用</dt>
              <dd className="m-0 text-text-primary">{formatBeans(user.todayUsedBeans)}</dd>
            </div>
            <div>
              <dt className="m-0 text-text-muted">角色</dt>
              <dd className="m-0 text-text-primary">{user.role === "admin" ? "管理员" : "员工"}</dd>
            </div>
          </dl>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void runRefresh()}
              disabled={busy}
              className="btn btn-secondary flex-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "同步中…" : "刷新配额"}
            </button>
            {confirming ? (
              <button
                type="button"
                onClick={() => void runSignOut()}
                disabled={busy}
                className="btn flex-1 bg-error/90 text-sm text-bg-primary hover:bg-error disabled:cursor-not-allowed disabled:opacity-50"
              >
                确认退出
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={busy}
                className="btn btn-ghost flex-1 text-sm disabled:cursor-not-allowed"
              >
                退出登录
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
