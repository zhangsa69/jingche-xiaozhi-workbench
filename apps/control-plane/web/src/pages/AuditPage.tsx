import { useCallback, useEffect, useState } from "react";
import { ScrollText, Search } from "lucide-react";
import { Button, Card, EmptyState, ErrorBanner, Pill, Select, SkeletonRows } from "../components/ui";
import { api } from "../lib/api";
import { actionLabel, formatDateTime, relativeTime } from "../lib/format";
import type { AuditEntry } from "../types";

const PAGE_SIZE = 25;

const ACTIONS = [
  { value: "", label: "全部事件" },
  { value: "auth.login", label: "员工登录" },
  { value: "auth.login_failed", label: "登录失败" },
  { value: "auth.registered", label: "员工注册" },
  { value: "auth.password_reset", label: "重置密码" },
  { value: "admin.user_updated", label: "修改员工" },
  { value: "admin.quota_granted", label: "调整配额" },
  { value: "admin.gateway_created", label: "新增网关" },
  { value: "admin.gateway_updated", label: "修改网关" },
  { value: "admin.gateway_deleted", label: "删除网关" },
  { value: "admin.quota_policy_updated", label: "更新配额策略" },
];

export function AuditPage() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.audit({ page, pageSize: PAGE_SIZE, action: action || undefined, query: query || undefined });
      setItems(result.items);
      setTotal(result.total);
    } catch (failure) {
      console.error("loading audit log failed", failure);
      setError(failure instanceof Error ? failure.message : "无法加载审计日志");
    } finally {
      setLoading(false);
    }
  }, [page, action, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-white">审计日志</h1>
          <p className="mt-1 text-[13px] text-slate-400">共 {total} 条记录，覆盖登录、配额与网关配置变更。</p>
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setQuery(draft.trim());
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="搜索操作人或事件"
              className="field-input w-[200px] pl-9 py-2 text-[12px]"
            />
          </div>
          <Select
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
            className="w-[150px] py-2 text-[12px]"
          >
            {ACTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary" className="px-3 py-2 text-[12px]">
            筛选
          </Button>
        </form>
      </header>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <Card className="p-0">
        {loading && items.length === 0 ? (
          <div className="p-5">
            <SkeletonRows rows={7} />
          </div>
        ) : items.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={<ScrollText className="h-6 w-6" />}
              title="没有匹配的审计事件"
              description="调整筛选条件，或等待员工登录与管理员操作产生事件。"
            />
          </div>
        ) : (
          <ol className="relative px-5 py-4">
            <span className="absolute left-[30px] top-6 bottom-6 w-px bg-gradient-to-b from-brand-500/40 via-white/10 to-transparent" />
            {items.map((entry) => (
              <li key={entry.id} className="relative flex gap-4 py-3">
                <span className="relative z-10 mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-brand-400/40 bg-ink-900">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-slate-100">{actionLabel(entry.action)}</span>
                    <Pill tone={entry.action.includes("failed") ? "danger" : "neutral"}>
                      <span className="font-mono text-[10px]">{entry.action}</span>
                    </Pill>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {entry.actorEmail ?? "系统"} · {entry.ip ?? "未知来源"} · {relativeTime(entry.createdAt)}
                  </p>
                  {entry.detail ? (
                    <pre className="mt-1.5 max-h-24 overflow-auto rounded-lg bg-ink-950/60 px-3 py-2 font-mono text-[10px] leading-relaxed text-slate-500">
                      {entry.detail}
                    </pre>
                  ) : null}
                </div>
                <span className="hidden shrink-0 text-[11px] text-slate-600 sm:block">{formatDateTime(entry.createdAt)}</span>
              </li>
            ))}
          </ol>
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
