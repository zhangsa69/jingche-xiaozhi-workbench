import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { ControlPlaneStatus } from "@pi-desktop/shared";
import { BrandLogo } from "../../components/BrandLogo";
import { api } from "../../lib/api";
import { ControlPlaneSignIn } from "./ControlPlaneSignIn";
import { useAppStore } from "../../stores/app-store";

type GatePhase = "loading" | "signedOut" | "signedIn" | "blocked" | "inactive";

type ControlPlaneContextValue = {
  status: ControlPlaneStatus | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

type GateProblem = { title: string; detail: string; hint: string };

const ControlPlaneContext = createContext<ControlPlaneContextValue>({
  status: null,
  refresh: async () => undefined,
  signOut: async () => undefined,
});

export function useControlPlane(): ControlPlaneContextValue {
  return useContext(ControlPlaneContext);
}

/**
 * True when the company control plane owns the model setup.
 *
 * The main process creates the gateway provider row and keeps its credential
 * current, so a company-managed deployment must not offer provider or model
 * configuration to the employee: picking another model there would either be
 * overwritten on the next sync or spend the employee's own credit.
 */
export function useManagedModels(): boolean {
  return useControlPlane().status?.required === true;
}

const SHELL_CLASS =
  "control-plane-shell fixed inset-0 flex items-center justify-center overflow-y-auto bg-bg-under p-6 text-text-primary";

// Soft accent bloom behind the card; painted inline so the token cascade keeps
// owning every real surface colour.
const SHELL_STYLE: CSSProperties = {
  backgroundImage:
    "radial-gradient(900px 480px at 18% -12%, color-mix(in oklab, var(--ds-accent) 14%, transparent), transparent 62%)," +
    "radial-gradient(720px 420px at 88% 8%, color-mix(in oklab, var(--ds-info) 10%, transparent), transparent 58%)",
};

const CARD_CLASS =
  "control-plane-card panel-card w-full max-w-md border border-border-default bg-bg-secondary/70 p-6 shadow-2xl backdrop-blur-xl";

const UNREACHABLE_HINT =
  "为避免使用过期额度，客户端在无法确认配额时不会进入工作台。请检查网络或联系管理员。";

const MISCONFIGURED_HINT =
  "客户端地址由管理员通过 PI_DESKTOP_CONTROL_PLANE_URL 配置，修改后需要重新启动客户端。";

/**
 * Blocks the workspace until the employee is authenticated against the company
 * control plane. When no control plane is configured the app runs exactly as
 * before, so local development and existing deployments keep working.
 */
export function ControlPlaneGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ControlPlaneStatus | null>(null);
  const [phase, setPhase] = useState<GatePhase>("loading");
  const [problem, setProblem] = useState<GateProblem | null>(null);
  const showToast = useAppStore((state) => state.showToast);

  const apply = useCallback((next: ControlPlaneStatus) => {
    setStatus(next);
    setProblem(null);
    if (!next.required) {
      setPhase("inactive");
      return;
    }
    if (next.signedIn) {
      setPhase("signedIn");
      return;
    }
    if (!next.baseUrl) {
      // Configured but unusable: signing in is impossible, so block rather
      // than drop the employee into a workspace with no entitlement check.
      setProblem({
        title: "管控中心地址配置有误",
        detail: next.error ?? "客户端无法解析管控中心地址",
        hint: MISCONFIGURED_HINT,
      });
      setPhase("blocked");
      return;
    }
    setPhase("signedOut");
  }, []);

  const loadSeq = useRef(0);

  // `silent` re-reads the status behind an already-painted gate: the workspace
  // must never flash back to the connecting card just because the balance
  // changed or a turn was charged.
  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      const seq = (loadSeq.current += 1);
      if (!silent) setPhase("loading");
      try {
        const next = await api.controlPlaneStatus();
        // A newer read already answered; applying this one would show a state
        // the employee has already left.
        if (seq !== loadSeq.current) return;
        apply(next);
      } catch (error) {
        if (seq !== loadSeq.current) return;
        console.error("control plane status failed", error);
        setProblem({
          title: "无法连接管控中心",
          detail: error instanceof Error ? error.message : "服务暂时不可用",
          hint: UNREACHABLE_HINT,
        });
        setPhase("blocked");
      }
    },
    [apply],
  );

  useEffect(() => {
    // Outside Electron (renderer-only UI work) there is no preload bridge and
    // therefore no identity to check; the workspace runs as it did before.
    if (!window.piDesktop?.invoke) {
      setPhase("inactive");
      return;
    }
    void load();
  }, [load]);

  // Main-process session changes (remote revoke, logout, a charged turn) re-run
  // the gate in the background; a signed-in workspace stays painted throughout.
  useEffect(() => {
    return api.onControlPlaneChanged(() => {
      void load({ silent: true });
    });
  }, [load]);

  const refresh = useCallback(async () => {
    try {
      apply(await api.controlPlaneRefreshProfile());
    } catch (error) {
      console.error("refreshing control plane profile failed", error);
    }
  }, [apply]);

  const signOut = useCallback(async () => {
    try {
      await api.controlPlaneLogout();
    } catch (error) {
      console.error("control plane sign out failed", error);
    }
    await load();
  }, [load]);

  const handleSignedIn = useCallback(
    (next: ControlPlaneStatus) => {
      apply(next);
      const beans = next.quota?.balanceBeans ?? next.user?.balanceBeans ?? 0;
      showToast(`已登录 · 剩余 ${beans.toLocaleString("zh-CN")} 小智豆`, { variant: "success" });
    },
    [apply, showToast],
  );

  const value = useMemo<ControlPlaneContextValue>(
    () => ({ status, refresh, signOut }),
    [status, refresh, signOut],
  );

  if (phase === "inactive" || phase === "signedIn") {
    return <ControlPlaneContext.Provider value={value}>{children}</ControlPlaneContext.Provider>;
  }

  if (phase === "loading") {
    return (
      <div className={SHELL_CLASS} style={SHELL_STYLE}>
        <div className={`${CARD_CLASS} text-center`}>
          <div className="mx-auto mb-3.5 flex h-10 w-10 animate-pulse items-center justify-center rounded-xl bg-bg-tertiary/70 ring-1 ring-border-default/60">
            <BrandLogo size={32} />
          </div>
          <p className="m-0 text-base text-text-primary">正在连接京车小智管控中心…</p>
          <p className="m-0 mt-1.5 text-sm text-text-muted">校验登录状态并同步小智豆配额</p>
        </div>
      </div>
    );
  }

  if (phase === "blocked") {
    return (
      <div className={SHELL_CLASS} style={SHELL_STYLE}>
        <div className={CARD_CLASS}>
          <h1 className="m-0 text-lg font-semibold text-text-primary">{problem?.title ?? "无法连接管控中心"}</h1>
          <p className="m-0 mt-2 break-words text-md leading-body text-text-secondary">
            {problem?.detail ?? "服务暂时不可用"}
          </p>
          <p className="m-0 mt-2.5 text-sm leading-body text-error">{problem?.hint ?? UNREACHABLE_HINT}</p>
          <button type="button" onClick={() => void load()} className="btn btn-primary mt-5 w-full py-2.5">
            重新检查
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={SHELL_CLASS} style={SHELL_STYLE}>
      <ControlPlaneSignIn
        baseUrl={status?.baseUrl ?? null}
        initialError={status?.error ?? null}
        onSignedIn={handleSignedIn}
      />
    </div>
  );
}
