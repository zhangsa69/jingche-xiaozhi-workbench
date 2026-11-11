import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gatewayProviderBaseUrl, type ControlPlaneStatus } from "@pi-desktop/shared";
import type { ControlPlaneClient } from "../control-plane-client";
import type { HostProcess } from "../host-process";

/**
 * Keeps one provider row pointed at the company gateway.
 *
 * The row's credential is a gateway-scoped control-plane token, so the vendor
 * API key never reaches the client, and logging out (or being disabled) revokes
 * the credential through the session row it is bound to.
 */

export const CONTROL_PLANE_PROVIDER_NAME = "京车小智模型网关";

const MARKER_FILE = "control-plane-provider.json";

type ProviderMarker = {
  providerId: string;
  baseUrl: string;
  modelId: string | null;
  /** Hash of base URL + model + credential, to skip redundant writes. */
  fingerprint: string;
  /**
   * Provider rows this bridge switched off because the deployment owns the
   * model row. Recorded so sign-out can put the employee's own rows back.
   */
  disabledProviderIds?: string[];
};

type SessionSummary = {
  id: string;
  mode?: string | null;
  thinkingLevel?: string | null;
  providerId?: string | null;
  modelId?: string | null;
};

export type ControlPlaneProviderRef = {
  providerId: string;
  baseUrl: string;
  modelId: string | null;
};

export type ControlPlaneProviderBridge = {
  /** Creates or refreshes the row; returns null when the gateway is unusable. */
  sync(status?: ControlPlaneStatus): Promise<ControlPlaneProviderRef | null>;
  /** Disables the row so a signed-out client cannot use a stale credential. */
  deactivate(): Promise<void>;
  providerId(): string | null;
};

export function createControlPlaneProviderBridge(options: {
  client: ControlPlaneClient;
  getHost: () => HostProcess | null;
  dataDir: string;
  logger?: { warn: (...args: unknown[]) => void };
}): ControlPlaneProviderBridge {
  const markerPath = join(options.dataDir, MARKER_FILE);
  const warn = options.logger?.warn ?? ((...args: unknown[]) => console.warn(...args));
  let marker: ProviderMarker | null = null;
  let markerLoaded = false;
  let inflight: Promise<ControlPlaneProviderRef | null> | null = null;

  async function readMarker(): Promise<ProviderMarker | null> {
    if (markerLoaded) {
      return marker;
    }
    markerLoaded = true;
    try {
      const raw = await readFile(markerPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<ProviderMarker>;
      marker =
        parsed.providerId && parsed.baseUrl
          ? {
              providerId: parsed.providerId,
              baseUrl: parsed.baseUrl,
              modelId: parsed.modelId ?? null,
              fingerprint: parsed.fingerprint ?? "",
            }
          : null;
    } catch {
      // No marker yet: the first sync creates the row.
      marker = null;
    }
    return marker;
  }

  async function writeMarker(next: ProviderMarker): Promise<void> {
    marker = next;
    markerLoaded = true;
    try {
      await mkdir(dirname(markerPath), { recursive: true });
      const temp = `${markerPath}.tmp`;
      await writeFile(temp, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
      await rename(temp, markerPath);
    } catch (error) {
      warn("writing control plane provider marker failed", error);
    }
  }

  function fingerprint(baseUrl: string, modelId: string | null, token: string): string {
    return createHash("sha256").update(`${baseUrl}\n${modelId ?? ""}\n${token}`).digest("hex").slice(0, 32);
  }

  function providerPayload(baseUrl: string, modelId: string | null, token: string) {
    return {
      name: CONTROL_PLANE_PROVIDER_NAME,
      vendorKey: "custom",
      type: "openai_compatible" as const,
      protocol: "openai_compatible",
      baseUrl,
      authKind: "api_key_and_base_url",
      secretValue: token,
      apiStyle: "chat_completions",
      ...(modelId ? { defaultModelId: modelId } : {}),
    };
  }

  async function createRow(
    host: HostProcess,
    baseUrl: string,
    modelId: string | null,
    token: string,
  ): Promise<string | null> {
    const created = await host.call<{ provider?: { id?: string } | null }>(
      "providers.create",
      providerPayload(baseUrl, modelId, token),
    );
    return created?.provider?.id ?? null;
  }

  /** Returns true when the row still existed and was updated. */
  async function updateRow(
    host: HostProcess,
    providerId: string,
    baseUrl: string,
    modelId: string | null,
    token: string,
  ): Promise<boolean> {
    try {
      const updated = await host.call<{ provider?: { id?: string } | null }>("providers.update", {
        id: providerId,
        ...providerPayload(baseUrl, modelId, token),
        enabled: true,
      });
      // host-core answers `{ provider: null }` when the row was deleted.
      return Boolean(updated?.provider?.id);
    } catch (error) {
      // The employee may have deleted the row in Settings; recreate it.
      warn("updating the control plane provider failed; recreating", error);
      return false;
    }
  }

  async function ensureDefault(
    host: HostProcess,
    providerId: string,
    modelId: string | null,
    managed: boolean,
  ): Promise<void> {
    try {
      const settings = await host.call<Record<string, unknown>>("settings.get");
      const current = typeof settings?.defaultProviderId === "string" ? settings.defaultProviderId : "";
      // A managed deployment allows no other model service, so a provider the
      // employee picked while the control plane was optional must not win.
      if (!managed && current && current !== providerId) {
        return;
      }
      await host.call("settings.set", {
        ...settings,
        defaultProviderId: providerId,
        ...(modelId ? { defaultModelId: modelId } : {}),
      });
    } catch (error) {
      warn("setting the control plane provider as default failed", error);
    }
  }

  /**
   * Sessions remember the provider they were created with, and a turn resolves
   * that row before the global default — so leaving them alone kept sending
   * turns to a locally configured provider even after the default moved.
   */
  async function repointSessions(
    host: HostProcess,
    providerId: string,
    modelId: string | null,
  ): Promise<void> {
    let sessions: SessionSummary[];
    try {
      const listed = await host.call<{ sessions?: SessionSummary[] }>("session.list");
      sessions = listed?.sessions ?? [];
    } catch (error) {
      warn("listing sessions to repoint them failed", error);
      return;
    }
    let moved = 0;
    for (const session of sessions) {
      const ownsProvider = session.providerId === providerId;
      // A session with no provider inherits the global default, which is now
      // the gateway row: nothing to rewrite.
      if (!session.providerId) continue;
      const ownsModel = !modelId || session.modelId === modelId;
      if (ownsProvider && ownsModel) continue;
      try {
        await host.call("session.configure", {
          id: session.id,
          mode: session.mode ?? "agent",
          providerId,
          ...(modelId ? { modelId } : {}),
          ...(session.thinkingLevel ? { thinkingLevel: session.thinkingLevel } : {}),
        });
        moved += 1;
      } catch (error) {
        // A pending plan or a running turn refuses reconfiguration; the next
        // sync retries once it settles.
        warn("repointing a session to the control plane provider failed", error);
      }
    }
    if (moved > 0) {
      warn(`repointed ${moved} session(s) to the control plane provider`);
    }
  }

  /** Turns off every other row so no path can pick a non-company model. */
  async function disableOtherProviders(
    host: HostProcess,
    providerId: string,
  ): Promise<string[]> {
    const disabled: string[] = [];
    try {
      const listed = await host.call<{
        providers?: { id: string; enabled?: boolean }[];
      }>("providers.list", { includeDisabled: true });
      for (const provider of listed?.providers ?? []) {
        if (provider.id === providerId || provider.enabled === false) continue;
        try {
          await host.call("providers.update", { id: provider.id, enabled: false });
          disabled.push(provider.id);
        } catch (error) {
          // Plugin-declared rows own their enabled switch; the forced default
          // and the session rewrite still keep them out of the turn path.
          warn("disabling a non-company provider failed", error);
        }
      }
    } catch (error) {
      warn("listing providers to disable them failed", error);
    }
    return disabled;
  }

  /** Puts back the rows a previous sync switched off. */
  async function restoreProviders(host: HostProcess, providerId: string): Promise<void> {
    const existing = await readMarker();
    const ids = existing?.disabledProviderIds ?? [];
    if (ids.length === 0) return;
    for (const id of ids) {
      if (id === providerId) continue;
      try {
        await host.call("providers.update", { id, enabled: true });
      } catch (error) {
        warn("restoring a provider row failed", error);
      }
    }
  }

  async function runSync(status?: ControlPlaneStatus): Promise<ControlPlaneProviderRef | null> {
    const host = options.getHost();
    if (!host) {
      return null;
    }
    const resolved = status ?? (await options.client.status());
    const gateway = resolved.gateway;
    if (!resolved.signedIn || !gateway || !gateway.enabled) {
      return null;
    }
    const baseUrl = gatewayProviderBaseUrl(gateway.proxyEndpoint);
    if (!baseUrl) {
      warn("control plane gateway endpoint is not a usable URL", gateway.proxyEndpoint);
      return null;
    }
    const issued = await options.client.gatewayToken();
    if (!issued?.token) {
      return null;
    }
    const modelId = gateway.model?.trim() || null;
    const nextFingerprint = fingerprint(baseUrl, modelId, issued.token);
    const existing = await readMarker();

    let providerId: string | null = null;
    if (existing?.providerId) {
      if (existing.fingerprint === nextFingerprint) {
        providerId = existing.providerId;
      } else if (await updateRow(host, existing.providerId, baseUrl, modelId, issued.token)) {
        providerId = existing.providerId;
      }
    }
    if (!providerId) {
      providerId = await createRow(host, baseUrl, modelId, issued.token);
    }
    if (!providerId) {
      warn("control plane provider could not be created");
      return null;
    }

    // `required` marks a deployment where the control plane is mandatory, which
    // means the employee may not bring their own model service: the gateway row
    // is the only selectable provider, and sessions that still point at a local
    // row are moved over.
    const managed = resolved.required === true;
    await ensureDefault(host, providerId, modelId, managed);
    let disabledProviderIds: string[] = [];
    if (managed) {
      disabledProviderIds = await disableOtherProviders(host, providerId);
      await repointSessions(host, providerId, modelId);
    } else if ((existing?.disabledProviderIds ?? []).length > 0) {
      // The deployment became optional again: give the employee's rows back.
      await restoreProviders(host, providerId);
    }
    await writeMarker({
      providerId,
      baseUrl,
      modelId,
      fingerprint: nextFingerprint,
      disabledProviderIds,
    });
    return { providerId, baseUrl, modelId };
  }

  return {
    async sync(status) {
      // Login and a background refresh can race; one write is enough.
      if (inflight) {
        return inflight;
      }
      inflight = runSync(status)
        .catch((error: unknown) => {
          warn("syncing the control plane provider failed", error);
          return null;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    async deactivate() {
      const host = options.getHost();
      const existing = await readMarker();
      if (!host || !existing?.providerId) {
        return;
      }
      try {
        await host.call("providers.update", { id: existing.providerId, enabled: false });
      } catch (error) {
        warn("disabling the control plane provider failed", error);
      }
      // Signing out ends the company-managed model row, so the employee's own
      // providers come back instead of staying switched off forever.
      await restoreProviders(host, existing.providerId);
    },
    providerId() {
      return marker?.providerId ?? null;
    },
  };
}
