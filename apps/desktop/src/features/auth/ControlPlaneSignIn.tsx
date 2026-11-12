import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ControlPlaneStatus } from "@pi-desktop/shared";
import { BrandLogo } from "../../components/BrandLogo";
import { api } from "../../lib/api";

type Mode = "signin" | "register" | "reset";

type Feedback = { tone: "error" | "success" | "info"; text: string } | null;

const CODE_COOLDOWN_SECONDS = 60;
const MIN_PASSWORD_LENGTH = 10;

const MODE_LABEL: Record<Mode, string> = {
  signin: "登录",
  register: "注册",
  reset: "重置密码",
};

const MODE_COPY: Record<Mode, { title: string; subtitle: string; submit: string }> = {
  signin: {
    title: "登录京车小智工作台",
    subtitle: "使用公司邮箱登录后同步模型网关与小智豆额度",
    submit: "登录",
  },
  register: {
    title: "创建员工账号",
    subtitle: "验证邮箱后设置密码，注册成功会获得初始小智豆额度",
    submit: "注册并登录",
  },
  reset: {
    title: "重置登录密码",
    subtitle: "验证邮箱验证码后设置新密码，已登录设备会自动退出",
    submit: "重置密码",
  },
};

/** Length-first strength hint; the server owns the authoritative rule. */
function passwordHint(password: string): { score: number; label: string } {
  if (!password) return { score: 0, label: `至少 ${MIN_PASSWORD_LENGTH} 个字符` };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { score: 1, label: `还需 ${MIN_PASSWORD_LENGTH - password.length} 个字符` };
  }
  const varied = /[a-zA-Z]/.test(password) && /\d|[^\w\s]/.test(password);
  if (password.length >= 16 && varied) return { score: 3, label: "强度良好" };
  if (varied) return { score: 2, label: "强度可用，建议加长" };
  return { score: 1, label: "建议混合字母与数字" };
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "操作失败，请稍后重试";
}

const TONE_CLASS: Record<"error" | "success" | "info", string> = {
  error: "border-error/40 bg-error/10 text-error",
  success: "border-success/40 bg-success/10 text-success",
  info: "border-border-default bg-bg-secondary text-text-secondary",
};

export type ControlPlaneSignInProps = {
  baseUrl: string | null;
  initialError: string | null;
  onSignedIn: (status: ControlPlaneStatus) => void;
};

/** Email sign-in, registration, and password reset for the control plane. */
export function ControlPlaneSignIn({ baseUrl, initialError, onSignedIn }: ControlPlaneSignInProps) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>(
    initialError ? { tone: "error", text: initialError } : null,
  );
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setFeedback(initialError ? { tone: "error", text: initialError } : null);
  }, [initialError]);

  // One timer for the resend cooldown; cleared on unmount so a closed gate
  // never keeps a scheduled callback alive.
  useEffect(() => {
    if (cooldown <= 0) return;
    timerRef.current = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [cooldown]);

  const strength = useMemo(() => passwordHint(password), [password]);
  const needsCode = mode !== "signin";
  const copy = MODE_COPY[mode];

  const switchMode = useCallback((next: Mode) => {
    setMode(next);
    setCode("");
    setPassword("");
    setFeedback(null);
  }, []);

  const sendCode = useCallback(async () => {
    const target = email.trim();
    if (!target || mode === "signin") {
      setFeedback({ tone: "error", text: "请先填写公司邮箱" });
      return;
    }
    setSending(true);
    setFeedback(null);
    try {
      const result = await api.controlPlaneRequestCode(target, mode === "reset" ? "reset" : "register");
      setFeedback({ tone: "success", text: result.message });
      setCooldown(CODE_COOLDOWN_SECONDS);
    } catch (error) {
      console.error("requesting verification code failed", error);
      setFeedback({ tone: "error", text: messageOf(error) });
    } finally {
      setSending(false);
    }
  }, [email, mode]);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (busy) return;
      const target = email.trim();
      if (!target.includes("@")) {
        setFeedback({ tone: "error", text: "请输入有效的公司邮箱地址" });
        return;
      }
      if (mode !== "signin" && password.length < MIN_PASSWORD_LENGTH) {
        setFeedback({ tone: "error", text: `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符` });
        return;
      }
      if (mode !== "signin" && code.trim().length === 0) {
        setFeedback({ tone: "error", text: "请填写邮箱收到的验证码" });
        return;
      }

      setBusy(true);
      setFeedback(null);
      try {
        if (mode === "signin") {
          onSignedIn(await api.controlPlaneLogin(target, password));
          return;
        }
        if (mode === "register") {
          onSignedIn(
            await api.controlPlaneRegister({
              email: target,
              code: code.trim(),
              password,
              ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
            }),
          );
          return;
        }
        const result = await api.controlPlaneResetPassword({ email: target, code: code.trim(), password });
        setFeedback({ tone: "success", text: result.message });
        setCode("");
        setPassword("");
        setMode("signin");
      } catch (error) {
        console.error("control plane authentication failed", error);
        setFeedback({ tone: "error", text: messageOf(error) });
      } finally {
        setBusy(false);
      }
    },
    [busy, code, displayName, email, mode, onSignedIn, password],
  );

  return (
    <div className="control-plane-card panel-card w-full max-w-md border border-border-default bg-bg-secondary/85 p-6 shadow-2xl backdrop-blur-xl">
      <header className="control-plane-drag-handle mb-5 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-bg-tertiary/70 ring-1 ring-border-default/60">
          <BrandLogo size={32} />
        </div>
        <div className="min-w-0">
          <h1 className="m-0 text-lg font-semibold leading-heading text-text-primary">{copy.title}</h1>
          <p className="m-0 mt-1 text-sm leading-body text-text-muted">{copy.subtitle}</p>
        </div>
      </header>

      <div className="glass-radio-group mb-5 backdrop-blur-md">
        {(Object.keys(MODE_LABEL) as Mode[]).map((item) => (
          <Fragment key={item}>
            <input
              type="radio"
              name="cp-auth-mode"
              id={`cp-mode-${item}`}
              checked={mode === item}
              disabled={busy}
              onChange={() => switchMode(item)}
            />
            <label htmlFor={`cp-mode-${item}`} className="text-sm font-semibold tracking-wide">
              {MODE_LABEL[item]}
            </label>
          </Fragment>
        ))}
        <div className="glass-glider" aria-hidden="true" />
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium tracking-wide text-text-muted" htmlFor="cp-email">
            公司邮箱
          </label>
          <input
            id="cp-email"
            type="email"
            autoComplete="username"
            spellCheck={false}
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@company.com"
            className="field-input text-md disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        {mode === "register" ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium tracking-wide text-text-muted" htmlFor="cp-name">
              显示名称（可选）
            </label>
            <input
              id="cp-name"
              type="text"
              autoComplete="nickname"
              value={displayName}
              disabled={busy}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="例如：张工"
              className="field-input text-md disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        ) : null}

        {needsCode ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium tracking-wide text-text-muted" htmlFor="cp-code">
              邮箱验证码
            </label>
            <div className="flex gap-2">
              <input
                id="cp-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                disabled={busy}
                onChange={(event) => setCode(event.target.value)}
                placeholder="6 位验证码"
                className="field-input text-md tracking-wide disabled:cursor-not-allowed disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void sendCode()}
                disabled={sending || busy || cooldown > 0}
                className="btn btn-secondary shrink-0 whitespace-nowrap text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? "发送中…" : cooldown > 0 ? `${cooldown}s 后重发` : "发送验证码"}
              </button>
            </div>
          </div>
        ) : null}

        <div>
          <label className="mb-1.5 block text-xs font-medium tracking-wide text-text-muted" htmlFor="cp-password">
            {mode === "reset" ? "新密码" : "登录密码"}
          </label>
          <input
            id="cp-password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={mode === "signin" ? "请输入密码" : `至少 ${MIN_PASSWORD_LENGTH} 个字符`}
            className="field-input text-md disabled:cursor-not-allowed disabled:opacity-60"
          />
          {needsCode ? (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex flex-1 gap-1">
                {[1, 2, 3].map((step) => (
                  <span
                    key={step}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      strength.score >= step
                        ? step === 1
                          ? "bg-warning/80"
                          : step === 2
                            ? "bg-text-secondary/70"
                            : "bg-success/80"
                        : "bg-bg-tertiary"
                    }`}
                  />
                ))}
              </div>
              <span className="text-xs text-text-muted">{strength.label}</span>
            </div>
          ) : null}
        </div>

        {feedback ? (
          <p
            role="alert"
            className={`m-0 rounded-sm border px-3 py-2 text-sm leading-body ${TONE_CLASS[feedback.tone]}`}
          >
            {feedback.text}
          </p>
        ) : null}

        <button type="submit" disabled={busy} className="btn btn-primary w-full py-2.5 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? "处理中…" : copy.submit}
        </button>
      </form>

      <div className="mt-5 flex items-center justify-between text-xs text-text-muted">
        <button
          type="button"
          disabled={busy}
          onClick={() => switchMode(mode === "reset" ? "signin" : "reset")}
          className="rounded-sm transition-colors hover:text-text-primary disabled:cursor-not-allowed"
        >
          {mode === "reset" ? "返回登录" : "忘记密码？"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => switchMode(mode === "register" ? "signin" : "register")}
          className="rounded-sm transition-colors hover:text-text-primary disabled:cursor-not-allowed"
        >
          {mode === "register" ? "已有账号，去登录" : "还没有账号？注册"}
        </button>
      </div>

      <div className="mt-5 flex items-center gap-2 border-t border-border-subtle pt-4 text-xs text-text-muted">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${baseUrl ? "bg-success" : "bg-warning"}`} />
        {/* The resolved origin stays inside the main process: naming the host
            in the sign-in card leaks the deployment's address to anyone who
            reaches the window. */}
        <span className="truncate">{baseUrl ? "公司模型服务器已连接" : "未配置管控中心地址，请联系管理员"}</span>
      </div>
    </div>
  );
}
