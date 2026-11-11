export function formatBeans(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "—";
  }
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

export function formatNumber(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "—";
  }
  return value.toLocaleString("zh-CN");
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDay(value: string): string {
  if (value.length === 10) {
    return value.slice(5).replace("-", "/");
  }
  return value;
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) {
    return "从未登录";
  }
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) {
    return value;
  }
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days} 天前`;
  }
  return formatDateTime(value);
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) {
    return `${days} 天 ${hours} 小时`;
  }
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`;
  }
  return `${minutes} 分钟`;
}

export function percent(value: number, total: number): number {
  if (!total || total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)));
}

export const actionLabels: Record<string, string> = {
  "auth.registered": "员工注册",
  "auth.login": "员工登录",
  "auth.login_failed": "登录失败",
  "auth.password_reset": "重置密码",
  "auth.register_code_requested": "请求注册验证码",
  "auth.reset_code_requested": "请求重置验证码",
  "admin.user_updated": "修改员工",
  "admin.quota_granted": "调整配额",
  "admin.gateway_created": "新增网关",
  "admin.gateway_updated": "修改网关",
  "admin.gateway_deleted": "删除网关",
  "admin.quota_policy_updated": "更新配额策略",
};

export function actionLabel(action: string): string {
  return actionLabels[action] ?? action;
}

export const periodLabels: Record<string, string> = {
  none: "不限制",
  daily: "每日",
  monthly: "每月",
};
