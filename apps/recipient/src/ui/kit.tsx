/**
 * Props-only building blocks, rendered with CK's Direction A · Ledger classes from @soapay/ui
 * (`btn`, `btn-primary`, `notice-*`, `pill-*`, `facts`, `share`…). Same API as before the reskin, so
 * every screen and hook is unchanged; only the look moved to the Ledger system.
 */
import {
  forwardRef,
  useId,

  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { Bloom, Copy as LedgerCopy, Dots, InView, LogoLoader, Pill, Reveal, type Tone } from "@soapay/ui";
import { shortAddr } from "./format.js";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "destructive" | "outline";
  size?: "md" | "sm" | "lg";
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, disabled, children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "btn",
        variant === "primary" && "btn-primary",
        variant === "ghost" && "btn-text",
        variant === "destructive" && "btn-destructive",
        size === "sm" && "btn-sm",
        size === "lg" && "btn-lg",
        className,
      )}
      {...props}
    >
      {loading && <LogoLoader size={14} label="Working" style={{ marginRight: 6 }} />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn("w-full", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn("w-full", className)} {...props} />
));
Textarea.displayName = "Textarea";

/** Label + control + hint + inline error, with ids wired for screen readers (Ledger `label.field` look). */
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null | undefined;
  required?: boolean;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
        {required && <span> (required)</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Ledger panel: 1px line, white surface, 2px corners. Padding comes from `className` or CardHeader. */
export function Card({ className, children, as: As = "section", reveal, ...rest }: { className?: string; children: ReactNode; as?: "section" | "div" | "article"; "aria-labelledby"?: string; /** Fade + rise when scrolled into view, after this many seconds. */ reveal?: number | undefined }) {
  const panel = (
    <As className={cn("panel", className)} {...rest}>
      {children}
    </As>
  );
  return reveal === undefined ? panel : <InView delay={reveal}>{panel}</InView>;
}

export function CardHeader({ title, description, action, id }: { title: ReactNode; description?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-3">
      <div className="min-w-0 space-y-0.5">
        <h2 id={id}>{title}</h2>
        {description && <p className="lead" style={{ marginTop: 2 }}>{description}</p>}
      </div>
      {action}
    </div>
  );
}

type AlertVariant = "info" | "warning" | "destructive" | "success";
const noticeClass: Record<AlertVariant, string> = {
  info: "notice-info",
  warning: "notice-warn",
  destructive: "notice-danger",
  success: "notice-ok",
};

/** Ledger notice: a flat tinted block, no icon. */
export function Alert({
  variant = "info",
  title,
  children,
  action,
  className,
  role,
}: {
  variant?: AlertVariant;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  return (
    <div role={role ?? (variant === "destructive" ? "alert" : "status")} className={cn("notice", noticeClass[variant], className)}>
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="notice-title">{title}</p>}
        {children && <div className="notice-body">{children}</div>}
        {action && <div className="pt-2">{action}</div>}
      </div>
    </div>
  );
}

const badgeTone: Record<"neutral" | "warning" | "destructive" | "success" | "accent", Tone> = {
  neutral: "muted",
  warning: "warn",
  destructive: "danger",
  success: "ok",
  accent: "accent",
};

/** Ledger status pill (used sparingly: amber for "not yet real", red for errors). */
export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "warning" | "destructive" | "success" | "accent"; title?: string }) {
  return (
    <span title={title} className="inline-flex">
      <Pill tone={badgeTone[tone]}>{children}</Pill>
    </span>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  tone = "neutral",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  tone?: "neutral" | "destructive";
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0"
        aria-describedby={description ? `${id}-d` : undefined}
      />
      <div className="space-y-0.5">
        <label htmlFor={id} className={cn("font-medium", tone === "destructive" && "text-destructive")}>
          {label}
        </label>
        {description && (
          <p id={`${id}-d`} className="text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

/** CK's Copy text button ("Copy" → "Copied"). `className` is accepted for API compatibility. */
export function CopyButton({ value, label = "Copy", className, onCopied }: { value: string; label?: string; className?: string; onCopied?: () => void }) {
  return (
    <span className={className}>
      <LedgerCopy value={value} label={label} {...(onCopied ? { onCopied } : {})} />
    </span>
  );
}

export function Addr({ address, chars = 4, className }: { address: string; chars?: number; className?: string }) {
  return (
    <code className={cn("tabular-nums", className)} title={address}>
      {shortAddr(address, chars)}
    </code>
  );
}

/** CK's PageHead (eyebrow, title, one line, dot texture, actions), without requiring an eyebrow. */
export function PageHeader({ title, description, action, eyebrow }: { title: ReactNode; description?: ReactNode; action?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="pagehead mb-6">
      <div className="text">
        {eyebrow && (
          <Reveal delay={0.05} as="span" className="eyebrow">
            {eyebrow}
          </Reveal>
        )}
        <Reveal delay={0.12} y={10}>
          <h1>{title}</h1>
        </Reveal>
        {description && (
          <Reveal delay={0.2} as="p" className="lead">
            {description}
          </Reveal>
        )}
      </div>
      <Dots mode="right" animate minWidth={220} className="dots" />
      {action && <div className="actions">{action}</div>}
    </div>
  );
}

/** CK's `.empty` panel with the dot texture. `icon` is kept for API compatibility and not drawn. */
export function EmptyState({ title, children, action, eyebrow }: { icon?: unknown; title: string; children?: ReactNode; action?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="empty">
      <Bloom />
      {eyebrow && (
        <Reveal delay={0.4} as="span" className="eyebrow">
          {eyebrow}
        </Reveal>
      )}
      <Reveal delay={0.55}>
        <h2>{title}</h2>
      </Reveal>
      {children && (
        <Reveal delay={0.7} className="lead">
          {children}
        </Reveal>
      )}
      {action && (
        <Reveal delay={0.85} className="actions" style={{ marginTop: 8 }}>
          {action}
        </Reveal>
      )}
    </div>
  );
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message.replace(/^Soapay( spend)?: /, "");
  return String(e);
}
