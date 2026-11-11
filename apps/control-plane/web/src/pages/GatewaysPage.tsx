import { useCallback, useEffect, useState } from "react";
import { Activity, KeyRound, Pencil, Plus, Server, Trash2 } from "lucide-react";
import { Button, Card, CardTitle, EmptyState, ErrorBanner, Pill, SkeletonRows } from "../components/ui";
import { ConfirmDialog, useToast } from "../components/feedback";
import { GatewayEditor } from "../components/GatewayEditor";
import type { GatewayPayload } from "../components/GatewayEditor";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { GatewayTestResult, GatewayView } from "../types";

export function GatewaysPage() {
  const toast = useToast();
  const [items, setItems] = useState<GatewayView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<GatewayView | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GatewayView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, GatewayTestResult>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listGateways();
      setItems(result.items);
    } catch (failure) {
      console.error("loading gateways failed", failure);
      setError(failure instanceof Error ? failure.message : "无法加载网关配置");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (payload: GatewayPayload) => {
    setSaving(true);
    try {
      if (editing) {
        await api.updateGateway(editing.id, {
          name: payload.name,
          provider: payload.provider,
          baseUrl: payload.baseUrl,
          model: payload.model,
          ...(payload.apiKey ? { apiKey: payload.apiKey } : {}),
          enabled: payload.enabled,
          isDefault: payload.isDefault,
          notes: payload.notes,
        });
        toast.success("网关配置已更新");
      } else {
        await api.createGateway({
          name: payload.name,
          provider: payload.provider,
          baseUrl: payload.baseUrl,
          model: payload.model || undefined,
          apiKey: payload.apiKey || undefined,
          enabled: payload.enabled,
          isDefault: payload.isDefault,
          notes: payload.notes || undefined,
        });
        toast.success("网关已创建");
      }
      setEditorOpen(false);
      setEditing(null);
      await load();
    } catch (failure) {
      console.error("saving gateway failed", failure);
      toast.error(failure instanceof Error ? failure.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      await api.deleteGateway(deleteTarget.id);
      toast.success("网关已删除");
      setDeleteTarget(null);
      await load();
    } catch (failure) {
      console.error("deleting gateway failed", failure);
      toast.error(failure instanceof Error ? failure.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const runTest = async (gateway: GatewayView) => {
    setTestingId(gateway.id);
    try {
      const result = await api.testGateway(gateway.id);
      setTestResult((current) => ({ ...current, [gateway.id]: result }));
      if (result.ok) {
        toast.success(`${gateway.name}：${result.message}（${result.latencyMs}ms）`);
      } else {
        toast.error(`${gateway.name}：${result.message}`);
      }
    } catch (failure) {
      console.error("testing gateway failed", failure);
      toast.error(failure instanceof Error ? failure.message : "连通性测试失败");
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-white">网关配置</h1>
          <p className="mt-1 text-[13px] text-slate-400">统一维护大模型接入地址、默认模型与服务端密钥。</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
          icon={<Plus className="h-4 w-4" />}
        >
          新增网关
        </Button>
      </header>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <Card>
        <CardTitle
          title="接入说明"
          description="员工端通过管控中心代理调用模型：密钥不出服务器，客户端回合结束后上报 Token，由服务端按策略折算小智豆。"
          action={<Pill tone="info">{items.length} 个网关</Pill>}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: <KeyRound className="h-4 w-4 text-sky-300" />, title: "密钥加密存储", text: "AES-256-GCM 加密，界面只显示后四位。" },
            { icon: <Activity className="h-4 w-4 text-emerald-300" />, title: "连通性自检", text: "通过 /models 探测地址与凭据是否可用。" },
            { icon: <Server className="h-4 w-4 text-brand-300" />, title: "默认网关", text: "同一时间只有一个默认网关对员工生效。" },
            { icon: <Activity className="h-4 w-4 text-fuchsia-300" />, title: "流式通道", text: "代理按字节转发 SSE，客户端首字即显；反向代理需关闭缓冲。" },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
              <div className="flex items-center gap-2 text-[12px] font-medium text-slate-200">
                {item.icon}
                {item.title}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{item.text}</p>
            </div>
          ))}
        </div>
      </Card>

      {loading && items.length === 0 ? (
        <Card>
          <SkeletonRows rows={4} />
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Server className="h-6 w-6" />}
          title="还没有配置网关"
          description="添加公司统一的大模型网关后，员工端登录即可获得模型入口与小智豆计量。"
          action={
            <Button
              className="mt-2"
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
              icon={<Plus className="h-4 w-4" />}
            >
              配置第一个网关
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((gateway) => {
            const result = testResult[gateway.id];
            return (
              <Card key={gateway.id} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-[15px] font-semibold text-white">{gateway.name}</h3>
                      {gateway.isDefault ? <Pill tone="info">默认</Pill> : null}
                      {gateway.enabled ? <Pill tone="success">启用</Pill> : <Pill tone="danger">停用</Pill>}
                    </div>
                    <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{gateway.baseUrl}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      className="px-2 py-1.5"
                      onClick={() => {
                        setEditing(gateway);
                        setEditorOpen(true);
                      }}
                      icon={<Pencil className="h-3.5 w-3.5" />}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1.5 text-rose-300 hover:bg-rose-500/10"
                      onClick={() => setDeleteTarget(gateway)}
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                    >
                      删除
                    </Button>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-2 text-[12px]">
                  <div className="rounded-lg bg-ink-950/50 px-3 py-2">
                    <dt className="text-[11px] text-slate-500">接入类型</dt>
                    <dd className="mt-0.5 text-slate-200">{gateway.provider}</dd>
                  </div>
                  <div className="rounded-lg bg-ink-950/50 px-3 py-2">
                    <dt className="text-[11px] text-slate-500">默认模型</dt>
                    <dd className="mt-0.5 truncate font-mono text-slate-200">{gateway.model ?? "未指定"}</dd>
                  </div>
                  <div className="rounded-lg bg-ink-950/50 px-3 py-2">
                    <dt className="text-[11px] text-slate-500">服务端密钥</dt>
                    <dd className="mt-0.5 font-mono text-slate-200">{gateway.apiKeyMasked ?? "未配置"}</dd>
                  </div>
                  <div className="rounded-lg bg-ink-950/50 px-3 py-2">
                    <dt className="text-[11px] text-slate-500">更新时间</dt>
                    <dd className="mt-0.5 text-slate-200">{formatDateTime(gateway.updatedAt)}</dd>
                  </div>
                </dl>

                {gateway.notes ? <p className="text-[11px] leading-relaxed text-slate-500">{gateway.notes}</p> : null}

                <div className="mt-auto flex items-center justify-between gap-3 border-t border-white/6 pt-3">
                  <Button variant="secondary" onClick={() => void runTest(gateway)} loading={testingId === gateway.id}>
                    连通性测试
                  </Button>
                  {result ? (
                    <span
                      className={`text-[11px] ${result.ok ? "text-emerald-300" : "text-rose-300"}`}
                      title={result.message}
                    >
                      {result.message}
                      {result.latencyMs ? ` · ${result.latencyMs}ms` : ""}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-600">尚未测试</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editorOpen ? (
        <GatewayEditor
          gateway={editing}
          saving={saving}
          onClose={() => {
            setEditorOpen(false);
            setEditing(null);
          }}
          onSubmit={(payload) => void submit(payload)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除该网关？"
        message={`删除 ${deleteTarget?.name ?? ""} 后，若它仍是默认网关，员工端将暂时没有可用模型入口，直到你指定新的默认网关。`}
        confirmLabel="确认删除"
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
