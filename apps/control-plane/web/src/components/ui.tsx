import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

export function Button({ variant = "primary", loading, icon, children, className, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(variantClass[variant], className)}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}

export function Field({ label, hint, error, children, htmlFor }: FieldProps) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-slate-300">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-rose-300">{error}</span>
      ) : hint ? (
        <span className="text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx("field-input", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx("field-input cursor-pointer", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx("field-input min-h-[84px] resize-y", props.className)} />;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("surface p-5", className)}>{children}</section>;
}

export function CardTitle({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight text-white">{title}</h2>
        {description ? <p className="mt-1 text-[13px] leading-relaxed text-slate-400">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const toneClass: Record<Tone, string> = {
  neutral: "border-white/12 bg-white/5 text-slate-300",
  success: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  warning: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  danger: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  info: "border-sky-400/30 bg-sky-400/10 text-sky-200",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("pill", toneClass[tone])}>{children}</span>;
}

export function StatusPill({ status }: { status: string }) {
  if (status === "active") {
    return (
      <Pill tone="success">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        正常
      </Pill>
    );
  }
  if (status === "disabled") {
    return (
      <Pill tone="danger">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
        停用
      </Pill>
    );
  }
  return <Pill>{status}</Pill>;
}

export function RolePill({ role }: { role: string }) {
  return role === "admin" ? <Pill tone="info">管理员</Pill> : <Pill>员工</Pill>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label ?? "加载中"}
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton h-11 rounded-xl" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/12 bg-white/[0.02] px-6 py-12 text-center">
      {icon ? <div className="mb-1 text-slate-500">{icon}</div> : null}
      <p className="text-sm font-medium text-slate-200">{title}</p>
      <p className="max-w-md text-[13px] leading-relaxed text-slate-500">{description}</p>
      {action}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-[13px] text-rose-200">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="rounded-lg border border-rose-300/40 px-3 py-1 text-xs hover:bg-rose-400/15">
          重试
        </button>
      ) : null}
    </div>
  );
}

export function ProgressBar({ value, tone = "brand" }: { value: number; tone?: "brand" | "warning" | "danger" }) {
  const toneClass = tone === "danger" ? "bg-rose-400" : tone === "warning" ? "bg-amber-300" : "bg-gradient-to-r from-brand-500 to-sky-400";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/8">
      <div className={cx("h-full rounded-full transition-all duration-500", toneClass)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
