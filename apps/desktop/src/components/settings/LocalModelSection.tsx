/**
 * Local runtimes (Ollama, LM Studio) as a two-click add.
 *
 * The provider dialog already accepts a keyless endpoint, but it asks for a
 * name, a port, and a model selection first. A runtime the user started
 * themselves has one obvious answer for all three, so this row asks the runtime
 * instead of the user: probe `/v1/models`, keep the chat models, write the row.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelInfo } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import {
  LOCAL_RUNTIMES,
  buildLocalProviderInput,
  chatModelIds,
  hasRuntimeProvider,
  probeState,
  type LocalProbeState,
  type LocalRuntime,
} from "../../lib/local-model-probe";
import { Badge, Button } from "../ui";
import { IconServer } from "../icons";

type RuntimeState = {
  status: "idle" | "probing" | LocalProbeState;
  models: ModelInfo[];
  error?: string;
};

const IDLE: RuntimeState = { status: "idle", models: [] };

export function LocalModelSection() {
  const { t } = useTranslation();
  const providers = useAppStore((state) => state.providers);
  const refreshProviders = useAppStore((state) => state.refreshProviders);
  const showToast = useAppStore((state) => state.showToast);
  const [states, setStates] = useState<Record<string, RuntimeState>>({});
  const [adding, setAdding] = useState<string | null>(null);

  const stateOf = (runtime: LocalRuntime) => states[runtime.id] ?? IDLE;

  const probe = async (runtime: LocalRuntime) => {
    const previous = stateOf(runtime);
    setStates((current) => ({
      ...current,
      [runtime.id]: { ...previous, status: "probing" },
    }));
    try {
      const result = await api.listProviderModels({
        baseUrl: runtime.baseUrl,
        apiStyle: runtime.apiStyle,
      });
      setStates((current) => ({
        ...current,
        [runtime.id]: {
          status: probeState(result.models, result.error),
          models: result.models,
          ...(result.error ? { error: result.error } : {}),
        },
      }));
    } catch (error) {
      setStates((current) => ({
        ...current,
        [runtime.id]: {
          status: "offline",
          models: [],
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  };

  const add = async (runtime: LocalRuntime) => {
    const input = buildLocalProviderInput(runtime, stateOf(runtime).models);
    if (!input) return;
    setAdding(runtime.id);
    try {
      await api.createProvider(input);
      await refreshProviders();
      showToast(
        t("settings.localAddedToast", {
          name: runtime.name,
          count: input.models?.length ?? 0,
        }),
        { variant: "success" },
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    } finally {
      setAdding(null);
    }
  };

  const statusLine = (runtime: LocalRuntime) => {
    const state = stateOf(runtime);
    switch (state.status) {
      case "probing":
        return t("settings.localProbing");
      case "ready":
        return t("settings.localFound", { count: chatModelIds(state.models).length });
      case "empty":
        return t("settings.localEmpty");
      case "offline":
        return t("settings.localOffline", { url: runtime.baseUrl });
      default:
        return t("settings.localIdle");
    }
  };

  return (
    <section className="settings-card-block">
      <div className="model-config-section-head">
        <div className="settings-card-heading-line">
          <h3 className="settings-card-heading">{t("settings.localModels")}</h3>
        </div>
      </div>

      <div className="settings-panel local-model-panel">
        <p className="local-model-desc">{t("settings.localModelsDesc")}</p>
        <ul className="local-model-list">
          {LOCAL_RUNTIMES.map((runtime) => {
            const state = stateOf(runtime);
            const configured = hasRuntimeProvider(providers, runtime);
            const busy = state.status === "probing" || adding === runtime.id;
            return (
              <li key={runtime.id} className="local-model-row">
                <span className="local-model-icon" aria-hidden>
                  <IconServer size={16} />
                </span>
                <div className="local-model-copy">
                  <div className="local-model-title">
                    <span className="local-model-name">{t(runtime.labelKey)}</span>
                    <span className="local-model-url font-mono">{runtime.probeUrl}</span>
                    {configured ? (
                      <Badge tone="success">{t("settings.localAdded")}</Badge>
                    ) : null}
                  </div>
                  <div className="local-model-status">{statusLine(runtime)}</div>
                </div>
                <div className="local-model-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void probe(runtime)}
                  >
                    {state.status === "probing"
                      ? t("settings.localProbing")
                      : t("settings.localProbe")}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy || configured || state.status !== "ready"}
                    onClick={() => void add(runtime)}
                  >
                    {t("settings.localAdd")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
