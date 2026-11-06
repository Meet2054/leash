"use client";
import { useState } from "react";
import { Bot, Inbox, UserRound } from "lucide-react";
import { toast } from "sonner";
import { api, friendlyPolicy, short, usePoll } from "@/lib/client/api";
import type { OwnerSigner } from "@/lib/client/signer";
import { Button } from "@/components/ui/button";
import { ApprovalRunner } from "./ApprovalRunner";
import { Empty, Pill, TxLink } from "./leash/kit";
import { Card, CardContent } from "@/components/ui/card";

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

const tone: Record<string, "warn" | "neutral" | "ok" | "bad"> = { PENDING: "warn", APPROVING: "neutral", APPROVED: "ok", DENIED: "bad", EXPIRED: "bad", FAILED: "bad" };
const label: Record<string, string> = { PENDING: "Needs you", APPROVING: "In progress", APPROVED: "Approved", DENIED: "Denied", EXPIRED: "Expired", FAILED: "Failed" };

/** Make the server's op description friendlier ("Set session 0x…: cap 8 USDT, expires …"). */
const friendly = (d: string) =>
  d
    .replace(/^Set session (0x[0-9a-fA-F]+): cap ([\d.]+ USDT), expires (.*)/, (_m, _s, cap, exp) => `Set the agent's cap to ${cap}, valid until ${new Date(exp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`)
    .replace(/^Add session (0x[0-9a-fA-F]+): cap ([\d.]+ USDT).*/, "Add an agent with a $2 cap")
    .replace(/^Withdraw ([\d.]+ USDT) to (0x[0-9a-fA-F]{6}).*/, "Withdraw $1 to $2…")
    .replace(/^Allow merchant (0x[0-9a-fA-F]{6})[0-9a-fA-F]*: daily cap ([\d.]+ USDT).*/, "Allow merchant $1… ($2 per day)");

export function Approvals({ vault, chainId, signer }: { vault: string; chainId: number; signer: OwnerSigner | null }) {
  const { data, refresh } = usePoll<Approval[]>(`/api/approvals?vault=${vault}`, 2500);
  const [open, setOpen] = useState<string>();
  const deny = async (id: string) => {
    await api(`/api/approvals/${id}/deny`, {});
    toast("Denied. Nothing changed, and the agent stays capped.");
    setOpen(undefined);
    refresh();
  };
  const list = data ?? [];
  const pending = list.filter((a) => a.status === "PENDING" || a.status === "APPROVING");
  const past = list.filter((a) => !(a.status === "PENDING" || a.status === "APPROVING"));
  return (
    <div className="space-y-3">
      <div className="px-1">
        <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
        <p className="mt-1 text-[0.85rem] text-muted-foreground">Your agent can ask for more room. Only you can say yes, with World ID and your own key. Saying no changes nothing.</p>
      </div>
      {list.length === 0 && <Empty icon={<Inbox className="size-5" />} title="No requests yet" hint="When your agent asks for a higher limit, it shows up here." />}
      {[...pending, ...past].map((a) => (
        <Card key={a.id} className={a.status === "PENDING" || a.status === "APPROVING" ? "" : "opacity-80"}>
          <CardContent className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted">{a.source === "agent" ? <Bot className="size-5" /> : <UserRound className="size-5" />}</div>
                <div className="min-w-0">
                  <div className="text-[0.95rem] font-semibold leading-snug tracking-tight">{friendly(a.description)}</div>
                  <div className="mt-0.5 text-[0.75rem] text-muted-foreground">
                    {a.source === "agent" ? <>Asked by your agent {short(a.session)}</> : "Your own edit"} · {new Date(a.createdAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
              <Pill tone={tone[a.status] ?? "neutral"}>{label[a.status] ?? a.status}</Pill>
            </div>
            {a.reason && (
              <div className="well p-3 text-[0.82rem] leading-relaxed">
                <span className="text-muted-foreground">Reason given: </span>&ldquo;{a.reason}&rdquo;
              </div>
            )}
            {a.statusReason && a.status !== "PENDING" && open !== a.id && <div className="text-[0.78rem] leading-relaxed text-muted-foreground">{friendlyPolicy(a.statusReason)}</div>}
            {a.txHash && <TxLink hash={a.txHash} />}
            {a.status === "PENDING" && open !== a.id && (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" size="lg" onClick={() => deny(a.id)}>
                  Deny
                </Button>
                <Button size="lg" onClick={() => setOpen(a.id)}>
                  Review
                </Button>
              </div>
            )}
            {open === a.id && (
              <div className="space-y-2">
                <ApprovalRunner approvalId={a.id} vault={vault} chainId={chainId} signer={signer} onDone={refresh} />
                {(a.status === "PENDING" || a.status === "APPROVING") && (
                  <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => deny(a.id)}>
                    Deny instead
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
