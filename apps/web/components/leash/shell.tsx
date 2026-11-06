"use client";
/**
 * App chrome from the Figma design: top bar (avatar, Leash + vault, World ID pill, settings), the floating nav
 * pill with 4 icon tabs + the round blue action button, the Quick actions card it opens, and the white fade
 * under the nav.
 */
import { createContext, useContext } from "react";
import { Activity as ActivityIcon, BarChart3, Ban, Check, Copy, ExternalLink, Globe, Home as HomeIcon, Inbox, Play, Plus, RefreshCw, SlidersHorizontal, Snowflake, Store, Upload, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { short } from "@/lib/client/api";

export type Tab = "home" | "requests" | "activity" | "insights";
/** Actions the Quick actions card can start; the Home screen owns the sheets for them. */
export type QuickAction = "add-agent" | "allow-merchant" | "set-cap" | "withdraw" | "renew" | "world-id" | "freeze" | "revoke" | "copy" | "explorer" | "demo" | "settings";

type ShellCtx = { tab: Tab; setTab: (t: Tab) => void; action: QuickAction | null; startAction: (a: QuickAction | null) => void };
export const ShellContext = createContext<ShellCtx>({ tab: "home", setTab: () => {}, action: null, startAction: () => {} });
export const useShell = () => useContext(ShellContext);

export function TopBar({ vault, verified, onSettings, onWorld }: { vault: string; verified: boolean; onSettings: () => void; onWorld?: () => void }) {
  return (
    <div className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/design/avatar.webp" alt="" className="size-11 shrink-0 rounded-full ring-1 ring-white" />
      <div className="min-w-0 flex-1">
        <div className="text-[17px] font-semibold leading-[22px] tracking-[-0.01em] text-ink">Leash</div>
        <div className="truncate text-[12px] leading-4 text-ink">
          Vault <span className="font-mono">{short(vault)}</span>
        </div>
      </div>
      <button type="button" onClick={onWorld} className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-white pl-3 pr-3.5 ring-1 ring-[#e3e6ee] ring-inset">
        <span className={cn("grid size-5 place-items-center rounded-full", verified ? "bg-green text-white" : "bg-line text-muted-ink")}>
          <Check className="size-[11px] stroke-[3.5]" />
        </span>
        <span className="text-[13px] font-semibold text-ink">World ID</span>
      </button>
      <button type="button" aria-label="Settings" onClick={onSettings} className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-ink ring-1 ring-[#e3e6ee] ring-inset">
        <SlidersHorizontal className="size-5 stroke-[1.7]" />
      </button>
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: typeof HomeIcon }[] = [
  { id: "home", label: "Home", icon: HomeIcon },
  { id: "requests", label: "Requests", icon: Inbox },
  { id: "activity", label: "Activity", icon: ActivityIcon },
  { id: "insights", label: "Insights", icon: BarChart3 },
];

export function NavBar({ tab, setTab, pending, open, onAction }: { tab: Tab; setTab: (t: Tab) => void; pending: number; open: boolean; onAction: () => void }) {
  return (
    <>
      <div className="nav-fade pointer-events-none fixed inset-x-0 bottom-0 z-30 h-[150px]" />
      <nav className="fixed inset-x-0 bottom-[max(env(safe-area-inset-bottom),18px)] z-50 flex justify-center px-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-full bg-white p-[5px] shadow-[var(--shadow-nav)]">
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-label={label}
                  onClick={() => setTab(id)}
                  className={cn("relative flex h-[52px] items-center justify-center rounded-[26px] transition-all", active ? "gap-2 bg-dark pl-3 pr-3.5 text-white" : "w-[46px] text-ink hover:bg-surface")}
                >
                  <Icon className="size-[22px] stroke-[1.7]" />
                  {active && <span className="text-[15px] font-semibold tracking-[-0.01em]">{label}</span>}
                  {id === "requests" && pending > 0 && !active && <span className="absolute right-[9px] top-[13px] size-[7px] rounded-full bg-red ring-2 ring-white" />}
                </button>
              );
            })}
          </div>
          <button type="button" aria-label={open ? "Close quick actions" : "Quick actions"} onClick={onAction} className="grid size-14 place-items-center rounded-full bg-blue text-white shadow-[var(--shadow-fab)] transition-transform active:scale-95">
            {open ? <X className="size-[26px] stroke-[2.4]" /> : <Plus className="size-[26px] stroke-[2.4]" />}
          </button>
        </div>
      </nav>
    </>
  );
}

const TILES: { id: QuickAction; label: string; icon: typeof HomeIcon; hue: "gold" | "blue" | "green" | "red" | "grey" }[] = [
  { id: "add-agent", label: "Add agent", icon: UserPlus, hue: "gold" },
  { id: "allow-merchant", label: "Allow merchant", icon: Store, hue: "gold" },
  { id: "set-cap", label: "Set cap", icon: SlidersHorizontal, hue: "gold" },
  { id: "withdraw", label: "Withdraw", icon: Upload, hue: "blue" },
  { id: "renew", label: "Renew agent", icon: RefreshCw, hue: "green" },
  { id: "world-id", label: "World ID", icon: Globe, hue: "green" },
  { id: "freeze", label: "Freeze all", icon: Snowflake, hue: "red" },
  { id: "revoke", label: "Revoke", icon: Ban, hue: "red" },
  { id: "copy", label: "Copy address", icon: Copy, hue: "blue" },
  { id: "explorer", label: "Explorer", icon: ExternalLink, hue: "blue" },
  { id: "demo", label: "Demo run", icon: Play, hue: "blue" },
  { id: "settings", label: "Settings", icon: SlidersHorizontal, hue: "grey" },
];
const tileHue = { gold: "bg-amber-bg text-amber", blue: "bg-blue-bg text-blue", green: "bg-green-bg text-green", red: "bg-red-bg text-red", grey: "bg-surface text-ink" };

export function QuickActions({ open, vault, onClose, onPick }: { open: boolean; vault: string; onClose: () => void; onPick: (a: QuickAction) => void }) {
  if (!open) return null;
  return (
    <>
      <button type="button" aria-label="Close" className="fixed inset-0 z-40 bg-[#0a0f1f]/40 animate-in fade-in-0" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom),18px)+74px)] z-40 flex justify-center px-4 animate-in fade-in-0 slide-in-from-bottom-4">
        <div className="w-full max-w-[398px] rounded-[32px] bg-white px-4 pb-6 pt-5 shadow-[var(--shadow-alert)]">
          <div className="mb-4 flex items-baseline justify-between px-1">
            <div className="text-[20px] font-semibold tracking-[-0.02em] text-ink">Quick actions</div>
            <div className="text-[12px] text-body">
              Vault <span className="font-mono">{short(vault, 4)}</span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-x-2 gap-y-4">
            {TILES.map(({ id, label, icon: Icon, hue }) => (
              <button key={id} type="button" onClick={() => onPick(id)} className="flex flex-col items-center gap-2 text-center">
                <span className={cn("grid aspect-square w-full max-w-[72px] place-items-center rounded-[22px]", tileHue[hue])}>
                  <Icon className="size-[26px] stroke-[1.7]" />
                </span>
                <span className="text-[13px] leading-4 text-ink">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
