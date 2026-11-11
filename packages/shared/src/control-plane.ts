/**
 * Shapes shared by the main process and the renderer for the company control
 * plane. Tokens never appear here: only identity and quota projections.
 */

export type ControlPlaneUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  balanceBeans: number;
  lifetimeGrantedBeans: number;
  lifetimeUsedBeans: number;
  todayUsedBeans: number;
};

export type ControlPlaneQuota = {
  balanceBeans: number;
  lifetimeGrantedBeans: number;
  lifetimeUsedBeans: number;
  period: string;
  periodLimitBeans: number;
  periodUsedBeans: number;
  periodRemainingBeans: number;
  periodResetsAt: string | null;
  availableBeans: number;
};

export type ControlPlaneGateway = {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string | null;
  enabled: boolean;
  proxyEndpoint: string;
};

export type ControlPlaneStatus = {
  /** False when the deployment has no control plane; the desktop then runs as before. */
  required: boolean;
  signedIn: boolean;
  baseUrl: string | null;
  user: ControlPlaneUser | null;
  quota: ControlPlaneQuota | null;
  gateway: ControlPlaneGateway | null;
  mailTransport: string | null;
  error: string | null;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export type ControlPlaneUrlOptions = {
  /**
   * Allow cleartext http to RFC1918 / ULA addresses. Off by default: over
   * plaintext anyone on the same segment can read the session and gateway
   * tokens. Intended for internal pilots without a certificate authority, and
   * deliberately narrow — public hosts stay refused even when enabled.
   */
  allowInsecure?: boolean;
};

/** RFC1918 IPv4, IPv6 unique-local, and loopback. */
export function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (LOOPBACK_HOSTS.has(hostname) || host === "::1") return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    return (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  const lowered = host.toLowerCase();
  return lowered.startsWith("fc") || lowered.startsWith("fd");
}

/**
 * Validates and trims a configured origin so joins never produce `//api/v1`.
 * Returns `null` for anything unusable: a missing value, a non-HTTP scheme, an
 * embedded credential, or cleartext HTTP against a host that is not loopback or
 * (with `allowInsecure`) a private network.
 */
export function normalizeControlPlaneBaseUrl(
  value: string | null | undefined,
  options: ControlPlaneUrlOptions = {},
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.protocol === "http:" && !isPrivateNetworkHost(parsed.hostname)) return null;
  if (parsed.protocol === "http:" && !LOOPBACK_HOSTS.has(parsed.hostname) && !options.allowInsecure) {
    return null;
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${path}`;
}

/**
 * Provider base URL for the company gateway: the proxy endpoint without its
 * `/chat/completions` suffix, because the runtime appends that itself.
 * Returns `null` when the endpoint is missing or not an HTTP(S) URL.
 */
export function gatewayProviderBaseUrl(
  proxyEndpoint: string | null | undefined,
): string | null {
  const trimmed = proxyEndpoint?.trim();
  if (!trimmed) return null;
  const base = trimmed.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  try {
    const parsed = new URL(base);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? base : null;
  } catch {
    return null;
  }
}

/** Beans rendered with at most three decimals and grouped thousands. */
export function formatBeans(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
}
