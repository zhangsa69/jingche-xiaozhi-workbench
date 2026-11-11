import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, KeyRound, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { Button, Field, Input } from "../components/ui";
import { useToast } from "../components/feedback";
import { api } from "../lib/api";
import type { AuthPayload } from "../types";

type Mode = "login" | "register" | "reset";

interface LoginPageProps {
  onSignedIn: (payload: AuthPayload) => void;
}

export function LoginPage({ onSignedIn }: LoginPageProps) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setCode("");
    setPassword("");
    setConfirmPassword("");
  };

  const sendCode = async () => {
    if (!email.trim()) {
      setError("请先填写企业邮箱");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const result = mode === "reset" ? await api.requestResetCode(email.trim()) : await api.requestRegisterCode(email.trim());
      toast.success(result.message);
      setCooldown(60);
    } catch (failure) {
      console.error("requesting verification code failed", failure);
      setError(failure instanceof Error ? failure.message : "验证码发送失败");
    } finally {
      setSending(false);
    }
  };

  const submit = async () => {
    setError(null);
    if (!email.trim()) {
      setError("请输入企业邮箱");
      return;
    }
    setPending(true);
    try {
      if (mode === "login") {
        const payload = await api.login(email.trim(), password);
        toast.success(`欢迎回来，${payload.user.displayName}`);
        onSignedIn(payload);
        return;
      }
      if (password !== confirmPassword) {
        setError("两次输入的密码不一致");
        return;
      }
      if (mode === "register") {
        const payload = await api.register({
          email: email.trim(),
          code: code.trim(),
          password,
          displayName: displayName.trim() || undefined,
        });
        toast.success(`注册成功，已赠送 ${payload.user.balanceBeans} 小智豆`);
        onSignedIn(payload);
        return;
      }
      const result = await api.resetPassword({ email: email.trim(), code: code.trim(), password });
      toast.success(result.message);
      switchMode("login");
    } catch (failure) {
      console.error("authentication failed", failure);
      setError(failure instanceof Error ? failure.message : "操作失败，请稍后重试");
    } finally {
      setPending(false);
    }
  };

  const requiresCode = mode !== "login";

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute -left-40 top-[-10%] h-[420px] w-[420px] rounded-full bg-brand-600/25 blur-[120px]" />
      <div className="pointer-events-none absolute -right-32 bottom-[-10%] h-[380px] w-[380px] rounded-full bg-sky-500/20 blur-[120px]" />

      <div className="relative grid w-full max-w-5xl gap-8 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden flex-col justify-between rounded-3xl border border-white/8 bg-white/[0.03] p-8 backdrop-blur-xl lg:flex">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-sky-500 shadow-glow">
                <span className="text-base font-bold text-white">智</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">京车小智工作台</p>
                <p className="text-[11px] text-slate-400">企业统一管控中心</p>
              </div>
            </div>
            <h1 className="mt-10 text-[30px] font-semibold leading-tight text-white">
              一次登录，
              <br />
              全公司统一的大模型接入。
            </h1>
            <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-slate-400">
              账号、网关与「小智豆」配额由服务端统一管理。登录后即可查看个人额度、模型入口与实时用量，所有调用都在服务端鉴权与计量。
            </p>
          </div>

          <div className="space-y-3">
            {[
              { icon: <ShieldCheck className="h-4 w-4 text-emerald-300" />, title: "服务端权威配额", text: "额度扣减在事务内完成，客户端无法伪造用量。" },
              { icon: <KeyRound className="h-4 w-4 text-sky-300" />, title: "密钥不出服务器", text: "网关 API Key 加密存储，仅在服务端代理调用时解密。" },
              { icon: <Mail className="h-4 w-4 text-brand-300" />, title: "邮箱验证码", text: "注册与重置密码均通过企业邮箱验证码校验。" },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-3 rounded-xl border border-white/6 bg-ink-950/40 px-4 py-3">
                <span className="mt-0.5">{item.icon}</span>
                <div>
                  <p className="text-[13px] font-medium text-slate-200">{item.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="surface-strong animate-rise p-6 sm:p-8">
          <div className="mb-6">
            <span className="pill border-brand-500/30 bg-brand-500/10 text-brand-200">
              <Sparkles className="h-3 w-3" />
              {mode === "login" ? "员工登录" : mode === "register" ? "邮箱注册" : "重置密码"}
            </span>
            <h2 className="mt-3 text-[22px] font-semibold text-white">
              {mode === "login" ? "登录管控中心" : mode === "register" ? "创建员工账号" : "重设登录密码"}
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-400">
              {mode === "login"
                ? "使用企业邮箱与密码登录，登录后自动同步小智豆额度。"
                : mode === "register"
                  ? "填写企业邮箱并获取验证码，验证通过后即可开通账号。"
                  : "我们会向邮箱发送一次性验证码，验证通过后可设置新密码。"}
            </p>
          </div>

          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {mode === "register" ? (
              <Field label="显示名称" hint="留空将使用邮箱前缀" htmlFor="displayName">
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="例如：李四"
                  autoComplete="name"
                />
              </Field>
            ) : null}

            <Field label="企业邮箱" htmlFor="email">
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                autoComplete="email"
                required
              />
            </Field>

            {requiresCode ? (
              <Field label="邮箱验证码" hint={cooldown > 0 ? `${cooldown} 秒后可重新发送` : "验证码 10 分钟内有效"} htmlFor="code">
                <div className="flex gap-2">
                  <Input
                    id="code"
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    placeholder="6 位数字"
                    className="font-mono tracking-[0.4em]"
                    required
                  />
                  <Button type="button" variant="secondary" onClick={() => void sendCode()} loading={sending} disabled={cooldown > 0} className="shrink-0">
                    {cooldown > 0 ? `${cooldown}s` : "发送验证码"}
                  </Button>
                </div>
              </Field>
            ) : null}

            <Field
              label={mode === "reset" ? "新密码" : "密码"}
              hint="至少 10 个字符，避免使用常见弱口令"
              htmlFor="password"
            >
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••••"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
              />
            </Field>

            {requiresCode ? (
              <Field label="确认密码" htmlFor="confirmPassword">
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="再次输入密码"
                  autoComplete="new-password"
                  required
                />
              </Field>
            ) : null}

            {error ? (
              <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-rose-200">
                {error}
              </p>
            ) : null}

            <Button type="submit" loading={pending} className="w-full" icon={<ArrowRight className="h-4 w-4" />}>
              {mode === "login" ? "登录" : mode === "register" ? "完成注册" : "确认重置"}
            </Button>
          </form>

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/8 pt-4 text-[12px] text-slate-400">
            {mode !== "login" ? (
              <button type="button" className="inline-flex items-center gap-1 hover:text-white" onClick={() => switchMode("login")}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                已有账号，去登录
              </button>
            ) : null}
            {mode !== "register" ? (
              <button type="button" className="hover:text-white" onClick={() => switchMode("register")}>
                注册新账号
              </button>
            ) : null}
            {mode !== "reset" ? (
              <button type="button" className="hover:text-white" onClick={() => switchMode("reset")}>
                忘记密码
              </button>
            ) : null}
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
            登录即表示同意公司内部系统使用规范。若账号被停用或需要开通权限，请联系管控中心管理员。
          </p>
        </section>
      </div>
    </div>
  );
}
