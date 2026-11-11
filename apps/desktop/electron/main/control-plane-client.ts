import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeStorage } from "electron";
import {
  normalizeControlPlaneBaseUrl,
  type ControlPlaneGateway,
  type ControlPlaneQuota,
  type ControlPlaneStatus,
  type ControlPlaneUser,
} from "@pi-desktop/shared";

/**
 * Main-process client for the company control plane. Tokens never cross into
 * the renderer: the renderer receives only identity and quota projections.
 */

export class ControlPlaneError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ControlPlaneError";
    this.code = code;
    this.status = status;
  }
}

type StoredSession = {
  baseUrl: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  encrypted: boolean;
};

type MeResponse = {
  user: ControlPlaneUser;
  quota: ControlPlaneQuota;
  gateway: ControlPlaneGateway | null;
  service: { mailTransport: string };
};

type AuthPayload = {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  user: ControlPlaneUser;
};

/** Never leaves the main process: it is persisted as a provider credential. */
export type GatewayTokenPayload = {
  token: string;
  expiresAt: string;
  scope: string;
};

export type ChargeUsageInput = {
  requestId: string;
  gatewayId?: string | null;
  model?: string | null;
  promptTokens: number;
  completionTokens: number;
};

export type ChargeUsageResult = {
  chargedBeans: number;
  balanceBeans: number;
  periodUsedBeans: number;
  duplicate: boolean;
};

const SESSION_FILE = "control-plane-session.json";
const REQUEST_TIMEOUT_MS = 20_000;
const INVALID_BASE_URL_MESSAGE =
  "PI_DESKTOP_CONTROL_PLANE_URL 无法使用：需要 https:// 地址（本机调试可用 http://127.0.0.1:端口），且不能内嵌账号密码";
const INSECURE_PRIVATE_HINT =
  "；如在内网使用明文 HTTP，请设置 PI_DESKTOP_ALLOW_INSECURE_CONTROL_PLANE=1 后重启客户端";

/** Cleartext to a LAN address is opt-in; the token never leaves over the internet in the clear. */
function allowInsecureBaseUrl(): boolean {
  return process.env.PI_DESKTOP_ALLOW_INSECURE_CONTROL_PLANE?.trim() === "1";
}

export class ControlPlaneClient {
  private readonly sessionPath: string;
  private readonly notify: () => void;
  private session: StoredSession | null = null;
  private loaded = false;
  private profile: MeResponse | null = null;
  /** Short-lived cache; the provider row keeps the durable copy. */
  private gatewayTokenCache: GatewayTokenPayload | null = null;
  private lastNotifyAt = 0;
  /**
   * Coalesces concurrent refreshes. The server rotates the refresh hash on
   * every call, so a second request carrying the same token is treated as
   * reuse and revokes the session — which logged the employee out whenever two
   * callers hit a 401 at the same moment.
   */
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(options: { dataDir: string; notify?: () => void }) {
    this.sessionPath = join(options.dataDir, SESSION_FILE);
    this.notify = options.notify ?? (() => undefined);
  }

  configuredBaseUrl(): string | null {
    const options = { allowInsecure: allowInsecureBaseUrl() };
    const fromEnv = normalizeControlPlaneBaseUrl(process.env.PI_DESKTOP_CONTROL_PLANE_URL, options);
    if (fromEnv) {
      return fromEnv;
    }
    return normalizeControlPlaneBaseUrl(this.session?.baseUrl, options);
  }

  async status(): Promise<ControlPlaneStatus> {
    await this.loadSession();
    const baseUrl = this.configuredBaseUrl();
    if (!baseUrl) {
      // A configured-but-unusable origin must block the workspace: silently
      // falling back to "no control plane" would bypass the login gate.
      const configured = process.env.PI_DESKTOP_CONTROL_PLANE_URL?.trim() ?? "";
      if (!configured) {
        return this.emptyStatus(false, null);
      }
      const hint = configured.toLowerCase().startsWith("http://") && !allowInsecureBaseUrl()
        ? INSECURE_PRIVATE_HINT
        : "";
      return this.emptyStatus(true, null, `${INVALID_BASE_URL_MESSAGE}${hint}`);
    }
    if (!this.session) {
      // Keep the resolved origin: the gate tells "not signed in" apart from
      // "configured but unusable" by `baseUrl`, and the sign-in card shows it.
      return this.emptyStatus(true, baseUrl);
    }
    try {
      const profile = await this.request<MeResponse>("GET", "/api/v1/me");
      this.profile = profile;
      // No notify here. The renderer re-reads the status on every
      // `controlPlaneChanged`, so notifying from a status read made the gate
      // call status again — an endless reload loop that flickered the
      // connecting screen. The event is reserved for changes the renderer did
      // not ask for: a revoked session, a logout, a charged turn.
      return {
        required: true,
        signedIn: true,
        baseUrl,
        user: profile.user,
        quota: profile.quota,
        gateway: profile.gateway,
        mailTransport: profile.service?.mailTransport ?? null,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ControlPlaneError && error.status === 401) {
        await this.clearSession();
        return this.emptyStatus(true, baseUrl, "登录状态已过期，请重新登录");
      }
      return this.emptyStatus(true, baseUrl, message);
    }
  }

  async login(email: string, password: string): Promise<ControlPlaneStatus> {
    const baseUrl = this.requireBaseUrl();
    const payload = await this.post<AuthPayload>(baseUrl, "/api/v1/auth/login", { email, password });
    await this.persistSession(baseUrl, payload);
    return this.requireSignedIn(await this.status());
  }

  async register(input: {
    email: string;
    code: string;
    password: string;
    displayName?: string;
  }): Promise<ControlPlaneStatus> {
    const baseUrl = this.requireBaseUrl();
    const payload = await this.post<AuthPayload>(baseUrl, "/api/v1/auth/register", input);
    await this.persistSession(baseUrl, payload);
    return this.requireSignedIn(await this.status());
  }

  async requestCode(email: string, purpose: "register" | "reset"): Promise<{ message: string }> {
    const baseUrl = this.requireBaseUrl();
    const path = purpose === "register" ? "/api/v1/auth/register/code" : "/api/v1/auth/password/code";
    return this.post<{ message: string }>(baseUrl, path, { email });
  }

  async resetPassword(input: { email: string; code: string; password: string }): Promise<{ message: string }> {
    const baseUrl = this.requireBaseUrl();
    return this.post<{ message: string }>(baseUrl, "/api/v1/auth/password/reset", input);
  }

  async logout(): Promise<{ signedOut: true }> {
    const session = this.session;
    if (session) {
      await this.post(session.baseUrl, "/api/v1/auth/logout", { refreshToken: session.refreshToken }).catch(
        (error: unknown) => {
          // A failed revoke must not trap the user in a signed-in shell.
          console.warn("control plane logout request failed", error);
        },
      );
    }
    await this.clearSession();
    this.profile = null;
    this.notify();
    return { signedOut: true };
  }

  async refreshProfile(): Promise<ControlPlaneStatus> {
    this.profile = null;
    return this.status();
  }

  currentProfile(): MeResponse | null {
    return this.profile;
  }

  /**
   * Gateway-scoped credential for the agent runtime. It lives in the provider
   * row instead of the session file so a 15-minute access token never has to
   * travel through a model request.
   */
  async gatewayToken(): Promise<GatewayTokenPayload | null> {
    await this.loadSession();
    if (!this.session) {
      return null;
    }
    const cached = this.gatewayTokenCache;
    if (cached && Date.parse(cached.expiresAt) - Date.now() > 5 * 60_000) {
      return cached;
    }
    const issued = await this.request<GatewayTokenPayload>("POST", "/api/v1/auth/gateway-token");
    this.gatewayTokenCache = issued;
    return issued;
  }

  /**
   * Reports one finished turn. Retried `requestId` values are idempotent on the
   * server, which is what makes the caller's retry path safe.
   */
  async chargeUsage(input: ChargeUsageInput): Promise<ChargeUsageResult> {
    const result = await this.request<ChargeUsageResult>("POST", "/api/v1/usage/charge", {
      requestId: input.requestId,
      ...(input.gatewayId ? { gatewayId: input.gatewayId } : {}),
      ...(input.model ? { model: input.model } : {}),
      promptTokens: Math.max(0, Math.round(input.promptTokens)),
      completionTokens: Math.max(0, Math.round(input.completionTokens)),
    });
    this.notifySoon();
    return result;
  }

  /** Coalesces burst notifications so a busy turn cannot spam the renderer. */
  private notifySoon(): void {
    const now = Date.now();
    if (now - this.lastNotifyAt < 60_000) {
      return;
    }
    this.lastNotifyAt = now;
    this.notify();
  }

  private requireBaseUrl(): string {
    const baseUrl = this.configuredBaseUrl();
    if (!baseUrl) {
      throw new ControlPlaneError(
        "未配置管控中心地址，请设置 PI_DESKTOP_CONTROL_PLANE_URL 后重启客户端",
        "CONTROL_PLANE_NOT_CONFIGURED",
        0,
      );
    }
    return baseUrl;
  }

  /**
   * Credentials were accepted, so the only acceptable outcome is a signed-in
   * status. Resolving with a signed-out projection instead left the sign-in
   * card with no message at all, which reads as "the button does nothing".
   */
  private requireSignedIn(status: ControlPlaneStatus): ControlPlaneStatus {
    if (status.signedIn) {
      return status;
    }
    throw new ControlPlaneError(
      status.error ?? "登录未能完成，请重试",
      this.session ? "SIGN_IN_INCOMPLETE" : "SESSION_REVOKED",
      this.session ? 0 : 401,
    );
  }

  private emptyStatus(required: boolean, baseUrl: string | null, error: string | null = null): ControlPlaneStatus {
    return {
      required,
      signedIn: false,
      baseUrl,
      user: null,
      quota: null,
      gateway: null,
      mailTransport: null,
      error,
    };
  }

  private async post<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
    return this.raw<T>(baseUrl, path, { method: "POST", body: JSON.stringify(body) });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const session = this.session;
    if (!session) {
      throw new ControlPlaneError("请先登录管控中心", "NOT_SIGNED_IN", 401);
    }
    try {
      return await this.raw<T>(session.baseUrl, path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        accessToken: session.accessToken,
      });
    } catch (error) {
      if (error instanceof ControlPlaneError && error.status === 401) {
        const refreshed = await this.refreshSession();
        if (refreshed) {
          return this.raw<T>(session.baseUrl, path, {
            method,
            body: body === undefined ? undefined : JSON.stringify(body),
            accessToken: this.session?.accessToken,
          });
        }
        if (this.session) {
          // The refresh failed for a transient reason and the session is still
          // stored; reporting 401 here would sign the employee out.
          throw new ControlPlaneError(
            "无法刷新登录会话，请检查网络后重试",
            "SESSION_REFRESH_FAILED",
            0,
          );
        }
      }
      throw error;
    }
  }

  private async refreshSession(): Promise<boolean> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    const task = this.performRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    this.refreshInFlight = task;
    return task;
  }

  private async performRefresh(): Promise<boolean> {
    const session = this.session;
    if (!session) {
      return false;
    }
    try {
      const payload = await this.post<AuthPayload>(session.baseUrl, "/api/v1/auth/refresh", {
        refreshToken: session.refreshToken,
      });
      await this.persistSession(session.baseUrl, payload);
      return true;
    } catch (error) {
      // A revoked or expired session is terminal; a timeout or a 5xx is not, so
      // keep the stored token and let the next request retry instead of
      // silently signing the employee out during a network blip.
      const status = error instanceof ControlPlaneError ? error.status : 0;
      const terminal = status === 401 || status === 403;
      // A terminal 401 is the normal "your session ended" path; logging the
      // whole async stack made a routine re-login look like a main-process
      // crash. Everything else keeps its stack.
      console.warn(
        terminal ? "control plane session revoked; signing out" : "control plane session refresh failed",
        terminal ? { code: error instanceof ControlPlaneError ? error.code : undefined, status } : error,
      );
      if (status === 401 || status === 403) { await this.clearSession(); }
      return false;
    }
  }

  private async raw<T>(
    baseUrl: string,
    path: string,
    init: { method: string; body?: string; accessToken?: string },
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (init.accessToken) {
      headers.authorization = `Bearer ${init.accessToken}`;
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: init.method,
        headers,
        body: init.body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ControlPlaneError(
        `无法连接管控中心（${baseUrl}）：${error instanceof Error ? error.message : String(error)}`,
        "CONTROL_PLANE_UNREACHABLE",
        0,
      );
    }

    const text = await response.text();
    let payload: { data?: T; error?: { code: string; message: string } } | null = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new ControlPlaneError(
        payload?.error?.message ?? `管控中心返回 HTTP ${response.status}`,
        payload?.error?.code ?? "CONTROL_PLANE_ERROR",
        response.status,
      );
    }
    if (!payload || payload.data === undefined) {
      throw new ControlPlaneError("管控中心返回了无法解析的响应", "CONTROL_PLANE_BAD_RESPONSE", response.status);
    }
    return payload.data;
  }

  private async persistSession(baseUrl: string, payload: AuthPayload): Promise<void> {
    // Memory keeps the live token: it is the bearer credential of every
    // request and the input of the refresh call. Sealing happens exactly once,
    // in `writeSessionFile`, so a request can never carry ciphertext — sealing
    // here as well left every request after a successful login with a 401.
    this.session = {
      baseUrl,
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      accessTokenExpiresAt: payload.accessTokenExpiresAt,
      encrypted: this.canEncrypt(),
    };
    this.profile = null;
    await this.writeSessionFile();
  }

  private async loadSession(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const raw = await readFile(this.sessionPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredSession>;
      if (!parsed.baseUrl || !parsed.accessToken || !parsed.refreshToken) {
        return;
      }
      const encrypted = parsed.encrypted === true;
      const accessToken = encrypted ? this.unseal(parsed.accessToken) : parsed.accessToken;
      const refreshToken = encrypted ? this.unseal(parsed.refreshToken) : parsed.refreshToken;
      if (!accessToken || !refreshToken) {
        // Undecryptable: another OS account, a rotated key, or a file written
        // by a build that sealed twice. Sending it would only produce a 401, so
        // treat it as signed out and let the gate ask for credentials.
        return;
      }
      this.session = {
        baseUrl: parsed.baseUrl,
        accessToken,
        refreshToken,
        accessTokenExpiresAt: parsed.accessTokenExpiresAt ?? "",
        encrypted,
      };
    } catch {
      // No stored session, or it is unreadable: treat as signed out.
    }
  }

  private async writeSessionFile(): Promise<void> {
    if (!this.session) {
      return;
    }
    const record: StoredSession = {
      baseUrl: this.session.baseUrl,
      accessToken: this.session.encrypted ? this.seal(this.session.accessToken) : this.session.accessToken,
      refreshToken: this.session.encrypted ? this.seal(this.session.refreshToken) : this.session.refreshToken,
      accessTokenExpiresAt: this.session.accessTokenExpiresAt,
      encrypted: this.session.encrypted,
    };
    await mkdir(dirname(this.sessionPath), { recursive: true });
    const temp = `${this.sessionPath}.tmp`;
    await writeFile(temp, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
    await rename(temp, this.sessionPath);
    await chmod(this.sessionPath, 0o600).catch(() => undefined);
  }

  private async clearSession(): Promise<void> {
    this.session = null;
    this.profile = null;
    this.gatewayTokenCache = null;
    try {
      await writeFile(this.sessionPath, "{}", { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      console.warn("clearing control plane session failed", error);
    }
    this.notify();
  }

  private canEncrypt(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private seal(value: string): string {
    if (!this.canEncrypt()) {
      return value;
    }
    return safeStorage.encryptString(value).toString("base64");
  }

  private unseal(value: string): string {
    try {
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    } catch {
      return "";
    }
  }
}
