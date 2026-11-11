import { useCallback, useEffect, useState } from "react";
import { Coins, Pencil, Search, Users } from "lucide-react";
import { Button, Card, EmptyState, ErrorBanner, Field, Input, Pill, RolePill, Select, SkeletonRows, StatusPill } from "../components/ui";
import { ConfirmDialog, Modal, useToast } from "../components/feedback";
import { UserQuotaDialog } from "../components/UserQuotaDialog";
import { api } from "../lib/api";
import { formatBeans, formatDateTime, relativeTime } from "../lib/format";
import type { UserView } from "../types";

interface UsersPageProps {
  onChanged: () => void;
}

const PAGE_SIZE = 12;

export function UsersPage({ onChanged }: UsersPageProps) {
  const toast = useToast();
  const [items, setItems] = useState<UserView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [draftQuery, setDraftQuery] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserView | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [roleDraft, setRoleDraft] = useState("member");
  const [saving, setSaving] = useState(false);
  const [quotaTarget, setQuotaTarget] = useState<UserView | null>(null);
  const [toggleTarget, setToggleTarget] = useState<UserView | null>(null);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listUsers({ page, pageSize: PAGE_SIZE, query, status });
      setItems(result.items);
      setTotal(result.total);
    } catch (failure) {
      console.error("loading users failed", failure);
      setError(failure instanceof Error ? failure.message : "无法加载员工列表");
    } finally {
      setLoading(false);
    }
  }, [page, query, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (user: UserView) => {
    setEditing(user);
    setNameDraft(user.displayName);
    setRoleDraft(user.role);
  };

  const saveEditor = async () => {
    if (!editing) {
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateUser(editing.id, {
        displayName: nameDraft.trim(),
        role: roleDraft,
      });
      toast.success(`已更新 ${updated.displayName} 的账号信息`);
      setEditing(null);
      await load();
      onChanged();
    } catch (failure) {
      console.error("updating user failed", failure);
      toast.error(failure instanceof Error ? failure.message : "更新失败");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async () => {
    if (!toggleTarget) {
      return;
    }
    setToggling(true);
    try {
      const next = toggleTarget.status === "active" ? "disabled" : "active";
      await api.updateUser(toggleTarget.id, { status: next });
      toast.success(next === "disabled" ? "账号已停用，登录会话已撤销" : "账号已恢复启用");
      setToggleTarget(null);
      await load();
      onChanged();
    } catch (failure) {
      console.error("changing user status failed", failure);
      toast.error(failure instanceof Error ? failure.message : "操作失败");
    } finally {
      setToggling(false);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-white">员工管理</h1>
          <p className="mt-1 text-[13px] text-slate-400">共 {total} 位员工，管理账号状态、角色与小智豆额度。</p>
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setQuery(draftQuery.trim());
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <Input
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              placeholder="搜索邮箱或姓名"
              className="w-[210px] pl-9"
            />
          </div>
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="w-[120px]"
          >
            <option value="">全部状态</option>
            <option value="active">正常</option>
            <option value="disabled">停用</option>
          </Select>
          <Button type="submit" variant="secondary">
            筛选
          </Button>
        </form>
      </header>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <Card className="p-0">
        {loading && items.length === 0 ? (
          <div className="p-5">
            <SkeletonRows rows={6} />
          </div>
        ) : items.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title="没有符合条件的员工"
              description="调整筛选条件，或让员工使用企业邮箱自助注册后即可在此管理。"
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr className="border-b border-white/8">
                  <th className="table-head">员工</th>
                  <th className="table-head">角色</th>
                  <th className="table-head">状态</th>
                  <th className="table-head text-right">小智豆余额</th>
                  <th className="table-head text-right">今日消耗</th>
                  <th className="table-head">最近登录</th>
                  <th className="table-head text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((user) => (
                  <tr key={user.id} className="border-b border-white/5 transition hover:bg-white/[0.03]">
                    <td className="table-cell">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-500/40 to-sky-500/30 text-[12px] font-semibold text-white">
                          {user.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-white">{user.displayName}</p>
                          <p className="truncate text-[11px] text-slate-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="table-cell">
                      <RolePill role={user.role} />
                    </td>
                    <td className="table-cell">
                      <StatusPill status={user.status} />
                    </td>
                    <td className="table-cell text-right font-mono text-[13px] text-amber-200">{formatBeans(user.balanceBeans)}</td>
                    <td className="table-cell text-right font-mono text-[13px] text-slate-300">{formatBeans(user.todayUsedBeans)}</td>
                    <td className="table-cell">
                      <span className="text-[12px] text-slate-400">{relativeTime(user.lastLoginAt)}</span>
                      <span className="block text-[11px] text-slate-600">{formatDateTime(user.createdAt)} 创建</span>
                    </td>
                    <td className="table-cell">
                      <div className="flex justify-end gap-1.5">
                        <Button variant="ghost" className="px-2 py-1.5" onClick={() => openEditor(user)} icon={<Pencil className="h-3.5 w-3.5" />}>
                          编辑
                        </Button>
                        <Button variant="ghost" className="px-2 py-1.5" onClick={() => setQuotaTarget(user)} icon={<Coins className="h-3.5 w-3.5" />}>
                          配额
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1.5"
                          onClick={() => setToggleTarget(user)}
                        >
                          {user.status === "active" ? "停用" : "启用"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 px-5 py-3.5">
          <span className="text-[12px] text-slate-500">
            第 {page} / {pageCount} 页 · 每页 {PAGE_SIZE} 条
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

      <Modal
        open={Boolean(editing)}
        title="编辑员工"
        description={editing ? `${editing.email} · ${formatBeans(editing.balanceBeans)} 小智豆` : undefined}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => void saveEditor()} loading={saving}>
              保存修改
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="显示名称" htmlFor="userName">
            <Input id="userName" value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} />
          </Field>
          <Field label="角色" hint="管理员可访问全部后台页面并调整配额策略" htmlFor="userRole">
            <Select id="userRole" value={roleDraft} onChange={(event) => setRoleDraft(event.target.value)}>
              <option value="member">员工</option>
              <option value="admin">管理员</option>
            </Select>
          </Field>
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-[12px] text-slate-400">
            <div className="flex items-center justify-between">
              <span>累计发放</span>
              <span className="font-mono text-slate-200">{formatBeans(editing?.lifetimeGrantedBeans ?? 0)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span>累计消耗</span>
              <span className="font-mono text-slate-200">{formatBeans(editing?.lifetimeUsedBeans ?? 0)}</span>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              <Pill tone="info">提示</Pill> 停用账号会立即撤销该员工全部登录会话。
            </p>
          </div>
        </div>
      </Modal>

      {quotaTarget ? (
        <UserQuotaDialog
          user={quotaTarget}
          onClose={() => setQuotaTarget(null)}
          onGranted={() => {
            void load();
            onChanged();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(toggleTarget)}
        title={toggleTarget?.status === "active" ? "停用该账号？" : "恢复该账号？"}
        message={
          toggleTarget?.status === "active"
            ? `停用后 ${toggleTarget?.email} 将立即退出登录且无法再访问工作台，其配额与历史记录会保留。`
            : `${toggleTarget?.email} 将可以重新登录并继续使用剩余小智豆。`
        }
        confirmLabel={toggleTarget?.status === "active" ? "确认停用" : "确认启用"}
        tone={toggleTarget?.status === "active" ? "danger" : "primary"}
        loading={toggling}
        onCancel={() => setToggleTarget(null)}
        onConfirm={() => void toggleStatus()}
      />
    </div>
  );
}
