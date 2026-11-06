"use client";
/**
 * Leash design-system kit (Figma "Leash — App screens"). Every screen builds from these so the app stays one
 * system: white cards r22 + soft blue shadow, surface #F4F5F9 tiles, blue glow card for money, dark #222 cards
 * for identity/highlights, 3D orbs on alert cards, Geist + Geist Mono.
 */
import { useState } from "react";
import { ArrowUpRight, Check, Copy, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { explorerAddr, explorerTx, short } from "@/lib/client/api";

export type Hue = "blue" | "gold" | "green" | "red" | "grey";

/** A titled white card (r22, soft shadow). */
export function Section(props: { title?: React.ReactNode; description?: React.ReactNode; icon?: React.ReactNode; iconHue?: Hue; action?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    <Card className={props.className}>
      {(props.title || props.action) && (
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3.5">
            {props.icon && <IconBubble hue={props.iconHue ?? "blue"}>{props.icon}</IconBubble>}
            <div className="min-w-0 space-y-1 pt-0.5">
              {props.title && <CardTitle className="text-[18px] font-semibold leading-6 tracking-[-0.02em] text-ink">{props.title}</CardTitle>}
              {props.description && <CardDescription className="text-[14px] leading-5 text-body">{props.description}</CardDescription>}
            </div>
          </div>
          {props.action}
        </CardHeader>
      )}
      {props.children && <CardContent className="space-y-3">{props.children}</CardContent>}
    </Card>
  );
}

type Tone = "ok" | "warn" | "bad" | "neutral" | "solid" | "blue";
const toneClass: Record<Tone, string> = {
  ok: "bg-green-bg text-green",
  warn: "bg-amber-bg text-amber",
  bad: "bg-red-bg text-red",
  neutral: "bg-surface text-body",
  solid: "bg-blue text-white",
  blue: "bg-blue-bg text-blue",
};
/** Figma Badge: 26 high, pill, 12px semibold. */
export function Pill({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex h-[26px] items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold", toneClass[tone], className)}>{children}</span>;
}

const hueBubble: Record<Hue, string> = { blue: "bg-blue-bg text-blue", gold: "bg-amber-bg text-amber", green: "bg-green-bg text-green", red: "bg-red-bg text-red", grey: "bg-surface text-ink" };
/** 44px round icon bubble (cards, list rows). */
export function IconBubble({ hue = "grey", className, children }: { hue?: Hue; className?: string; children: React.ReactNode }) {
  return <div className={cn("grid size-11 shrink-0 place-items-center rounded-full [&_svg]:size-5", hueBubble[hue], className)}>{children}</div>;
}

/** 3D orb icon for alert cards (60px). */
export function Orb({ hue = "gold", className, children }: { hue?: Exclude<Hue, "grey">; className?: string; children: React.ReactNode }) {
  return <div className={cn("orb [&_svg]:size-6 [&_svg]:stroke-[2.4]", `orb-${hue}`, className)}>{children}</div>;
}

const hueText: Record<Hue, string> = { blue: "text-blue", gold: "text-amber", green: "text-green", red: "text-red", grey: "text-body" };
/**
 * Figma "Alert card": a stacked white card (r24) with a 3D orb, title, body, a mono meta line and actions.
 * `stacked` draws the second card peeking underneath (used for "there's more").
 */
export function AlertCard(props: {
  hue: Exclude<Hue, "grey">;
  icon: React.ReactNode;
  title: React.ReactNode;
  body?: React.ReactNode;
  meta?: React.ReactNode;
  metaIcon?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  onDismiss?: () => void;
  stacked?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative", props.stacked && "pb-3", props.className)}>
      {props.stacked && <div className="absolute inset-x-[14px] bottom-0 h-10 rounded-[24px] bg-white shadow-[var(--shadow-stack)]" />}
      <div className={cn("relative space-y-4 rounded-[24px] bg-white pb-5 pl-[22px] pr-2.5 pt-3.5 shadow-[var(--shadow-alert)]", props.muted && "opacity-60")}>
        <div className="flex gap-4">
          <Orb hue={props.hue} className="mt-1">
            {props.icon}
          </Orb>
          <div className="min-w-0 flex-1 space-y-1.5 pt-1">
            <div className="text-[19px] font-semibold leading-[25px] tracking-[-0.02em] text-ink">{props.title}</div>
            {props.body && <div className="text-[16px] leading-[22px] text-body">{props.body}</div>}
          </div>
          {props.onDismiss ? (
            <button type="button" aria-label="Dismiss" onClick={props.onDismiss} className="grid size-[22px] shrink-0 place-items-center text-muted-ink hover:text-ink">
              <X className="size-[18px]" />
            </button>
          ) : (
            <div className="w-[22px] shrink-0" />
          )}
        </div>
        {props.meta && (
          <div className={cn("flex items-center gap-2 pr-3 font-mono text-[15px] leading-[18px]", hueText[props.hue === "blue" ? "blue" : props.hue])}>
            {props.metaIcon && <span className="[&_svg]:size-[18px]">{props.metaIcon}</span>}
            <span className="min-w-0 break-words">{props.meta}</span>
          </div>
        )}
        {props.children && <div className="pr-3">{props.children}</div>}
        {props.actions && <div className="flex gap-2.5 pr-3 [&>*]:flex-1">{props.actions}</div>}
      </div>
    </div>
  );
}

/** "Needs you" style section heading with an optional count badge. */
export function SectionTitle({ children, badge, action, className }: { children: React.ReactNode; badge?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 px-1 pt-2.5", className)}>
      <div className="min-w-0 flex-1 text-[16px] font-semibold leading-[22px] tracking-[-0.01em] text-ink">{children}</div>
      {badge}
      {action}
    </div>
  );
}

/** Big page heading (Requests, Activity, Insights). */
export function PageTitle({ title, subtitle }: { title: React.ReactNode; subtitle?: React.ReactNode }) {
  return (
    <div className="space-y-1.5 px-1 pt-1">
      <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.035em] text-ink">{title}</h1>
      {subtitle && <p className="text-[14px] leading-5 text-body">{subtitle}</p>}
    </div>
  );
}

/** Blue glow card: the money card. */
export function GlowCard({ label, value, unit, tiles, footer, className }: { label: React.ReactNode; value: React.ReactNode; unit?: React.ReactNode; tiles?: { value: React.ReactNode; label: React.ReactNode }[]; footer?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("glow-card px-6 pb-6 pt-[78px]", className)}>
      <div className="text-center text-[14px] leading-[19px] text-white/90">{label}</div>
      <div className="mt-3 flex items-end justify-center gap-2">
        <span className="num text-[78px] font-bold leading-[78px] tracking-[-0.05em] text-white">{value}</span>
        {unit && <span className="pb-2 text-[22px] leading-[26px] tracking-[-0.015em] text-white">{unit}</span>}
      </div>
      {tiles && (
        <div className="mt-6 grid grid-cols-2 gap-3">
          {tiles.map((t, i) => (
            <div key={i} className="glow-tile min-h-[98px] space-y-1 p-3.5">
              <div className="num text-[32px] font-semibold leading-[38px] tracking-[-0.04em]">{t.value}</div>
              <div className="text-[13px] leading-[17px] text-body">{t.label}</div>
            </div>
          ))}
        </div>
      )}
      {footer && <div className="mt-3.5 flex items-center justify-between gap-2 text-[14px] text-white/90">{footer}</div>}
    </div>
  );
}

/** Dark #222 card (r32) for identity & big highlights. */
export function DarkCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("dark-card space-y-4 p-6", className)}>{children}</div>;
}

export function Copyable({ value, display, className, light }: { value: string; display?: string; className?: string; light?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cn("inline-flex min-w-0 items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 font-mono text-[13px] hover:opacity-80", light ? "bg-blue-tile text-ink" : "bg-surface text-ink", className)}
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
      {done ? <Check className="size-3.5 shrink-0" /> : <Copy className="size-3.5 shrink-0 text-muted-ink" />}
    </button>
  );
}

export function TxLink({ hash, label = "View transaction", className }: { hash: string; label?: string; className?: string }) {
  return (
    <a className={cn("inline-flex items-center gap-1 text-[14px] font-medium text-blue underline-offset-4 hover:underline", className)} href={explorerTx(hash)} target="_blank" rel="noreferrer">
      {label} <ArrowUpRight className="size-4" />
    </a>
  );
}
export function AddrLink({ address }: { address: string }) {
  return (
    <a className="inline-flex items-center gap-1 font-mono text-[13px] text-addr hover:text-ink" href={explorerAddr(address)} target="_blank" rel="noreferrer">
      {short(address)} <ExternalLink className="size-3" />
    </a>
  );
}

export function Stat({ value, label, className }: { value: React.ReactNode; label: React.ReactNode; className?: string }) {
  return (
    <div className={cn("well px-3.5 py-3", className)}>
      <div className="num text-[24px] font-semibold leading-8 tracking-[-0.03em] text-ink">{value}</div>
      <div className="mt-0.5 text-[13px] text-body">{label}</div>
    </div>
  );
}

const meterTrack: Record<Hue, string> = { blue: "bg-blue-bg", gold: "bg-amber-bg", green: "bg-green-bg", red: "bg-red-bg", grey: "bg-surface" };
const meterBar: Record<Hue, string> = { blue: "bg-blue", gold: "bg-amber", green: "bg-green", red: "bg-red", grey: "bg-muted-ink" };
export function Meter({ value, max, hue = "blue", className }: { value: bigint | number; max: bigint | number; hue?: Hue; className?: string }) {
  const v = Number(value);
  const m = Number(max) || 1;
  const pct = Math.max(0, Math.min(100, (v / m) * 100));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full", meterTrack[hue], className)}>
      <div className={cn("h-full min-w-2 rounded-full transition-all", meterBar[hue])} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ icon, title, hint }: { icon?: React.ReactNode; title: string; hint?: React.ReactNode }) {
  return (
    <div className="surface flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon && <IconBubble hue="blue">{icon}</IconBubble>}
      <div className="text-[16px] font-semibold text-ink">{title}</div>
      {hint && <div className="max-w-xs text-[14px] leading-5 text-body">{hint}</div>}
    </div>
  );
}

/** One onboarding step (legacy layout kept for screens that still use it). */
export function Step(props: { n: number; title: string; hint?: React.ReactNode; state: "todo" | "active" | "done"; children?: React.ReactNode }) {
  return (
    <Card className={cn(props.state === "todo" && "opacity-55")}>
      <CardHeader className="flex flex-row items-start gap-3">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold", props.state === "done" ? "bg-blue text-white" : "bg-surface text-ink")}>
          {props.state === "done" ? <Check className="size-4" /> : props.n}
        </div>
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-[18px] font-semibold tracking-[-0.02em]">{props.title}</CardTitle>
          {props.hint && <CardDescription className="text-[14px] leading-5">{props.hint}</CardDescription>}
        </div>
      </CardHeader>
      {props.children && props.state !== "todo" && <CardContent className="space-y-3">{props.children}</CardContent>}
    </Card>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-[14px] leading-[18px] text-body">{label}</span>
      {children}
      {hint && <span className="block text-[12px] text-muted-ink">{hint}</span>}
    </label>
  );
}

/**
 * Figma bottom sheet: white, r32 top, drag handle, 56px tinted icon square, bold title, round close button,
 * over a dark scrim. Controlled (open/onOpenChange).
 */
export function Sheet(props: { open: boolean; onOpenChange: (o: boolean) => void; title: React.ReactNode; icon?: React.ReactNode; hue?: Hue; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0a0f1f]/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[92dvh] w-full max-w-[430px] overflow-y-auto rounded-t-[32px] bg-white px-5 pb-[max(env(safe-area-inset-bottom),24px)] pt-3 shadow-[0_-10px_40px_rgb(10_15_31/0.18)] outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom">
          <div className="mx-auto mb-4 h-[5px] w-10 rounded-full bg-line" />
          <div className="mb-4 flex items-center gap-3.5">
            {props.icon && <div className={cn("grid size-12 shrink-0 place-items-center rounded-[16px] [&_svg]:size-6", hueBubble[props.hue ?? "gold"])}>{props.icon}</div>}
            <DialogPrimitive.Title className="min-w-0 flex-1 text-[28px] font-bold leading-8 tracking-[-0.04em] text-ink">{props.title}</DialogPrimitive.Title>
            <DialogPrimitive.Close aria-label="Close" className="grid size-10 shrink-0 place-items-center rounded-full bg-surface text-ink hover:bg-line">
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>
          {props.description ? <DialogPrimitive.Description className="mb-4 text-[15px] leading-[22px] text-body">{props.description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{typeof props.title === "string" ? props.title : "Sheet"}</DialogPrimitive.Description>}
          <div className="space-y-4">{props.children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
