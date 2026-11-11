import { useCallback, useEffect, useState } from "react";
import { Activity, Coins, Server, TrendingUp, Users } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, CardTitle, EmptyState, ErrorBanner, Pill, ProgressBar, SkeletonRows } from "../components/ui";
import { api } from "../lib/api";
import { actionLabel, formatBeans, formatDay, formatDateTime, formatNumber, percent, periodLabels, relativeTime } from "../lib/format";
import type { OverviewResponse } from "../types";

interface StatCard {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  accent: string;
}

export function OverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.overview());
    } catch (failure) {
      console.error("loading overview failed", failure);
      setError(failure instanceof Error ? failure.message : "无法加载运营数据");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="surface p-5">
              <div className="skeleton h-3 w-20 rounded" />
              <div className="skeleton mt-4 h-8 w-28 rounded" />
              <div className="skeleton mt-3 h-2 w-full rounded" />
            </div>
          ))}
        </div>
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      </div>
    );
  }

  if (error && !data) {
    return <ErrorBanner message={error} onRetry={() => void load()} />;
  }

  if (!data) {
    return null;
  }

  const usageRatio = percent(data.period.usedBeans, data.period.limitBeans);
  const cards: StatCard[] = [
    {
      label: "员工总数",
      value: formatNumber(data.users.total),
      hint: `正常 ${data.users.active} · 停用 ${data.users.disabled} · 管理员 ${data.users.admins}`,
      icon: <Users className="h-4 w-4" />,
      accent: "from-brand-500/25 to-transparent",
    },
    {
      label: "今日调用",
      value: formatNumber(data.today.requests),
      hint: `消耗 ${formatBeans(data.today.beans)} 小智豆`,
      icon: <Activity className="h-4 w-4" />,
      accent: "from-sky-500/20 to-transparent",
    },
    {
      label: "剩余小智豆",
      value: formatBeans(data.totalBalanceBeans),
      hint: `注册默认赠送 ${formatBeans(data.policy.defaultGrantBeans)} 豆`,
      icon: <Coins className="h-4 w-4" />,
      accent: "from-amber-400/20 to-transparent",
    },
    {
      label: "默认网关",
      value: data.gateway ? data.gateway.name : "未配置",
      hint: data.gateway ? `${data.gateway.provider} · ${data.gateway.model ?? "未指定模型"}` : "请先在网关配置中添加",
      icon: <Server className="h-4 w-4" />,
      accent: "from-emerald-500/20 to-transparent",
    },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-white">运营总览</h1>
          <p className="mt-1 text-[13px] text-slate-400">全公司小智豆消耗、账号状态与网关健康情况。</p>
        </div>
        <Button variant="secondary" onClick={() => void load()} loading={loading}>
          刷新数据
        </Button>
      </header>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="surface relative overflow-hidden p-5">
            <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${card.accent}`} />
            <div className="relative">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium tracking-wide text-slate-400">{card.label}</span>
                <span className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-300">{card.icon}</span>
              </div>
              <p className="mt-3 truncate text-[26px] font-semibold leading-none tracking-tight text-white">{card.value}</p>
              <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-slate-500">{card.hint}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        <Card>
          <CardTitle
            title="近 14 天用量趋势"
            description="按天聚合的小智豆消耗与请求量。"
            action={<Pill tone="info">{data.trend.reduce((sum, item) => sum + item.requests, 0)} 次调用</Pill>}
          />
          {data.trend.length === 0 ? (
            <EmptyState
              icon={<TrendingUp className="h-6 w-6" />}
              title="暂无用量数据"
              description="员工通过管控中心代理调用模型后，这里会显示按天聚合的趋势。"
            />
          ) : (
            <div className="h-[248px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="beansFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                  <XAxis dataKey="day" tickFormatter={formatDay} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(11,20,40,0.95)",
                      border: "1px solid rgba(148,163,184,0.2)",
                      borderRadius: 12,
                      fontSize: 12,
                      color: "#e2e8f4",
                    }}
                    formatter={(value: number) => [`${formatBeans(value)} 小智豆`, "消耗"]}
                    labelFormatter={(label: string) => `日期 ${label}`}
                  />
                  <Area type="monotone" dataKey="beans" stroke="#60a5fa" strokeWidth={2} fill="url(#beansFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardTitle title={`${data.period.label}额度`} description={`策略：${periodLabels[data.policy.period] ?? data.policy.period}`} />
            <div className="flex items-end justify-between">
              <p className="font-mono text-[24px] leading-none text-white">{formatBeans(data.period.usedBeans)}</p>
              <span className="text-[12px] text-slate-500">/ {formatBeans(data.period.limitBeans)} 小智豆</span>
            </div>
            <div className="mt-3">
              <ProgressBar value={usageRatio} tone={usageRatio > 90 ? "danger" : usageRatio > 70 ? "warning" : "brand"} />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              已使用 {usageRatio}%
              {data.period.resetsAt ? ` · ${formatDateTime(data.period.resetsAt)} 重置` : " · 不自动重置"}
            </p>
          </Card>

          <Card>
            <CardTitle title="网关健康" description="默认网关的可用状态与路由目标。" />
            {data.gateway ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-slate-200">{data.gateway.name}</span>
                  {data.gateway.enabled ? <Pill tone="success">启用</Pill> : <Pill tone="danger">停用</Pill>}
                </div>
                <p className="break-all rounded-lg bg-ink-950/60 px-3 py-2 font-mono text-[11px] text-slate-400">
                  {data.gateway.baseUrl}
                </p>
                <div className="flex items-center justify-between text-[12px] text-slate-500">
                  <span>默认模型</span>
                  <span className="text-slate-300">{data.gateway.model ?? "未指定"}</span>
                </div>
                <div className="flex items-center justify-between text-[12px] text-slate-500">
                  <span>凭据</span>
                  <span className="font-mono text-slate-300">{data.gateway.hasApiKey ? data.gateway.apiKeyMasked : "未配置"}</span>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Server className="h-6 w-6" />}
                title="尚未配置网关"
                description="在「网关配置」中添加统一的大模型网关，员工端才能获得模型入口。"
              />
            )}
          </Card>
        </div>
      </div>

      <Card>
        <CardTitle title="最近安全事件" description="登录、配额与网关配置变更的审计摘要。" />
        {data.recentAudit.length === 0 ? (
          <EmptyState title="暂无审计记录" description="管理员操作与员工登录会记录在这里，用于安全追踪。" />
        ) : (
          <ul className="divide-y divide-white/6">
            {data.recentAudit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] text-slate-200">{actionLabel(entry.action)}</p>
                  <p className="truncate text-[11px] text-slate-500">
                    {entry.actorEmail ?? "系统"} · {entry.ip ?? "未知来源"}
                  </p>
                </div>
                <span className="text-[11px] text-slate-500">{relativeTime(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
