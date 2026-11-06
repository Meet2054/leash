"use client";
import { useState } from "react";
import { Bot, Coins, Loader2, MessageSquareWarning, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { api, explorerTx, money } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Section, TxLink } from "./leash/kit";

type RunResult = { paid: number; spent: string; refused: string | null; opened: { merchant: string; txHash: string }[]; claims: string[] };

/** Self-serve demo: fund the vault, let the demo agent pay, and let it ask for more (fair or prompt-injected). */
export function DemoPanel({ vault, balance, hasDemoAgent, onChange, goRequests }: { vault: string; balance?: string; hasDemoAgent: boolean; onChange: () => void; goRequests?: () => void }) {
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
  return (
    <Section icon={<Bot className="size-5" />} title="Try it with the demo agent" description="Our demo agent has a session key in your vault. It never holds gas, and it can only do what your limits allow.">
      {!hasDemoAgent && <div className="well p-3 text-[0.8rem] text-muted-foreground">This vault didn&apos;t authorize the demo agent. Add it under &ldquo;Add an agent&rdquo; to try this.</div>}
      <div className="grid gap-2">
        {low && (
          <Button
            variant="secondary"
            size="lg"
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
          size="lg"
          disabled={!!busy || !hasDemoAgent}
          onClick={() =>
            run("agent", async () => {
              const r = await api<RunResult>("/api/demo/agent", { vault, calls: 20 });
              setLast(r);
              if (r.refused) toast(`Paid ${r.paid} requests, then stopped: ${r.refused}`);
              else toast.success(`Agent paid for ${r.paid} API calls (${money(r.spent)} USDT)`);
            })
          }
        >
          {busy === "agent" ? <Loader2 className="animate-spin" /> : <TrendingUp />} {busy === "agent" ? "Agent is paying…" : "Let the agent pay for 20 API calls"}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            disabled={!!busy || !hasDemoAgent}
            onClick={() =>
              run("ask", async () => {
                await api("/api/demo/ask", { vault, kind: "reasonable" });
                toast("Your agent asked for a higher cap. See Requests.", { action: goRequests ? { label: "Open", onClick: goRequests } : undefined });
              })
            }
          >
            {busy === "ask" ? <Loader2 className="animate-spin" /> : null} Agent asks for more
          </Button>
          <Button
            variant="secondary"
            disabled={!!busy || !hasDemoAgent}
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
      </div>
      {last && (
        <div className="well space-y-1.5 p-3.5 text-[0.8rem]">
          <div>
            <span className="font-semibold">{last.paid}</span> paid calls · <span className="num font-semibold">{money(last.spent)} USDT</span> · the agent signed <span className="font-semibold">0</span> transactions
          </div>
          {last.refused && <div className="text-muted-foreground">Stopped: {last.refused}</div>}
          {last.opened.map((o) => (
            <TxLink key={o.txHash} hash={o.txHash} label="Payment channel opened" />
          ))}
          {last.claims.map((t) => (
            <div key={t}>
              <TxLink hash={t} label="Merchant settled in one tx" />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
