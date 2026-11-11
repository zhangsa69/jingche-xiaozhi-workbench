import { useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  Coins,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Server,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import type { UserView } from "../types";
import { Button, cx, Pill, RolePill } from "./ui";

export type ViewId = "overview" | "users" | "gateways" | "quota" | "ledger" | "audit" | "system" | "home";

interface NavEntry {
  id: ViewId;
  label: string;
  description: string;
  icon: ReactNode;
  adminOnly?: boolean;
}

const NAV: NavEntry[] = [
  { id: "overview", label: "运营总览", description: "用量与健康", icon: <LayoutDashboard className="h-4 w-4" />, adminOnly: true },
  { id: "users", label: "员工管理", description: "账号与额度", icon: <Users className="h-4 w-4" />, adminOnly: true },
  { id: "gateways", label: "网关配置", description: "模型接入", icon: <Server className="h-4 w-4" />, adminOnly: true },
  { id: "quota", label: "配额策略", description: "小智豆规则", icon: <Gauge className="h-4 w-4" />, adminOnly: true },
  { id: "ledger", label: "用量账本", description: "扣减明细", icon: <Coins className="h-4 w-4" />, adminOnly: true },
  { id: "audit", label: "审计日志", description: "安全追踪", icon: <ScrollText className="h-4 w-4" />, adminOnly: true },
  { id: "system", label: "系统状态", description: "运行信息", icon: <Activity className="h-4 w-4" />, adminOnly: true },
  { id: "home", label: "我的额度", description: "个人用量", icon: <ShieldCheck className="h-4 w-4" /> },
];

interface ShellProps {
  user: UserView;
  active: ViewId;
  onNavigate: (view: ViewId) => void;
  onSignOut: () => void;
  healthLabel: string;
  children: ReactNode;
}

export function Shell({ user, active, onNavigate, onSignOut, healthLabel, children }: ShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAdmin = user.role === "admin";
  const entries = NAV.filter((entry) => (entry.adminOnly ? isAdmin : true) || entry.id === "home");

  const select = (view: ViewId) => {
    onNavigate(view);
    setMobileOpen(false);
  };

  return (
    <div className="flex min-h-screen">
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col border-r border-white/8 bg-ink-950/85 px-3 py-5 backdrop-blur-xl transition-transform duration-200 lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-sky-500 shadow-glow">
            <span className="text-sm font-bold text-white">智</span>
          </div>
          <div className="leading-tight">
            <p className="text-[13px] font-semibold text-white">京车小智工作台</p>
            <p className="text-[11px] text-slate-500">管控中心</p>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-white/10 lg:hidden"
            aria-label="关闭导航"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => select(entry.id)}
              className={cx(
                "nav-item text-left",
                active === entry.id
                  ? "bg-gradient-to-r from-brand-600/30 to-transparent text-white ring-1 ring-inset ring-brand-500/30"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
              )}
            >
              <span className={cx("transition", active === entry.id ? "text-brand-400" : "text-slate-500")}>{entry.icon}</span>
              <span className="flex-1">
                <span className="block text-[13px] font-medium">{entry.label}</span>
                <span className="block text-[11px] text-slate-500">{entry.description}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between">
            <Pill tone="success">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {healthLabel}
            </Pill>
            <span className="text-[11px] text-slate-500">服务端权威配额</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            配额与网关配置由服务端统一管理，客户端仅同步只读结果。
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-white/8 bg-ink-950/70 px-4 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/10 lg:hidden"
            aria-label="打开导航"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-slate-200">{user.displayName}</p>
            <p className="truncate text-[11px] text-slate-500">{user.email}</p>
          </div>
          <RolePill role={user.role} />
          <div className="hidden items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-1.5 sm:flex">
            <Coins className="h-3.5 w-3.5 text-amber-300" />
            <span className="font-mono text-[13px] text-slate-100">{user.balanceBeans.toLocaleString("zh-CN")}</span>
            <span className="text-[11px] text-slate-500">小智豆</span>
          </div>
          <Button variant="ghost" onClick={onSignOut} icon={<LogOut className="h-4 w-4" />} className="px-2.5">
            <span className="hidden sm:inline">退出</span>
          </Button>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1180px]">{children}</div>
        </main>
      </div>

      {mobileOpen ? (
        <button
          type="button"
          aria-label="关闭导航遮罩"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-20 bg-ink-950/60 lg:hidden"
        />
      ) : null}
    </div>
  );
}
