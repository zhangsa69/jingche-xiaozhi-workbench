import { useCallback, useEffect, useState } from "react";
import { Cpu, Database, Mail, RefreshCw, ServerCog, ShieldCheck } from "lucide-react";
import { Button, Card, CardTitle, ErrorBanner, Pill, SkeletonRows } from "../components/ui";
import { api } from "../lib/api";
import { formatBytes, formatDateTime, formatDuration, formatNumber } from "../lib/format";
import type { SystemResponse } from "../types";

export function SystemPage() {
  const [data, setData] = useState<SystemResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.system());
    } catch (failure) {
      console.error("loading system status failed", failure);
      setError(failure instanceof Error ? failure.message : "无法加载系统状态");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <Card>
        <SkeletonRows rows={6} />
      </Card>
    );
  }

  if (error && !data) {
    return <ErrorBanner message={error} onRetry={() => void load()} />;
  }

  if (!data) {
    return null;
  }

  const facts = [
    { icon: <ServerCog className="h-4 w-4 text-brand-300" />, label: "服务版本", value: `v${data.version}`, hint: data.buildProfile === "release" ? "Release 构建" : "开发构建" },
    { icon: <Cpu className="h-4 w-4 text-sky-300" />, label: "已运行", value: formatDuration(data.uptimeSeconds), hint: `服务端时间 ${formatDateTime(data.serverTime)}` },
    { icon: <Database className="h-4 w-4 text-amber-300" />, label: "数据库", value: formatBytes(data.databaseBytes), hint: `Schema v${data.schemaVersion}` },
    { icon: <Mail className="h-4 w-4 text-emerald-300" />, label: "邮件通道", value: data.smtpConfigured ? "SMTP 已配置" : "开发日志模式", hint: data.mailTransport },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-white">系统状态</h1>
          <p className="mt-1 text-[13px] text-slate-400">运行信息、存储容量与邮件通道配置检查。</p>
        </div>
        <Button variant="secondary" onClick={() => void load()} loading={loading} icon={<RefreshCw className="h-4 w-4" />}>
          刷新
        </Button>
      </header>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="surface p-5">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-slate-400">{fact.label}</span>
              <span className="rounded-lg border border-white/10 bg-white/5 p-1.5">{fact.icon}</span>
            </div>
            <p className="mt-3 truncate text-[19px] font-semibold text-white">{fact.value}</p>
            <p className="mt-1 truncate text-[11px] text-slate-500">{fact.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle title="数据规模" description="后台数据库中的核心表记录数。" action={<Database className="h-4 w-4 text-slate-500" />} />
          <dl className="space-y-2.5 text-[13px]">
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">网关配置</dt>
              <dd className="font-mono text-slate-100">{formatNumber(data.gatewayCount)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">配额账本条目</dt>
              <dd className="font-mono text-slate-100">{formatNumber(data.ledgerEntries)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">审计事件</dt>
              <dd className="font-mono text-slate-100">{formatNumber(data.auditEntries)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">自助注册</dt>
              <dd>{data.registrationOpen ? <Pill tone="success">已开放</Pill> : <Pill tone="warning">已关闭</Pill>}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardTitle title="运维检查清单" description="部署到 Linux 服务器后的常规确认项。" action={<ShieldCheck className="h-4 w-4 text-slate-500" />} />
          <ul className="space-y-2 text-[12px] leading-relaxed text-slate-400">
            {[
              "确认 systemd 服务为 active (running)，并已设置开机自启。",
              "反向代理已终止 TLS，且 CONTROL_PLANE_TRUST_PROXY 与部署方式一致。",
              "生产环境已配置 SMTP，邮件通道此处应显示「SMTP 已配置」。",
              "每日 SQLite 备份任务已启用，并验证过恢复流程。",
              "管理员邮箱位于 CONTROL_PLANE_ADMIN_EMAILS，避免权限缺失。",
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400/70" />
                {item}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
