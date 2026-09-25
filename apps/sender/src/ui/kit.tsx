// Tiny presentational kit. Deliberately plain: the real visual design lives elsewhere
// (see README "How to plug in another UI").
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Button({ variant = "primary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const v =
    variant === "primary"
      ? "bg-slate-900 text-white hover:bg-slate-700"
      : variant === "danger"
        ? "bg-red-600 text-white hover:bg-red-500"
        : "border border-slate-300 bg-white hover:bg-slate-50";
  return <button {...p} className={`rounded px-3 py-1.5 text-sm disabled:opacity-50 ${v} ${className}`} />;
}

export function Input({ className = "", ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={`rounded border border-slate-300 px-2 py-1.5 text-sm ${className}`} />;
}

export function Card({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="font-semibold">{title}</h2>}
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Banner({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const c = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    error: "border-red-300 bg-red-50 text-red-900",
    ok: "border-emerald-300 bg-emerald-50 text-emerald-900",
  }[tone];
  return <div className={`rounded border px-3 py-2 text-sm ${c}`}>{children}</div>;
}

export function Badge({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const c = {
    info: "bg-slate-100 text-slate-700",
    warn: "bg-amber-100 text-amber-800",
    error: "bg-red-100 text-red-800",
    ok: "bg-emerald-100 text-emerald-800",
  }[tone];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${c}`}>{children}</span>;
}

export function short(a: string, n = 6): string {
  return a.length > 2 * n + 2 ? `${a.slice(0, n + 2)}…${a.slice(-n)}` : a;
}
