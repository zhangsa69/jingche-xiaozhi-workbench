import { useCallback, useEffect, useState } from "react";
import { Calculator, Gauge, Save, ShieldCheck } from "lucide-react";
import { Button, Card, CardTitle, ErrorBanner, Field, Input, Pill, Select, SkeletonRows } from "../components/ui";
import { ConfirmDialog, useToast } from "../components/feedback";
import { api } from "../lib/api";
import { formatBeans, formatDateTime, periodLabels } from "../lib/format";
import type { PolicyView } from "../types";

interface FormState {
  beansPer1kPrompt: string;
  beansPer1kCompletion: string;
  period: string;
  periodBeans: string;
  defaultGrantBeans: string;
}

const EMPTY: FormState = {
  beansPer1kPrompt: "1",
  beansPer1kCompletion: "3",
  period: "monthly",
  periodBeans: "500",
  defaultGrantBeans: "200",
};

export function QuotaPage() {
  const toast = useToast();
  const [policy, setPolicy] = useState<PolicyView | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.policy();
      setPolicy(result);
      setForm({
        beansPer1kPrompt: String(result.beansPer1kPrompt),
        beansPer1kCompletion: String(result.beansPer1kCompletion),
        period: result.period,
        periodBeans: String(result.periodBeans),
        defaultGrantBeans: String(result.defaultGrantBeans),
      });
    } catch (failure) {
      console.error("loading quota policy failed", failure);
      setError(failure instanceof Error ? failure.message : "无法加载配额策略");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const result = await api.savePolicy({
        beansPer1kPrompt: Number(form.beansPer1kPrompt),
        beansPer1kCompletion: Number(form.beansPer1kCompletion),
        period: form.period,
        periodBeans: Number(form.periodBeans),
        defaultGrantBeans: Number(form.defaultGrantBeans),
      });
      setPolicy(result);
      toast.success("配额策略已保存，新调用将按新规则计价");
      setConfirmOpen(false);
    } catch (failure) {
      console.error("saving quota policy failed", failure);
      toast.error(failure instanceof Error ? failure.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const promptRate = Number(form.beansPer1kPrompt) || 0;
  const completionRate = Number(form.beansPer1kCompletion) || 0;
  const samplePrompt = 1_000;
  const sampleCompletion = 500;
  const sampleCost = (samplePrompt / 1000) * promptRate + (sampleCompletion / 1000) * completionRate;

  if (loading && !policy) {
    return (
      <Card>
        <SkeletonRows rows={5} />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-white">配额策略</h1>
          <p className="mt-1 text-[13px] text-slate-400">定义「小智豆」与 Token 的换算关系、周期上限与注册赠送额度。</p>
        </div>
        <Button onClick={() => setConfirmOpen(true)} icon={<Save className="h-4 w-4" />}>
          保存策略
        </Button>
      </header>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardTitle
            title="换算与周期"
            description="规则由服务端执行，客户端无法覆盖。保存后仅影响之后的调用。"
            action={policy ? <Pill tone="info">{periodLabels[policy.period] ?? policy.period}</Pill> : null}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="每 1000 输入 Token（豆）" hint="提示词部分单价" htmlFor="promptRate">
              <Input
                id="promptRate"
                type="number"
                min="0"
                step="0.1"
                value={form.beansPer1kPrompt}
                onChange={(event) => setForm((current) => ({ ...current, beansPer1kPrompt: event.target.value }))}
                className="font-mono"
              />
            </Field>
            <Field label="每 1000 输出 Token（豆）" hint="模型生成部分单价" htmlFor="completionRate">
              <Input
                id="completionRate"
                type="number"
                min="0"
                step="0.1"
                value={form.beansPer1kCompletion}
                onChange={(event) => setForm((current) => ({ ...current, beansPer1kCompletion: event.target.value }))}
                className="font-mono"
              />
            </Field>
            <Field label="周期类型" htmlFor="period">
              <Select
                id="period"
                value={form.period}
                onChange={(event) => setForm((current) => ({ ...current, period: event.target.value }))}
              >
                <option value="none">不限制周期</option>
                <option value="daily">每日重置</option>
                <option value="monthly">每月重置</option>
              </Select>
            </Field>
            <Field label="周期额度上限（豆）" hint="每位员工每个周期最多消耗" htmlFor="periodBeans">
              <Input
                id="periodBeans"
                type="number"
                min="0"
                step="10"
                value={form.periodBeans}
                onChange={(event) => setForm((current) => ({ ...current, periodBeans: event.target.value }))}
                className="font-mono"
                disabled={form.period === "none"}
              />
            </Field>
            <Field label="注册赠送（豆）" hint="新员工开通账号时的初始额度" htmlFor="grantBeans">
              <Input
                id="grantBeans"
                type="number"
                min="0"
                step="10"
                value={form.defaultGrantBeans}
                onChange={(event) => setForm((current) => ({ ...current, defaultGrantBeans: event.target.value }))}
                className="font-mono"
              />
            </Field>
          </div>

          <p className="mt-4 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-[11px] leading-relaxed text-slate-500">
            提示：额度扣减在服务端事务中完成，并按请求 ID 幂等，客户端重试不会重复扣费。周期额度与账户余额同时约束，取较小值生效。
          </p>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardTitle title="计费预览" description="一次典型请求的成本估算。" action={<Calculator className="h-4 w-4 text-slate-500" />} />
            <div className="space-y-2 text-[13px]">
              <div className="flex items-center justify-between text-slate-400">
                <span>输入 {samplePrompt} Token</span>
                <span className="font-mono text-slate-200">{formatBeans((samplePrompt / 1000) * promptRate)} 豆</span>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>输出 {sampleCompletion} Token</span>
                <span className="font-mono text-slate-200">{formatBeans((sampleCompletion / 1000) * completionRate)} 豆</span>
              </div>
              <div className="mt-2 flex items-center justify-between rounded-lg bg-brand-500/10 px-3 py-2 text-brand-100">
                <span>单次合计</span>
                <span className="font-mono text-[15px]">{formatBeans(sampleCost)} 豆</span>
              </div>
            </div>
          </Card>

          <Card>
            <CardTitle title="当前策略" description="服务端正在生效的规则。" action={<Gauge className="h-4 w-4 text-slate-500" />} />
            <dl className="space-y-2 text-[12px]">
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">输入单价</dt>
                <dd className="font-mono text-slate-200">{formatBeans(policy?.beansPer1kPrompt ?? 0)} 豆 / 1K</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">输出单价</dt>
                <dd className="font-mono text-slate-200">{formatBeans(policy?.beansPer1kCompletion ?? 0)} 豆 / 1K</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">周期额度</dt>
                <dd className="font-mono text-slate-200">{formatBeans(policy?.periodBeans ?? 0)} 豆</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">更新时间</dt>
                <dd className="text-slate-300">{formatDateTime(policy?.updatedAt)}</dd>
              </div>
            </dl>
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-slate-500">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
              保存策略会写入审计日志，包含操作人与新旧数值。
            </p>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="保存新的配额策略？"
        message={`新规则将在保存后立即生效：输入 ${formatBeans(promptRate)} 豆/1K，输出 ${formatBeans(completionRate)} 豆/1K，${
          periodLabels[form.period] ?? form.period
        }额度 ${formatBeans(Number(form.periodBeans) || 0)} 豆。历史账本不会被改写。`}
        confirmLabel="确认保存"
        tone="primary"
        loading={saving}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void save()}
      />
    </div>
  );
}
