"use client";
import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { explorerAddr, explorerTx, short } from "@/lib/client/api";

/** A titled surface. No borders: depth comes from the card fill and a soft shadow. */
export function Section(props: { title?: React.ReactNode; description?: React.ReactNode; icon?: React.ReactNode; action?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    <Card className={props.className}>
      {(props.title || props.action) && (
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {props.icon && <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-foreground">{props.icon}</div>}
            <div className="min-w-0 space-y-1">
              {props.title && <CardTitle className="text-[0.95rem] font-semibold tracking-tight">{props.title}</CardTitle>}
              {props.description && <CardDescription className="text-[0.82rem] leading-relaxed">{props.description}</CardDescription>}
            </div>
          </div>
          {props.action}
        </CardHeader>
      )}
      {props.children && <CardContent className="space-y-3">{props.children}</CardContent>}
    </Card>
  );
}

type Tone = "ok" | "warn" | "bad" | "neutral" | "solid";
const toneClass: Record<Tone, string> = {
  ok: "bg-[color-mix(in_oklch,var(--ok),transparent_86%)] text-[var(--ok)]",
  warn: "bg-[color-mix(in_oklch,var(--warn),transparent_86%)] text-[var(--warn)]",
  bad: "bg-[color-mix(in_oklch,var(--bad),transparent_86%)] text-[var(--bad)]",
  neutral: "bg-muted text-muted-foreground",
  solid: "bg-primary text-primary-foreground",
};
export function Pill({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[0.72rem] font-medium", toneClass[tone], className)}>{children}</span>;
}

export function Copyable({ value, display, className }: { value: string; display?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cn("inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-muted px-2 py-1 font-mono text-[0.75rem] text-muted-foreground hover:text-foreground", className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          toast.success("Copied");
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      <span className="truncate">{display ?? short(value)}</span>
      {done ? <Check className="size-3.5 shrink-0" /> : <Copy className="size-3.5 shrink-0" />}
    </button>
  );
}

export function TxLink({ hash, label = "View transaction", className }: { hash: string; label?: string; className?: string }) {
  return (
    <a className={cn("inline-flex items-center gap-1 text-[0.8rem] font-medium text-foreground underline-offset-4 hover:underline", className)} href={explorerTx(hash)} target="_blank" rel="noreferrer">
      {label} <ExternalLink className="size-3.5" />
    </a>
  );
}
export function AddrLink({ address }: { address: string }) {
  return (
    <a className="inline-flex items-center gap-1 font-mono text-[0.75rem] text-muted-foreground hover:text-foreground" href={explorerAddr(address)} target="_blank" rel="noreferrer">
      {short(address)} <ExternalLink className="size-3" />
    </a>
  );
}

export function Stat({ value, label, className }: { value: React.ReactNode; label: React.ReactNode; className?: string }) {
  return (
    <div className={cn("well px-3 py-3", className)}>
      <div className="num text-xl font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 text-[0.72rem] text-muted-foreground">{label}</div>
    </div>
  );
}

export function Meter({ value, max, className }: { value: bigint | number; max: bigint | number; className?: string }) {
  const v = Number(value);
  const m = Number(max) || 1;
  const pct = Math.max(0, Math.min(100, (v / m) * 100));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ icon, title, hint }: { icon?: React.ReactNode; title: string; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl bg-card px-6 py-10 text-center shadow-[var(--shadow-soft)]">
      {icon && <div className="grid size-11 place-items-center rounded-2xl bg-muted text-muted-foreground">{icon}</div>}
      <div className="text-sm font-medium">{title}</div>
      {hint && <div className="max-w-xs text-[0.8rem] text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** One onboarding step: number bubble, title, body. */
export function Step(props: { n: number; title: string; hint?: React.ReactNode; state: "todo" | "active" | "done"; children?: React.ReactNode }) {
  return (
    <Card className={cn(props.state === "todo" && "opacity-55")}>
      <CardHeader className="flex flex-row items-start gap-3">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-full text-[0.8rem] font-semibold", props.state === "done" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>
          {props.state === "done" ? <Check className="size-4" /> : props.n}
        </div>
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-[0.95rem] font-semibold tracking-tight">{props.title}</CardTitle>
          {props.hint && <CardDescription className="text-[0.82rem] leading-relaxed">{props.hint}</CardDescription>}
        </div>
      </CardHeader>
      {props.children && props.state !== "todo" && <CardContent className="space-y-3">{props.children}</CardContent>}
    </Card>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[0.78rem] font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[0.72rem] text-muted-foreground/80">{hint}</span>}
    </label>
  );
}
