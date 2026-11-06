"use client";
import { ArrowUpRight, Receipt, ScrollText, Waypoints } from "lucide-react";
import { explorerTx, money, short, usePoll, usdt } from "@/lib/client/api";
import { Empty, Meter, Pill, Section } from "./leash/kit";

type Channel = { channelId: string; vault: string; merchant: string; locked: string; lastAccepted: string; claimedOnchain: string; expiry: string; status: string };
type Claim = { tx: string; channel_id: string; merchant: string; delta: string; fee: string; vouchers_covered: number; calldata_bytes: number; at: number; explorerUrl?: string };
type Event = { id: number; at: number; kind: string; vault: string | null; amount: string | null; tx: string | null; data: string | null; hcs: string | null };

const kindLabel: Record<string, string> = {
  ChannelOpened: "Payment channel opened",
  Claimed: "Merchant paid (batched)",
  ChannelClosed: "Channel closed",
  MandateChanged: "Limits changed",
  VaultCreated: "Vault created",
  ApprovalRequested: "Agent asked for more",
  ApprovalGranted: "World ID approved",
  ApprovalDenied: "Request denied",
  ApprovalExpired: "Request expired",
  LooseningPending: "Loosening pending",
  LooseningBlocked: "Blocked by safety policy",
  LooseningCooldown: "Safety wait started",
  LooseningCancelled: "Loosening cancelled",
  CircuitTripped: "Spending stopped automatically",
  FlightRecord: "Activity log sealed",
};
const time = (s: number) => new Date(s * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function Activity({ vault }: { vault: string }) {
  const channels = usePoll<Channel[]>(`/api/facilitator/channels?vault=${vault}`, 4000).data ?? [];
  const claims = usePoll<Claim[]>(`/api/facilitator/claims?limit=50`, 4000).data ?? [];
  const events = usePoll<Event[]>(`/api/facilitator/events?limit=60`, 4000).data ?? [];
  const mine = new Set(channels.map((c) => c.channelId.toLowerCase()));
  const myClaims = claims.filter((c) => mine.has(c.channel_id.toLowerCase()));
  const myEvents = events.filter((e) => !e.vault || e.vault.toLowerCase() === vault.toLowerCase());
  const paidRequests = myClaims.reduce((a, c) => a + c.vouchers_covered, 0);
  return (
    <div className="space-y-3">
      <div className="px-1">
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="mt-1 text-[0.85rem] text-muted-foreground">Your agent pays per request. Payments are bundled, so merchants get one transaction for hundreds of requests.</p>
      </div>

      {channels.length === 0 && myClaims.length === 0 ? (
        <Empty icon={<Waypoints className="size-5" />} title="No payments yet" hint="When your agent starts paying for APIs, its payment channels and settlements appear here." />
      ) : (
        <>
          <Section icon={<Waypoints className="size-5" />} title="Open payments" description="Money reserved per merchant. The agent signs running totals, never more than reserved.">
            {channels.map((c) => (
              <div key={c.channelId} className="well space-y-2 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[0.78rem]">To {short(c.merchant)}</span>
                  <Pill>{c.status}</Pill>
                </div>
                <Meter value={BigInt(c.lastAccepted)} max={BigInt(c.locked)} />
                <div className="num text-[0.75rem] text-muted-foreground">
                  {usdt(c.lastAccepted)} of {usdt(c.locked)} USDT used · {usdt(c.claimedOnchain)} settled
                </div>
              </div>
            ))}
          </Section>

          <Section icon={<Receipt className="size-5" />} title="Settlements" description={myClaims.length ? `${paidRequests} paid requests settled in ${myClaims.length} transactions.` : "Nothing settled yet."}>
            {myClaims.map((c) => (
              <a key={c.tx} href={explorerTx(c.tx)} target="_blank" rel="noreferrer" className="well flex items-center justify-between gap-3 p-3.5 hover:bg-accent">
                <div className="min-w-0">
                  <div className="num text-[0.9rem] font-semibold">{money(c.delta)} USDT</div>
                  <div className="text-[0.72rem] text-muted-foreground">
                    {c.vouchers_covered} requests · to {short(c.merchant)} · {time(c.at)}
                  </div>
                </div>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
              </a>
            ))}
          </Section>
        </>
      )}

      <Section icon={<ScrollText className="size-5" />} title="Audit log" description="Every decision is also written to a public Hedera topic (tamper-evident).">
        {myEvents.length === 0 && <div className="well p-3 text-[0.82rem] text-muted-foreground">Nothing yet.</div>}
        <div className="space-y-1">
          {myEvents.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl px-1 py-2">
              <div className="min-w-0">
                <div className="truncate text-[0.85rem]">{kindLabel[e.kind] ?? e.kind}</div>
                <div className="text-[0.7rem] text-muted-foreground">
                  {time(e.at)}
                  {e.amount ? ` · ${usdt(e.amount)} USDT` : ""}
                  {e.hcs ? ` · Hedera #${e.hcs}` : ""}
                </div>
              </div>
              {e.tx && e.tx.startsWith("0x") && (
                <a className="shrink-0 text-muted-foreground hover:text-foreground" href={explorerTx(e.tx)} target="_blank" rel="noreferrer" aria-label="View transaction">
                  <ArrowUpRight className="size-4" />
                </a>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
