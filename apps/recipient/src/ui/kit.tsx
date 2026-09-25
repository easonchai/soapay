import {
  forwardRef,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, Info, Loader2, OctagonAlert } from "lucide-react";
import { shortAddr } from "./format.js";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

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
        "inline-flex select-none items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap",
        "transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.98]",
        "disabled:pointer-events-none disabled:opacity-50",
        focusRing,
        size === "sm" && "h-9 px-3 text-sm",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-5 text-base",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "secondary" && "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        variant === "outline" && "border border-input bg-card hover:bg-muted",
        variant === "ghost" && "hover:bg-muted",
        variant === "destructive" && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-10 w-full rounded-md border border-input bg-card px-3 text-sm placeholder:text-muted-foreground/80",
      "aria-[invalid=true]:border-destructive disabled:opacity-60",
      focusRing,
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-24 w-full rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground/80",
        "aria-[invalid=true]:border-destructive",
        focusRing,
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

/** Label + control + hint + inline error, with ids wired for screen readers. */
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
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {required && <span className="text-muted-foreground"> (required)</span>}
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

export function Card({ className, children, as: As = "section", ...rest }: { className?: string; children: ReactNode; as?: "section" | "div" | "article"; "aria-labelledby"?: string }) {
  return (
    <As className={cn("rounded-lg border bg-card text-card-foreground", className)} {...rest}>
      {children}
    </As>
  );
}

export function CardHeader({ title, description, action, id }: { title: ReactNode; description?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
      <div className="min-w-0 space-y-0.5">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

type AlertVariant = "info" | "warning" | "destructive" | "success";
const alertIcon = { info: Info, warning: AlertTriangle, destructive: OctagonAlert, success: CheckCircle2 };

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
  const Icon = alertIcon[variant];
  return (
    <div
      role={role ?? (variant === "destructive" ? "alert" : "status")}
      className={cn(
        "flex gap-3 rounded-lg border p-3 text-sm sm:p-4",
        variant === "info" && "border-border bg-muted/60",
        variant === "warning" && "border-warning/40 bg-warning-bg",
        variant === "destructive" && "border-destructive/40 bg-destructive/10",
        variant === "success" && "border-success/40 bg-success/10",
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          variant === "info" && "text-muted-foreground",
          variant === "warning" && "text-warning",
          variant === "destructive" && "text-destructive",
          variant === "success" && "text-success",
        )}
      />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-foreground/90">{children}</div>}
        {action && <div className="pt-2">{action}</div>}
      </div>
    </div>
  );
}

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "warning" | "destructive" | "success" | "accent"; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "accent" && "border-transparent bg-accent text-accent-foreground",
        tone === "warning" && "border-warning/40 bg-warning-bg text-warning",
        tone === "destructive" && "border-destructive/40 bg-destructive/10 text-destructive",
        tone === "success" && "border-success/40 bg-success/10 text-success",
      )}
    >
      {children}
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
        className={cn(
          "mt-0.5 size-5 shrink-0 rounded border-input",
          tone === "destructive" ? "accent-destructive" : "accent-primary",
          focusRing,
        )}
        aria-describedby={description ? `${id}-d` : undefined}
      />
      <div className="space-y-0.5">
        <label htmlFor={id} className={cn("text-sm font-medium", tone === "destructive" && "text-destructive")}>
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
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked: the value is visible and selectable anyway.
        }
      }}
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </Button>
  );
}

export function Addr({ address, chars = 4, className }: { address: string; chars?: number; className?: string }) {
  return (
    <span className={cn("font-mono text-[0.8125rem] tabular-nums", className)} title={address}>
      {shortAddr(address, chars)}
    </span>
  );
}

export function PageHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: typeof Info; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="rounded-full bg-muted p-3">
        <Icon className="size-6 text-muted-foreground" aria-hidden />
      </div>
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {children && <div className="text-sm text-muted-foreground">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message.replace(/^Soapay( spend)?: /, "");
  return String(e);
}
