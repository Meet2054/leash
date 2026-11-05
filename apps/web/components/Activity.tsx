"use client";
import { explorerTx, short, usePoll, usdt } from "@/lib/client/api";

type Channel = { channelId: string; vault: string; merchant: string; locked: string; lastAccepted: string; claimedOnchain: string; expiry: string; status: string };
type Claim = { tx: string; channel_id: string; merchant: string; delta: string; fee: string; vouchers_covered: number; calldata_bytes: number; at: number; explorerUrl?: string };
type Event = { id: number; at: number; kind: string; vault: string | null; amount: string | null; tx: string | null; data: string | null; hcs: string | null };

export function Activity({ vault }: { vault: string }) {
  const channels = usePoll<Channel[]>(`/api/facilitator/channels?vault=${vault}`, 4000).data ?? [];
  const claims = usePoll<Claim[]>(`/api/facilitator/claims?limit=50`, 4000).data ?? [];
  const events = usePoll<Event[]>(`/api/facilitator/events?limit=60`, 4000).data ?? [];
  const mine = new Set(channels.map((c) => c.channelId.toLowerCase()));
  return (
    <div className="space-y-4">
      <section className="card space-y-2">
        <h2 className="font-semibold">Payment channels</h2>
        {channels.length === 0 && <div className="text-sm muted">No channels yet.</div>}
        {channels.map((c) => {
          const used = Number(BigInt(c.lastAccepted) * 100n / (BigInt(c.locked) || 1n));
          return (
            <div key={c.channelId} className="soft rounded-xl p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="mono">{short(c.channelId)} → {short(c.merchant)}</span><span className="pill">{c.status}</span></div>
              <div className="h-2 rounded bg-[var(--line)] overflow-hidden"><div className="h-2 bg-[var(--color-brand)]" style={{ width: `${used}%` }} /></div>
              <div className="muted text-xs">vouchers {usdt(c.lastAccepted)} / locked {usdt(c.locked)} USDT · claimed onchain {usdt(c.claimedOnchain)}</div>
            </div>
          );
        })}
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Claims (one tx settles many requests)</h2>
        {claims.filter((c) => mine.has(c.channel_id.toLowerCase())).map((c) => (
          <div key={c.tx} className="text-sm flex justify-between gap-2 border-b line pb-2">
            <div>
              <b>{usdt(c.delta)}</b> USDT → <span className="mono">{short(c.merchant)}</span>
              <div className="muted text-xs">{c.vouchers_covered} paid requests · {c.calldata_bytes} B calldata · fee {usdt(c.fee)}</div>
            </div>
            <a className="underline shrink-0" href={explorerTx(c.tx)} target="_blank" rel="noreferrer">tx</a>
          </div>
        ))}
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Audit log</h2>
        {events.filter((e) => !e.vault || e.vault.toLowerCase() === vault.toLowerCase()).map((e) => (
          <div key={e.id} className="text-xs flex justify-between gap-2 border-b line pb-1">
            <div className="min-w-0">
              <b>{e.kind}</b> {e.amount ? `${usdt(e.amount)} USDT` : ""} <span className="muted">{new Date(e.at * 1000).toLocaleTimeString()}</span>
              {e.hcs && <span className="pill ml-1">HCS {e.hcs}</span>}
            </div>
            {e.tx && e.tx.startsWith("0x") && <a className="underline shrink-0" href={explorerTx(e.tx)} target="_blank" rel="noreferrer">tx</a>}
          </div>
        ))}
      </section>
    </div>
  );
}
