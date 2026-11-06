"use client";
import { useState } from "react";
import { Coins, Loader2, MessageSquareWarning, Play, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { api, explorerTx, money } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { TxLink } from "./leash/kit";

type RunResult = { paid: number; spent: string; refused: string | null; opened: { merchant: string; txHash: string }[]; claims: string[] };

/** Self-serve demo (Quick actions → Demo run): fund the vault, let the demo agent pay, and let it ask for more. */
export function DemoPanel({ vault, balance, hasDemoAgent, demoState = "active", onChange, goRequests }: { vault: string; balance?: string; hasDemoAgent: boolean; demoState?: "active" | "expired" | "revoked" | "missing"; onChange: () => void; goRequests?: () => void }) {
  const [busy, setBusy] = useState<string>();
  const [last, setLast] = useState<RunResult>();
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
      onChange();
    }
  };
  const low = balance !== undefined && BigInt(balance) < 1_000_000n;
  const note = (text: React.ReactNode) => <div className="rounded-[16px] bg-surface p-3.5 text-[14px] leading-5 text-body">{text}</div>;
  return (
    <div className="space-y-3">
      {!hasDemoAgent && note(<>This vault didn&apos;t authorize the demo agent. Add it with <b className="text-ink">Add agent</b> to try this.</>)}
      {demoState === "expired" && note(<>The demo agent&apos;s time ran out, so it can&apos;t pay. Tap <b className="text-ink">Renew 24 h</b> on it under <b className="text-ink">Your agent</b> (one World ID scan).</>)}
      {demoState === "revoked" && note(<>You froze the demo agent, so it can&apos;t pay any more. That&apos;s the point. To try again, set up a new vault in a private window.</>)}
      {low && (
        <Button
          variant="soft"
          className="w-full"
          disabled={!!busy}
          onClick={() =>
            run("faucet", async () => {
              const r = await api<{ tx: string; amount: string }>("/api/demo/faucet", { vault });
              toast.success(`Sent ${money(r.amount)} test USDT to your vault`, { action: { label: "View", onClick: () => window.open(explorerTx(r.tx), "_blank") } });
            })
          }
        >
          {busy === "faucet" ? <Loader2 className="animate-spin" /> : <Coins />} Get 2 test USDT
        </Button>
      )}
      <Button
        className="w-full"
        disabled={!!busy || demoState !== "active"}
        onClick={() =>
          run("agent", async () => {
            const r = await api<RunResult>("/api/demo/agent", { vault, calls: 20 });
            setLast(r);
            if (r.refused) toast(`Paid ${r.paid} requests, then stopped: ${r.refused}`);
            else toast.success(`Agent paid for ${r.paid} API calls (${money(r.spent)} USDT)`);
          })
        }
      >
        {busy === "agent" ? <Loader2 className="animate-spin" /> : <Play />} {busy === "agent" ? "Agent is paying…" : "Let the agent pay for 20 API calls"}
      </Button>
      <div className="grid grid-cols-2 gap-2.5">
        <Button
          variant="secondary"
          disabled={!!busy || demoState !== "active"}
          onClick={() =>
            run("ask", async () => {
              await api("/api/demo/ask", { vault, kind: "reasonable" });
              toast("Your agent asked for a higher cap. See Requests.", { action: goRequests ? { label: "Open", onClick: goRequests } : undefined });
            })
          }
        >
          {busy === "ask" ? <Loader2 className="animate-spin" /> : <TrendingUp />} Asks for more
        </Button>
        <Button
          variant="destructive"
          disabled={!!busy || demoState !== "active"}
          onClick={() =>
            run("inject", async () => {
              await api("/api/demo/ask", { vault, kind: "injected" });
              toast("A prompt-injected agent asked for 500 USDT. See Requests.", { action: goRequests ? { label: "Open", onClick: goRequests } : undefined });
            })
          }
        >
          {busy === "inject" ? <Loader2 className="animate-spin" /> : <MessageSquareWarning />} Injected agent
        </Button>
      </div>
      {last && (
        <div className="space-y-1.5 rounded-[16px] bg-blue-bg p-3.5 text-[14px] leading-5 text-ink">
          <div>
            <b>{last.paid}</b> paid calls · <b className="num">{money(last.spent)} USDT</b> · the agent signed <b>0</b> transactions
          </div>
          {last.refused && <div className="text-body">Stopped: {last.refused}</div>}
          {last.opened.map((o) => (
            <div key={o.txHash}>
              <TxLink hash={o.txHash} label="Payment channel opened" />
            </div>
          ))}
          {last.claims.map((t) => (
            <div key={t}>
              <TxLink hash={t} label="Merchant settled in one tx" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
