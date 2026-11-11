import { useCallback, useEffect, useState } from "react";
import { Coins, RefreshCw } from "lucide-react";
import { Button, Card, EmptyState, ErrorBanner, Pill, SkeletonRows } from "../components/ui";
import { api } from "../lib/api";
import { formatBeans, formatDateTime } from "../lib/format";
import type { LedgerEntry } from "../types";

const PAGE_SIZE = 20;

const kindLabels: Record<string, { label: string; tone: "success" | "warning" | "info" | "neutral" }> = {
  grant: { label: "发放", tone: "success" },
  charge: { label: "消耗", tone: "warning" },
  adjust: { label: "调整", tone: "info" },
};

export function LedgerPage() {
  const [items, setItems] = useState<LedgerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.ledger({ page, pageSize: PAGE_SIZE, userId: filter.trim() || undefined });
      setItems(result.items);
      setTotal(result.total);
    } catch (failure) {
      console.error("loading ledger failed", failure);
      setError(failure instanceof Error ? failure.message : "无法加载用量账本");
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const grantedTotal = items.filter((entry) => entry.deltaBeans > 0).reduce((sum, entry) => sum + entry.deltaBeans, 0);
  const chargedTotal = items.filter((entry) => entry.deltaBeans < 0).reduce((sum, entry) => sum + Math.abs(entry.deltaBeans), 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-white">用量账本</h1>
          <p className="mt-1 text-[13px] text-slate-400">共 {total} 条记录，每次发放与模型消耗都可追溯。</p>
        </div>
        <Button variant="secondary" onClick={() => void load()} loading={loading} icon={<RefreshCw className="h-4 w-4" />}>
          刷新
        </Button>
      </header>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="surface p-4">
          <p className="text-[12px] text-slate-400">本页发放</p>
          <p className="mt-1 font-mono text-[20px] text-emerald-300">+{formatBeans(grantedTotal)}</p>
        </div>
        <div className="surface p-4">
          <p className="text-[12px] text-slate-400">本页消耗</p>
          <p className="mt-1 font-mono text-[20px] text-rose-300">-{formatBeans(chargedTotal)}</p>
        </div>
        <div className="surface p-4">
          <p className="text-[12px] text-slate-400">净变化</p>
          <p className="mt-1 font-mono text-[20px] text-slate-100">{formatBeans(grantedTotal - chargedTotal)}</p>
        </div>
      </div>

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 px-5 py-3.5">
          <span className="text-[13px] text-slate-300">全部变动</span>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              void load();
            }}
          >
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="按员工 ID 过滤"
              className="field-input w-[200px] py-2 text-[12px]"
            />
            <Button type="submit" variant="secondary" className="px-3 py-2 text-[12px]">
              过滤
            </Button>
          </form>
        </div>

        {loading && items.length === 0 ? (
          <div className="p-5">
            <SkeletonRows rows={6} />
          </div>
        ) : items.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={<Coins className="h-6 w-6" />}
              title="暂无账本记录"
              description="员工注册赠送、管理员发放以及模型调用消耗都会记录在这里。"
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr className="border-b border-white/8">
                  <th className="table-head">时间</th>
                  <th className="table-head">员工</th>
                  <th className="table-head">类型</th>
                  <th className="table-head">说明</th>
                  <th className="table-head text-right">变动</th>
                  <th className="table-head text-right">变动后余额</th>
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => {
                  const kind = kindLabels[entry.kind] ?? { label: entry.kind, tone: "neutral" as const };
                  return (
                    <tr key={entry.id} className="border-b border-white/5 transition hover:bg-white/[0.03]">
                      <td className="table-cell whitespace-nowrap text-[12px] text-slate-400">{formatDateTime(entry.createdAt)}</td>
                      <td className="table-cell">
                        <p className="text-[12px] text-slate-200">{entry.userEmail}</p>
                        <p className="font-mono text-[10px] text-slate-600">{entry.userId.slice(0, 8)}</p>
                      </td>
                      <td className="table-cell">
                        <Pill tone={kind.tone}>{kind.label}</Pill>
                      </td>
                      <td className="table-cell max-w-[240px] truncate text-[12px] text-slate-400">{entry.reason ?? "—"}</td>
                      <td className={`table-cell text-right font-mono text-[13px] ${entry.deltaBeans >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                        {entry.deltaBeans >= 0 ? "+" : ""}
                        {formatBeans(entry.deltaBeans)}
                      </td>
                      <td className="table-cell text-right font-mono text-[13px] text-slate-200">{formatBeans(entry.balanceAfterBeans)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 px-5 py-3.5">
          <span className="text-[12px] text-slate-500">
            第 {page} / {pageCount} 页
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              上一页
            </Button>
            <Button variant="secondary" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>
              下一页
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
