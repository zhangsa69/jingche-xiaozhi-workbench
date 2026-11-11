import { useCallback, useEffect, useState } from "react";
import { Coins, RefreshCw, Server, ShieldCheck, TrendingUp } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, CardTitle, EmptyState, ErrorBanner, Pill, ProgressBar, SkeletonRows } from "../components/ui";
import { api } from "../lib/api";
import { formatBeans, formatDateTime, formatDay, formatNumber, percent, periodLabels } from "../lib/format";
import type { DailyUsage, MeResponse } from "../types";

interface MyQuotaPageProps {
  me: MeResponse;
  onRefresh: () => Promise<void>;
}

export function MyQuotaPage({ me, onRefresh }: MyQuotaPageProps) {
  const [trend, setTrend] = useState<DailyUsage[]>([]);
  const [totals, setTotals] = useState({ beans: 0, requests: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.myUsage(30);
      setTrend(result.trend);
      setTotals({ beans: result.totalBeans, requests: result.totalRequests });
    } catch (failure) {
      console.error("loading personal usage failed", failure);
      setError(failure instanceof Error ? failure.message : "无法加载个人用量");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const quota = me.quota;
  const periodRatio = percent(quota.periodUsedBeans, quota.periodLimitBeans);
  const balanceRatio = percent(quota.balanceBeans, Math.max(quota.balanceBeans, quota.lifetimeGrantedBeans, 1));

  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
      await loadUsage();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-white">我的额度</h1>
          <p className="mt-1 text-[13px] text-slate-400">
            {me.service.name} · 账号 {me.user.email}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void refresh()} loading={refreshing} icon={<RefreshCw className="h-4 w-4" />}>
          同步额度
        </Button>
      </header>

      {error ? <ErrorBanner message={error} onRetry={() => void loadUsage()} /> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="surface relative overflow-hidden p-5 lg:col-span-2">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-600/20 via-transparent to-sky-500/10" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[12px] text-slate-300">
                <Coins className="h-4 w-4 text-amber-300" />
                可用小智豆
              </span>
              <Pill tone={quota.availableBeans > 0 ? "success" : "danger"}>
                {quota.availableBeans > 0 ? "额度充足" : "需要补充"}
              </Pill>
            </div>
            <p className="mt-3 font-mono text-[38px] leading-none tracking-tight text-white">{formatBeans(quota.balanceBeans)}</p>
            <p className="mt-2 text-[12px] text-slate-400">
              累计发放 {formatBeans(quota.lifetimeGrantedBeans)} · 累计消耗 {formatBeans(quota.lifetimeUsedBeans)}
            </p>
            <div className="mt-4">
              <ProgressBar value={balanceRatio} />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">进度表示当前余额相对历史发放总额的比例。</p>
          </div>
        </div>

        <Card>
          <CardTitle title="本周期" description={`${periodLabels[quota.period] ?? quota.period}额度限制`} />
          <div className="flex items-end justify-between">
            <p className="font-mono text-[22px] text-white">{formatBeans(quota.periodUsedBeans)}</p>
            <span className="text-[12px] text-slate-500">
              / {quota.periodLimitBeans > 0 ? formatBeans(quota.periodLimitBeans) : "不限"}
            </span>
          </div>
          <div className="mt-3">
            <ProgressBar value={periodRatio} tone={periodRatio > 90 ? "danger" : periodRatio > 70 ? "warning" : "brand"} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            {quota.periodResetsAt ? `${formatDateTime(quota.periodResetsAt)} 重置额度` : "该周期不会自动重置"}
          </p>
          <p className="mt-3 rounded-lg bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            实际可用额度取「账户余额」与「周期剩余」中的较小值：{formatBeans(quota.availableBeans)} 豆。
          </p>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardTitle
            title="近 30 天用量"
            description="每次模型调用后由服务端计量并折算为小智豆。"
            action={<Pill tone="info">{formatNumber(totals.requests)} 次调用</Pill>}
          />
          {loading && trend.length === 0 ? (
            <SkeletonRows rows={5} />
          ) : trend.length === 0 ? (
            <EmptyState
              icon={<TrendingUp className="h-6 w-6" />}
              title="还没有调用记录"
              description="在你的客户端中通过管控中心代理调用模型后，这里会显示每日消耗。"
            />
          ) : (
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="myBeans" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
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
                  />
                  <Area type="monotone" dataKey="beans" stroke="#38bdf8" strokeWidth={2} fill="url(#myBeans)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardTitle title="模型入口" description="服务端代理，密钥不会下发到本地。" action={<Server className="h-4 w-4 text-slate-500" />} />
            {me.gateway ? (
              <div className="space-y-2 text-[12px]">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">网关</span>
                  <span className="text-slate-200">{me.gateway.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">默认模型</span>
                  <span className="font-mono text-slate-200">{me.gateway.model ?? "未指定"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">状态</span>
                  {me.gateway.enabled ? <Pill tone="success">可用</Pill> : <Pill tone="danger">停用</Pill>}
                </div>
                <p className="mt-2 break-all rounded-lg bg-ink-950/60 px-3 py-2 font-mono text-[10px] leading-relaxed text-slate-500">
                  {me.gateway.proxyEndpoint}
                </p>
              </div>
            ) : (
              <EmptyState title="暂无可用网关" description="管理员配置默认网关后，这里会显示模型入口信息。" />
            )}
          </Card>

          <Card>
            <CardTitle title="计费规则" description="由管理员统一维护。" action={<ShieldCheck className="h-4 w-4 text-slate-500" />} />
            <dl className="space-y-2 text-[12px]">
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">输入 1K Token</dt>
                <dd className="font-mono text-slate-200">{formatBeans(me.quotaPolicy.beansPer1kPrompt)} 豆</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">输出 1K Token</dt>
                <dd className="font-mono text-slate-200">{formatBeans(me.quotaPolicy.beansPer1kCompletion)} 豆</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">周期</dt>
                <dd className="text-slate-200">{periodLabels[me.quotaPolicy.period] ?? me.quotaPolicy.period}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              额度不足时请联系管理员补充。所有计量以服务端记录为准，本地展示仅作参考。
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
