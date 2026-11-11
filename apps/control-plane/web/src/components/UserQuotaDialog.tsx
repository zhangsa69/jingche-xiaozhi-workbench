import { useCallback, useEffect, useState } from "react";
import { Coins, Minus, Plus } from "lucide-react";
import { Button, EmptyState, Field, Input, Pill, SkeletonRows } from "./ui";
import { Modal, useToast } from "./feedback";
import { api } from "../lib/api";
import { formatBeans, formatDateTime } from "../lib/format";
import type { LedgerEntry, UserView } from "../types";

interface UserQuotaDialogProps {
  user: UserView;
  onClose: () => void;
  onGranted: () => void;
}

const QUICK_AMOUNTS = [50, 100, 300, 1000];

export function UserQuotaDialog({ user, onClose, onGranted }: UserQuotaDialogProps) {
  const toast = useToast();
  const [amount, setAmount] = useState("100");
  const [reason, setReason] = useState("季度补充");
  const [saving, setSaving] = useState(false);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(user.balanceBeans);

  const loadLedger = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.userLedger(user.id, 1, 6);
      setEntries(result.items);
    } catch (failure) {
      console.error("loading user ledger failed", failure);
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    void loadLedger();
  }, [loadLedger]);

  const submit = async (sign: 1 | -1) => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error("请输入大于 0 的小智豆数量");
      return;
    }
    setSaving(true);
    try {
      const result = await api.grantQuota(user.id, sign * parsed, reason.trim() || undefined);
      setBalance(result.balanceBeans);
      toast.success(`${sign > 0 ? "已发放" : "已扣减"} ${parsed} 小智豆，当前余额 ${formatBeans(result.balanceBeans)}`);
      await loadLedger();
      onGranted();
    } catch (failure) {
      console.error("granting quota failed", failure);
      toast.error(failure instanceof Error ? failure.message : "调整配额失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={`调整小智豆额度 · ${user.displayName}`}
      description={`${user.email} · 当前余额 ${formatBeans(balance)} 豆`}
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            关闭
          </Button>
          <Button variant="secondary" onClick={() => void submit(-1)} loading={saving} icon={<Minus className="h-4 w-4" />}>
            扣减
          </Button>
          <Button onClick={() => void submit(1)} loading={saving} icon={<Plus className="h-4 w-4" />}>
            发放
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[12px] text-amber-200">
              <Coins className="h-3.5 w-3.5" />
              可用小智豆
            </span>
            <span className="font-mono text-[20px] text-amber-100">{formatBeans(balance)}</span>
          </div>
          <p className="mt-1 text-[11px] text-amber-200/70">所有调整都会写入账本并记录操作人，可追溯。</p>
        </div>

        <Field label="调整数量（小智豆）" hint="支持小数，例如 12.5 豆" htmlFor="beans">
          <Input
            id="beans"
            type="number"
            min="0"
            step="0.5"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="font-mono"
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          {QUICK_AMOUNTS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setAmount(String(value))}
              className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[12px] text-slate-300 transition hover:border-brand-400/40 hover:text-white"
            >
              +{value}
            </button>
          ))}
        </div>

        <Field label="调整原因" hint="会显示在用量账本中，便于审计" htmlFor="reason">
          <Input id="reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={80} />
        </Field>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[13px] font-medium text-slate-300">最近账本记录</p>
            <Pill tone="neutral">{entries.length} 条</Pill>
          </div>
          {loading && entries.length === 0 ? (
            <SkeletonRows rows={3} />
          ) : entries.length === 0 ? (
            <EmptyState title="暂无账本记录" description="该员工尚未发生额度发放或模型消耗。" />
          ) : (
            <ul className="divide-y divide-white/6 rounded-xl border border-white/8">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] text-slate-200">{entry.reason ?? (entry.kind === "charge" ? "模型调用" : "额度调整")}</p>
                    <p className="text-[11px] text-slate-500">{formatDateTime(entry.createdAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-mono text-[12px] ${entry.deltaBeans >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                      {entry.deltaBeans >= 0 ? "+" : ""}
                      {formatBeans(entry.deltaBeans)}
                    </p>
                    <p className="text-[11px] text-slate-500">余额 {formatBeans(entry.balanceAfterBeans)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
