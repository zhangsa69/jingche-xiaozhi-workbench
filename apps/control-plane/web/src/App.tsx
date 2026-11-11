import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Shell } from "./components/Shell";
import type { ViewId } from "./components/Shell";
import { Button } from "./components/ui";
import { ToastProvider } from "./components/feedback";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { UsersPage } from "./pages/UsersPage";
import { GatewaysPage } from "./pages/GatewaysPage";
import { QuotaPage } from "./pages/QuotaPage";
import { LedgerPage } from "./pages/LedgerPage";
import { AuditPage } from "./pages/AuditPage";
import { SystemPage } from "./pages/SystemPage";
import { MyQuotaPage } from "./pages/MyQuotaPage";
import { api } from "./lib/api";
import { clearSession, loadSession, saveSession } from "./lib/session";
import type { StoredSession } from "./lib/session";
import type { AuthPayload, MeResponse } from "./types";

export default function App() {
  const [session, setSession] = useState<StoredSession | null>(() => loadSession());
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(Boolean(session));
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>("overview");

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.me();
      setMe(data);
      setView((current) => (data.user.role === "admin" ? current : "home"));
    } catch (failure) {
      console.error("loading profile failed", failure);
      setError(failure instanceof Error ? failure.message : "无法连接管控中心");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .me()
      .then((data) => {
        if (cancelled) {
          return;
        }
        setMe(data);
        setView(data.user.role === "admin" ? "overview" : "home");
        setError(null);
      })
      .catch((failure: unknown) => {
        console.error("loading profile failed", failure);
        if (!cancelled) {
          setError(failure instanceof Error ? failure.message : "无法连接管控中心");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    const handler = () => {
      setSession(null);
      setMe(null);
    };
    window.addEventListener("cp:signed-out", handler);
    return () => window.removeEventListener("cp:signed-out", handler);
  }, []);

  const handleSignedIn = (payload: AuthPayload) => {
    saveSession({ accessToken: payload.accessToken, refreshToken: payload.refreshToken, user: payload.user });
    setSession({ accessToken: payload.accessToken, refreshToken: payload.refreshToken, user: payload.user });
  };

  const handleSignOut = () => {
    const refreshToken = session?.refreshToken;
    if (refreshToken) {
      api.logout(refreshToken).catch((failure) => console.error("logout failed", failure));
    }
    clearSession();
    setSession(null);
    setMe(null);
  };

  return (
    <ToastProvider>
      {!session ? (
        <LoginPage onSignedIn={handleSignedIn} />
      ) : loading && !me ? (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin text-brand-400" />
          <p className="text-sm">正在同步账号与小智豆配额…</p>
        </div>
      ) : !me ? (
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="surface w-full max-w-md p-6 text-center">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-300" />
            <h1 className="text-lg font-semibold text-white">无法连接管控中心</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-400">
              {error ?? "服务暂时不可用，请稍后重试或联系管理员。"}
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <Button onClick={reload} loading={loading}>
                重新同步
              </Button>
              <Button variant="secondary" onClick={handleSignOut}>
                退出登录
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Shell user={me.user} active={view} onNavigate={setView} onSignOut={handleSignOut} healthLabel="服务正常">
          {view === "overview" ? <OverviewPage /> : null}
          {view === "users" ? <UsersPage onChanged={reload} /> : null}
          {view === "gateways" ? <GatewaysPage /> : null}
          {view === "quota" ? <QuotaPage /> : null}
          {view === "ledger" ? <LedgerPage /> : null}
          {view === "audit" ? <AuditPage /> : null}
          {view === "system" ? <SystemPage /> : null}
          {view === "home" ? <MyQuotaPage me={me} onRefresh={reload} /> : null}
        </Shell>
      )}
    </ToastProvider>
  );
}
