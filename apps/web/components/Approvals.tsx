"use client";
import { useState } from "react";
import { ArrowUpRight, Check, Clock, Globe, Hourglass, Inbox, ShieldAlert, TrendingUp, X } from "lucide-react";
import { toast } from "sonner";
import { api, explorerTx, friendlyPolicy, short, usePoll } from "@/lib/client/api";
import type { OwnerSigner } from "@/lib/client/signer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApprovalRunner } from "./ApprovalRunner";
import { AlertCard, Empty, PageTitle } from "./leash/kit";

type Approval = {
  id: string;
  source: "agent" | "owner";
  vault: string;
  session: string | null;
  description: string;
  reason: string;
  status: string;
  statusReason: string | null;
  createdAt: number;
  txHash: string | null;
};

const hhmm = (s: number) => new Date(s * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dayTime = (d: Date) => `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
const trim = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Short card title from the server's op description ("Set session 0x…: cap 8 USDT, expires …"). */
function titleOf(d: string): string {
  let m = d.match(/^Set session (0x[0-9a-fA-F]+): cap ([\d.]+) USDT/);
  if (m) return `Raise cap to ${Number(m[2])} USDT`;
  m = d.match(/^Add session (0x[0-9a-fA-F]+): cap ([\d.]+) USDT/);
  if (m) return `Add an agent (${Number(m[2])} USDT cap)`;
  m = d.match(/^Withdraw ([\d.]+) USDT to (0x[0-9a-fA-F]{6})/);
  if (m) return `Withdraw ${Number(m[1])} USDT`;
  m = d.match(/^Allow merchant (0x[0-9a-fA-F]{6})[0-9a-fA-F]*/);
  if (m) return `Allow merchant ${m[1]}…`;
  return d.replace(/^Batch: /, "");
}
const untilOf = (d: string): Date | null => {
  const iso = d.match(/expires ([0-9T:.\-Z]+)/)?.[1];
  const t = iso ? new Date(iso) : null;
  return t && !Number.isNaN(t.getTime()) ? t : null;
};
const isPolicyBlock = (a: Approval) => a.status === "DENIED" && /attestor policy|safety policy/i.test(a.statusReason ?? "");

type Row = { kind: "one"; a: Approval } | { kind: "blocked"; items: Approval[] };

export function Approvals({ vault, chainId, signer }: { vault: string; chainId: number; signer: OwnerSigner | null }) {
  const { data, refresh } = usePoll<Approval[]>(`/api/approvals?vault=${vault}`, 2500);
  const [open, setOpen] = useState<string>();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const deny = async (id: string) => {
    await api(`/api/approvals/${id}/deny`, {});
    toast("Denied. Nothing changed, and the agent stays capped.");
    setOpen(undefined);
    refresh();
  };
  const hide = (ids: string[]) => setHidden((h) => new Set([...h, ...ids]));

  const list = (data ?? []).filter((a) => !hidden.has(a.id));
  const live = list.filter((a) => a.status === "PENDING" || a.status === "APPROVING");
  const past = list.filter((a) => !(a.status === "PENDING" || a.status === "APPROVING"));
  // policy blocks of the same ask are one story ("2 attempts · 20:26, 20:27")
  const rows: Row[] = live.map((a) => ({ kind: "one" as const, a }));
  const groups = new Map<string, Approval[]>();
  for (const a of past) {
    if (isPolicyBlock(a)) {
      const k = a.description;
      if (!groups.has(k)) (groups.set(k, []), rows.push({ kind: "blocked", items: groups.get(k)! }));
      groups.get(k)!.push(a);
    } else rows.push({ kind: "one", a });
  }

  return (
    <div className="space-y-3.5">
      <PageTitle title="Requests" subtitle="Your agent can ask for more room. Only you can say yes, with World ID and your own key. Saying no changes nothing." />
      {data === undefined && <Skeleton className="h-[256px] rounded-[24px]" />}
      {data !== undefined && list.length === 0 && <Empty icon={<Inbox />} title="No requests yet" hint="When your agent asks for a higher limit, it shows up here." />}
      {rows.map((r, idx) => {
        const stacked = idx < rows.length - 1;
        if (r.kind === "blocked") {
          const first = r.items[r.items.length - 1];
          const times = r.items
            .map((a) => a.createdAt)
            .sort((x, y) => x - y)
            .map(hhmm);
          return (
            <AlertCard
              key={`b-${first.id}`}
              hue="red"
              stacked={stacked}
              icon={<ShieldAlert />}
              title="Blocked: possible prompt injection"
              body={
                <>
                  Your agent asked: {titleOf(first.description).replace(/^Raise/, "raise").replace(/^Add/, "add").replace(/^Withdraw/, "withdraw").replace(/^Allow/, "allow")}
                  {first.reason ? <>, saying &ldquo;{trim(first.reason, 120)}&rdquo;</> : null}. {friendlyPolicy(first.statusReason ?? "").replace(/^Blocked by the safety policy: /, "The safety policy says ")}
                </>
              }
              meta={`${r.items.length} attempt${r.items.length > 1 ? "s" : ""} · ${times.join(", ")}`}
              metaIcon={<Clock />}
              onDismiss={() => hide(r.items.map((a) => a.id))}
            />
          );
        }
        const a = r.a;
        const until = untilOf(a.description);
        const who = a.source === "agent" ? `Asked by your agent ${short(a.session)}.` : "Your own edit.";
        const body = (
          <>
            {a.reason ? <>&ldquo;{trim(a.reason)}&rdquo; </> : null}
            {who}
          </>
        );
        if (a.status === "PENDING" || a.status === "APPROVING")
          return (
            <AlertCard
              key={a.id}
              hue="gold"
              stacked={stacked}
              icon={<TrendingUp />}
              title={titleOf(a.description)}
              body={body}
              meta={`${until ? `Until ${dayTime(until)} · ` : ""}asked ${hhmm(a.createdAt)}`}
              metaIcon={<Clock />}
              actions={
                open === a.id ? undefined : (
                  <>
                    <Button variant="secondary" onClick={() => deny(a.id)}>
                      Deny
                    </Button>
                    <Button variant="green" onClick={() => setOpen(a.id)}>
                      <Globe /> Approve
                    </Button>
                  </>
                )
              }
            >
              {open === a.id && (
                <div className="space-y-2">
                  <ApprovalRunner approvalId={a.id} vault={vault} chainId={chainId} signer={signer} onDone={refresh} autoStart />
                  <Button variant="ghost" className="w-full text-body" onClick={() => deny(a.id)}>
                    Deny instead
                  </Button>
                </div>
              )}
            </AlertCard>
          );
        if (a.status === "APPROVED")
          return (
            <AlertCard
              key={a.id}
              hue="green"
              stacked={stacked}
              icon={<Check />}
              title={titleOf(a.description).replace(/^Raise cap to/, "Cap raised to").replace(/^Add an agent/, "Agent added").replace(/^Withdraw/, "Withdrew").replace(/^Allow merchant/, "Merchant allowed")}
              body={
                <>
                  {a.reason ? <>&ldquo;{trim(a.reason)}&rdquo; </> : null}Approved with World ID and your owner key.
                </>
              }
              meta={
                a.txHash ? (
                  <a href={explorerTx(a.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                    Approved {hhmm(a.createdAt)} · view tx <ArrowUpRight className="size-4" />
                  </a>
                ) : (
                  `Approved ${hhmm(a.createdAt)}`
                )
              }
              metaIcon={<Check />}
              onDismiss={() => hide([a.id])}
            />
          );
        // denied by you, expired, failed: nothing happened
        const expired = a.status === "EXPIRED";
        return (
          <AlertCard
            key={a.id}
            hue={expired ? "gold" : "red"}
            muted
            stacked={stacked}
            icon={expired ? <Hourglass /> : <X />}
            title={`${expired ? "Expired" : a.status === "FAILED" ? "Didn't go through" : "Denied"}: ${titleOf(a.description).replace(/^\w/, (c) => c.toLowerCase())}`}
            body={a.statusReason ? friendlyPolicy(a.statusReason) : "Nothing changed; the agent stays capped."}
            meta={`${expired ? "Expired" : a.status === "FAILED" ? "Failed" : "Denied"} · asked ${hhmm(a.createdAt)}`}
            metaIcon={<Clock />}
            onDismiss={() => hide([a.id])}
          />
        );
      })}
    </div>
  );
}
