"use client";
import { ArrowUpRight, CircleSlash, Clock, Droplet, Globe, Receipt, Route, ScrollText, ShieldAlert, ShieldCheck, ShieldX, SlidersHorizontal, Snowflake, TrendingUp, Waypoints, X } from "lucide-react";
import { explorerTx, money, short, usePoll, usdt } from "@/lib/client/api";
import { Empty, Pill, PageTitle } from "./leash/kit";
import { CardHead } from "./Stats";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Channel = { channelId: string; vault: string; merchant: string; locked: string; lastAccepted: string; claimedOnchain: string; expiry: string; status: string };
type Claim = { tx: string; channel_id: string; merchant: string; delta: string; fee: string; vouchers_covered: number; calldata_bytes: number; at: number; explorerUrl?: string };
type Event = { id: number; at: number; kind: string; vault: string | null; amount: string | null; tx: string | null; data: string | null; hcs: string | null };

type Look = { label: string; icon: typeof Receipt; tint: string };
const BLUE = "bg-blue-bg text-blue";
const GOLD = "bg-amber-bg text-amber";
const GREEN = "bg-green-bg text-green";
const RED = "bg-red-bg text-red";
const GREY = "bg-surface text-body";
const KIND: Record<string, Look> = {
  ChannelOpened: { label: "Payment channel opened", icon: Waypoints, tint: BLUE },
  Claimed: { label: "Merchant paid (batched)", icon: Receipt, tint: BLUE },
  ChannelClosed: { label: "Channel closed", icon: Receipt, tint: BLUE },
  MandateChanged: { label: "Limits changed", icon: SlidersHorizontal, tint: GOLD },
  VaultCreated: { label: "Vault created", icon: ShieldCheck, tint: BLUE },
  ApprovalRequested: { label: "Agent asked for more", icon: TrendingUp, tint: GOLD },
  ApprovalGranted: { label: "World ID approved", icon: Globe, tint: GREEN },
  ApprovalDenied: { label: "Request denied", icon: ShieldX, tint: RED },
  ApprovalExpired: { label: "Request expired", icon: Clock, tint: GREY },
  LooseningPending: { label: "Loosening pending", icon: TrendingUp, tint: GOLD },
  LooseningBlocked: { label: "Blocked by safety policy", icon: ShieldAlert, tint: RED },
  LooseningCooldown: { label: "Safety wait started", icon: Clock, tint: GOLD },
  LooseningCancelled: { label: "Loosening cancelled", icon: CircleSlash, tint: GREY },
  CircuitTripped: { label: "Spending stopped automatically", icon: Snowflake, tint: RED },
  FlightRecord: { label: "Activity log sealed", icon: ScrollText, tint: BLUE },
  DemoFaucet: { label: "Test USDT received", icon: Droplet, tint: BLUE },
};
const time = (s: number) => new Date(s * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const TOPIC = "0.0.11329753";

export function Activity({ vault }: { vault: string }) {
  const chQ = usePoll<Channel[]>(`/api/facilitator/channels?vault=${vault}`, 4000);
  const clQ = usePoll<Claim[]>(`/api/facilitator/claims?limit=300`, 5000);
  const evQ = usePoll<Event[]>(`/api/facilitator/events?vault=${vault}&limit=60`, 4000);
  const channels = chQ.data ?? [];
  const claims = clQ.data ?? [];
  const events = evQ.data ?? [];
  const loading = chQ.data === undefined || evQ.data === undefined;
  const mine = new Set(channels.map((c) => c.channelId.toLowerCase()));
  const myClaims = claims.filter((c) => mine.has(c.channel_id.toLowerCase()));
  const myEvents = events.filter((e) => !e.vault || e.vault.toLowerCase() === vault.toLowerCase());
  const paidRequests = myClaims.reduce((a, c) => a + c.vouchers_covered, 0);
  const topic = myEvents.find((e) => e.hcs)?.hcs?.split("#")[0] ?? TOPIC;

  return (
    <div className="space-y-3.5">
      <PageTitle title="Activity" subtitle="Your agent pays per request. Payments are bundled, so merchants get one transaction for hundreds of requests." />

      {loading ? (
        <Skeleton className="h-[246px] rounded-[32px]" />
      ) : channels.length === 0 && myClaims.length === 0 ? (
        <Empty icon={<Waypoints />} title="No payments yet" hint="When your agent starts paying for APIs, its payment channels and settlements appear here." />
      ) : (
        <>
          {/* Open payments: dark card */}
          <div className="dark-card space-y-3.5 p-6">
            <div className="flex gap-3">
              <div className="grid size-11 shrink-0 place-items-center rounded-full bg-[#333333] text-white">
                <Route className="size-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="text-[16px] font-semibold leading-[22px] tracking-[-0.01em]">Open payments</div>
                <div className="text-[14px] leading-5 text-white/70">Money reserved per merchant. The agent signs running totals, never more than reserved.</div>
              </div>
            </div>
            {channels.map((c) => {
              const open = c.status === "open";
              const pct = Math.max(0, Math.min(100, (Number(BigInt(c.lastAccepted)) / (Number(BigInt(c.locked)) || 1)) * 100));
              return (
                <div key={c.channelId} className="space-y-2.5 rounded-[18px] bg-[#2e2e2e] px-4 py-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[14px] leading-5 text-white">
                      To <span className="font-mono">{short(c.merchant)}</span>
                    </span>
                    <Pill tone={open ? "ok" : "neutral"}>{open ? "Open" : "Settled & closed"}</Pill>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-[4px] bg-white/12">
                    <div className="h-full min-w-2 rounded-[4px] bg-white transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="num text-[12px] leading-4 text-white/60">
                    {usdt(c.lastAccepted)} of {usdt(c.locked)} USDT used · {usdt(c.claimedOnchain)} settled
                  </div>
                </div>
              );
            })}
          </div>

          {/* Settlements */}
          <div className="surface space-y-3.5 p-5">
            <CardHead icon={Receipt} title="Settlements" description={myClaims.length ? `${paidRequests} paid requests settled in ${myClaims.length} transaction${myClaims.length > 1 ? "s" : ""}.` : "Nothing settled yet."} />
            {myClaims.map((c) => (
              <a key={c.tx} href={explorerTx(c.tx)} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-[16px] bg-blue-bg px-4 py-3.5 transition-colors hover:bg-accent">
                <div className="min-w-0 flex-1 space-y-[3px]">
                  <div className="num text-[20px] font-semibold leading-[26px] tracking-[-0.015em] text-ink">{money(c.delta)} USDT</div>
                  <div className="truncate text-[12px] leading-4 text-body">
                    {c.vouchers_covered} requests · to <span className="font-mono">{short(c.merchant)}</span> · {time(c.at)}
                  </div>
                </div>
                <ArrowUpRight className="size-[18px] shrink-0 text-blue" />
              </a>
            ))}
          </div>
        </>
      )}

      {/* Audit log */}
      <div className="surface space-y-1 p-5">
        <CardHead icon={ScrollText} title="Audit log" description="Every decision is also written to a public Hedera topic (tamper-evident)." />
        <div className="pb-1 pt-2">
          <a href={`https://hashscan.io/testnet/topic/${topic}`} target="_blank" rel="noreferrer">
            <Pill className="hover:bg-line">Hedera topic {topic}</Pill>
          </a>
        </div>
        {myEvents.length === 0 && <div className="py-3 text-[14px] text-body">{loading ? "Loading…" : "Nothing yet."}</div>}
        <div>
          {myEvents.map((e, i) => {
            const k = KIND[e.kind] ?? { label: e.kind, icon: X, tint: GREY };
            const Icon = k.icon;
            const seq = e.hcs?.split("#")[1];
            return (
              <div key={e.id}>
                {i > 0 && <div className="h-px bg-[#eef0f5]" />}
                <div className="flex items-center gap-3 py-[11px]">
                  <div className={cn("grid size-[34px] shrink-0 place-items-center rounded-full", k.tint)}>
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="truncate text-[14px] leading-5 tracking-[-0.005em] text-ink">{k.label}</div>
                    <div className="truncate text-[12px] leading-4 text-addr">
                      {time(e.at)}
                      {e.amount ? ` · ${usdt(e.amount)} USDT` : ""}
                      {seq ? ` · #${seq}` : ""}
                    </div>
                  </div>
                  {e.tx && e.tx.startsWith("0x") && (
                    <a className="shrink-0 text-muted-ink hover:text-ink" href={explorerTx(e.tx)} target="_blank" rel="noreferrer" aria-label="View transaction">
                      <ArrowUpRight className="size-4" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
