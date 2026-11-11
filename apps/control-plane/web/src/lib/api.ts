import type {
  AuditEntry,
  AuthPayload,
  DailyUsage,
  GatewayTestResult,
  GatewayView,
  LedgerEntry,
  MeResponse,
  MessageBody,
  OverviewResponse,
  Page,
  PolicyView,
  SystemResponse,
  UserView,
} from "../types";
import { clearSession, getRefreshToken, loadSession, saveSession } from "./session";

export class ApiFailure extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiFailure";
    this.code = code;
    this.status = status;
  }
}

let refreshInFlight: Promise<boolean> | null = null;

type Envelope<T> = { data?: T; error?: { code: string; message: string } };

async function parseBody<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: Envelope<T> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Envelope<T>;
    } catch {
      // A rejection from the framework or a reverse proxy is plain text, not
      // the API envelope. Surfacing "Unexpected token 'F'" hid the real cause,
      // so the body itself becomes the message.
      const detail = text.trim().slice(0, 200);
      throw new ApiFailure(
        `请求失败（HTTP ${response.status}）：${detail || "服务返回了无法解析的响应"}`,
        "INVALID_RESPONSE",
        response.status,
      );
    }
  }
  if (!response.ok) {
    throw new ApiFailure(
      payload.error?.message ?? `请求失败（HTTP ${response.status}）`,
      payload.error?.code ?? "UNKNOWN_ERROR",
      response.status,
    );
  }
  return payload.data as T;
}

async function refreshSession(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return false;
  }
  refreshInFlight ??= (async () => {
    const response = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      return false;
    }
    const payload = await response.json();
    const data = payload.data as AuthPayload;
    saveSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
    return true;
  })();

  const result = await refreshInFlight;
  refreshInFlight = null;
  return result;
}

async function request<T>(path: string, init: RequestInit = {}, allowRetry = true): Promise<T> {
  const session = loadSession();
  const headers = new Headers(init.headers);
  if (init.body) {
    headers.set("content-type", "application/json");
  }
  if (session?.accessToken) {
    headers.set("authorization", `Bearer ${session.accessToken}`);
  }

  const response = await fetch(`/api/v1${path}`, { ...init, headers });

  if (response.status === 401 && allowRetry && getRefreshToken()) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request<T>(path, init, false);
    }
    clearSession();
    window.dispatchEvent(new Event("cp:signed-out"));
  }

  return parseBody<T>(response);
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

export const api = {
  requestRegisterCode: (email: string) =>
    request<MessageBody>("/auth/register/code", { method: "POST", body: JSON.stringify({ email }) }),

  register: (input: { email: string; code: string; password: string; displayName?: string }) =>
    request<AuthPayload>("/auth/register", { method: "POST", body: JSON.stringify(input) }),

  login: (email: string, password: string) =>
    request<AuthPayload>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  logout: (refreshToken: string) =>
    request<MessageBody>("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }),

  requestResetCode: (email: string) =>
    request<MessageBody>("/auth/password/code", { method: "POST", body: JSON.stringify({ email }) }),

  resetPassword: (input: { email: string; code: string; password: string }) =>
    request<MessageBody>("/auth/password/reset", { method: "POST", body: JSON.stringify(input) }),

  me: () => request<MeResponse>("/me"),

  myUsage: (days = 30) => request<{ days: number; trend: DailyUsage[]; totalBeans: number; totalRequests: number }>(
    `/me/usage${query({ days })}`,
  ),

  overview: () => request<OverviewResponse>("/admin/overview"),

  listUsers: (params: { page?: number; pageSize?: number; query?: string; status?: string }) =>
    request<Page<UserView>>(`/admin/users${query(params)}`),

  updateUser: (id: string, patch: { displayName?: string; role?: string; status?: string }) =>
    request<UserView>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  grantQuota: (id: string, beans: number, reason?: string) =>
    request<{ balanceBeans: number; grantedBeans: number }>(`/admin/users/${id}/grant`, {
      method: "POST",
      body: JSON.stringify({ beans, reason }),
    }),

  userLedger: (id: string, page = 1, pageSize = 10) =>
    request<Page<LedgerEntry>>(`/admin/users/${id}/ledger${query({ page, pageSize })}`),

  listGateways: () => request<{ items: GatewayView[] }>("/admin/gateways"),

  createGateway: (input: Record<string, unknown>) =>
    request<GatewayView>("/admin/gateways", { method: "POST", body: JSON.stringify(input) }),

  updateGateway: (id: string, patch: Record<string, unknown>) =>
    request<GatewayView>(`/admin/gateways/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  deleteGateway: (id: string) => request<MessageBody>(`/admin/gateways/${id}`, { method: "DELETE" }),

  testGateway: (id: string) =>
    request<GatewayTestResult>(`/admin/gateways/${id}/test`, { method: "POST" }),

  policy: () => request<PolicyView>("/admin/quota-policy"),

  savePolicy: (input: {
    beansPer1kPrompt: number;
    beansPer1kCompletion: number;
    period: string;
    periodBeans: number;
    defaultGrantBeans: number;
  }) => request<PolicyView>("/admin/quota-policy", { method: "PUT", body: JSON.stringify(input) }),

  ledger: (params: { page?: number; pageSize?: number; userId?: string }) =>
    request<Page<LedgerEntry>>(`/admin/ledger${query(params)}`),

  audit: (params: { page?: number; pageSize?: number; action?: string; query?: string }) =>
    request<Page<AuditEntry>>(`/admin/audit${query(params)}`),

  system: () => request<SystemResponse>("/admin/system"),
};
