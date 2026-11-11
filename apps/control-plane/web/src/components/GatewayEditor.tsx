import { useState } from "react";
import { Button, Field, Input, Select, Textarea } from "./ui";
import { Modal } from "./feedback";
import type { GatewayView } from "../types";

export interface GatewayPayload {
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
  isDefault: boolean;
  notes: string;
}

interface GatewayEditorProps {
  gateway: GatewayView | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: GatewayPayload) => void;
}

const PROVIDERS = [
  { value: "openai-compatible", label: "OpenAI 兼容" },
  { value: "anthropic", label: "Anthropic" },
  { value: "azure-openai", label: "Azure OpenAI" },
  { value: "custom", label: "自定义" },
];

export function GatewayEditor({ gateway, saving, onClose, onSubmit }: GatewayEditorProps) {
  const [name, setName] = useState(gateway?.name ?? "");
  const [provider, setProvider] = useState(gateway?.provider ?? "openai-compatible");
  const [baseUrl, setBaseUrl] = useState(gateway?.baseUrl ?? "");
  const [model, setModel] = useState(gateway?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(gateway?.enabled ?? true);
  const [isDefault, setIsDefault] = useState(gateway?.isDefault ?? true);
  const [notes, setNotes] = useState(gateway?.notes ?? "");
  const [clearKey, setClearKey] = useState(false);

  return (
    <Modal
      open
      title={gateway ? "编辑网关" : "新增网关"}
      description="网关凭据会使用服务端密钥加密存储，界面与日志中只展示脱敏结果。"
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button
            onClick={() =>
              onSubmit({
                name: name.trim(),
                provider,
                baseUrl: baseUrl.trim(),
                model: model.trim(),
                apiKey: clearKey ? "" : apiKey.trim(),
                enabled,
                isDefault,
                notes: notes.trim(),
              })
            }
            loading={saving}
          >
            {gateway ? "保存修改" : "创建网关"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="网关名称" htmlFor="gwName">
            <Input id="gwName" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：统一模型网关" />
          </Field>
          <Field label="接入类型" htmlFor="gwProvider">
            <Select id="gwProvider" value={provider} onChange={(event) => setProvider(event.target.value)}>
              {PROVIDERS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="网关地址" hint="OpenAI 兼容网关通常以 /v1 结尾，代理会追加 /chat/completions" htmlFor="gwUrl">
          <Input
            id="gwUrl"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://gateway.company.com/v1"
            className="font-mono text-[12px]"
          />
        </Field>

        <Field label="默认模型" hint="员工端未显式指定模型时使用该模型" htmlFor="gwModel">
          <Input id="gwModel" value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-4o-mini" className="font-mono text-[12px]" />
        </Field>

        <Field
          label="API 密钥"
          hint={gateway ? `当前：${gateway.apiKeyMasked ?? "未配置"} · 留空表示不修改` : "仅保存在服务端，不会回传到浏览器"}
          htmlFor="gwKey"
        >
          <Input
            id="gwKey"
            type="password"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setClearKey(false);
            }}
            placeholder="sk-..."
            autoComplete="off"
            disabled={clearKey}
            className="font-mono text-[12px]"
          />
        </Field>

        {gateway ? (
          <label className="flex items-center gap-2 text-[12px] text-slate-400">
            <input
              type="checkbox"
              checked={clearKey}
              onChange={(event) => {
                setClearKey(event.target.checked);
                setApiKey("");
              }}
              className="h-3.5 w-3.5 rounded border-white/20 bg-transparent"
            />
            清除已保存的密钥
          </label>
        ) : null}

        <Field label="备注" htmlFor="gwNotes">
          <Textarea
            id="gwNotes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="例如：由平台组维护，月度额度由财务确认"
            maxLength={200}
          />
        </Field>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-3 text-[12px] text-slate-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-white/20 bg-transparent"
            />
            启用该网关
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-3 text-[12px] text-slate-300">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-white/20 bg-transparent"
            />
            设为默认网关
          </label>
        </div>
      </div>
    </Modal>
  );
}
