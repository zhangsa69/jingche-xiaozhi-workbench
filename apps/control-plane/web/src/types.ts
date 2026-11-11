export type Role = "member" | "admin";
export type UserStatus = "active" | "disabled";
export type Period = "none" | "daily" | "monthly";

export interface UserView {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
  lastLoginAt: string | null;
  balanceBeans: number;
  lifetimeGrantedBeans: number;
  lifetimeUsedBeans: number;
  todayUsedBeans: number;
}

export interface QuotaSnapshot {
  balanceBeans: number;
  lifetimeGrantedBeans: number;
  lifetimeUsedBeans: number;
  period: Period;
  periodLimitBeans: number;
  periodUsedBeans: number;
  periodRemainingBeans: number;
  periodResetsAt: string | null;
  availableBeans: number;
}

export interface PolicyView {
  beansPer1kPrompt: number;
  beansPer1kCompletion: number;
  period: Period;
  periodBeans: number;
  defaultGrantBeans: number;
  updatedAt: string;
}

export interface GatewaySummary {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string | null;
  enabled: boolean;
  proxyEndpoint: string;
}

export interface ServiceInfo {
  name: string;
  version: string;
  mailTransport: string;
  proxyEnabled: boolean;
}

export interface MeResponse {
  user: UserView;
  quota: QuotaSnapshot;
  gateway: GatewaySummary | null;
  service: ServiceInfo;
  quotaPolicy: PolicyView;
}

export interface AuthPayload {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: UserView;
}

export interface GatewayView {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string | null;
  apiKeyMasked: string | null;
  hasApiKey: boolean;
  enabled: boolean;
  isDefault: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayTestResult {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  message: string;
}

export interface DailyUsage {
  day: string;
  beans: number;
  requests: number;
}

export interface AuditEntry {
  id: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  userId: string;
  userEmail: string;
  deltaBeans: number;
  kind: string;
  reason: string | null;
  balanceAfterBeans: number;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OverviewResponse {
  users: { total: number; active: number; disabled: number; admins: number };
  today: { beans: number; requests: number };
  period: { label: string; usedBeans: number; limitBeans: number; resetsAt: string | null };
  totalBalanceBeans: number;
  trend: DailyUsage[];
  gateway: GatewayView | null;
  recentAudit: AuditEntry[];
  policy: PolicyView;
}

export interface SystemResponse {
  version: string;
  uptimeSeconds: number;
  schemaVersion: number;
  mailTransport: string;
  smtpConfigured: boolean;
  registrationOpen: boolean;
  databaseBytes: number;
  gatewayCount: number;
  ledgerEntries: number;
  auditEntries: number;
  serverTime: string;
  buildProfile: string;
}

export interface MessageBody {
  message: string;
}
