"use client";
import { useState } from "react";
import { getAddress, isAddress, type Hex } from "viem";
import { Bot, ChevronDown, Loader2, Snowflake, Store, Wallet, Zap } from "lucide-react";
import { toast } from "sonner";
import { encode, mandateChangeDigest, parseUnits6, type Op } from "@leash/sdk";
import { api, explorerTx, money, short, usePoll, usdt } from "@/lib/client/api";
import type { OwnerSigner } from "@/lib/client/signer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApprovalRunner } from "./ApprovalRunner";
import { DemoPanel } from "./DemoPanel";
import { Copyable, Field, Meter, Pill, Section, Stat } from "./leash/kit";

export type VaultState = {
  vault: string;
  deployed: boolean;
  balance: string;
  free?: string;
  locked?: string;
  nonce?: string;
  worldSubjectHash?: string;
  pqPubKeyHash?: string;
  verifier?: string;
  sessions?: { address: string; expiry: string; revoked: boolean; cap: string; locked: string; spent: string }[];
  merchants?: { address: string; allowed: boolean; dailyCap: string; spentToday: string; maxChannel: string }[];
};

/** A channel reserves 1 USDT, so a renewed agent needs a cap of at least ~2 USDT (still ≤ 2× per the safety policy). */
const renewCap = (cap: bigint) => (cap >= 2_000_000n ? cap : cap * 2n >= 2_000_000n ? 2_000_000n : cap * 2n);

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="well">
      <button className="flex w-full items-center justify-between px-4 py-3 text-[0.88rem] font-medium" onClick={() => setOpen(!open)}>
        {title}
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </div>
  );
}

export function Mandate({ vault, chainId, signer, demoAgent, goRequests }: { vault: string; chainId: number; signer: OwnerSigner | null; demoAgent?: string | null; goRequests?: () => void }) {
  const { data: v, refresh } = usePoll<VaultState>(`/api/vault/${vault}`, 5000);
  const { data: breaker } = usePoll<{ enabled?: boolean; state?: string; reason?: string; detail?: string; sessionsSeen?: string[]; reopensAt?: number }>(`/api/facilitator/breaker?vault=${vault}`, 3000);
  const [busy, setBusy] = useState<string>();
  const [pendingApproval, setPendingApproval] = useState<string>();
  const [capEdit, setCapEdit] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ session: "", cap: "5", hours: "24", merchant: "", daily: "10", max: "1", withdrawTo: "", withdrawAmt: "1" });

  /** Tightening → PQ signature only. Loosening → owner approval with World ID. */
  const submit = async (op: Op, label: string) => {
    if (!signer) return toast.error("Your owner key isn't connected. Open Setup first.");
    try {
      await signer.unlock?.();
      setBusy(label);
      const p = await api<{ change: { action: number; data: Hex; nonce: string; deadline: string }; digest: Hex; loosening: boolean }>("/api/changes/prepare", { vault, action: op.action, data: op.data });
      if (p.loosening) {
        const r = await api<{ id: string }>("/api/approvals", { vault, op, reason: `Owner edit: ${label}` });
        setPendingApproval(r.id);
        setBusy(undefined);
        toast("This loosens a limit, so it needs World ID. Approve it below.");
        return;
      }
      const change = { action: p.change.action, data: p.change.data, nonce: BigInt(p.change.nonce), deadline: BigInt(p.change.deadline) };
      const digest = mandateChangeDigest(chainId, getAddress(vault), change);
      if (digest !== p.digest) throw new Error("digest mismatch");
      const pqSig = await signer.sign(digest, label);
      const r = await api<{ txHash: string }>("/api/changes/submit", { vault, change: p.change, pqPubKey: await signer.pubKey(), pqSig });
      toast.success(`${label}: done`, { action: { label: "View", onClick: () => window.open(explorerTx(r.txHash), "_blank") } });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  if (!v)
    return (
      <div className="space-y-3">
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  if (!v.deployed)
    return (
      <Section icon={<Wallet className="size-5" />} title="Vault not created yet" description="Finish Setup to create it.">
        <div className="text-[0.85rem]">Waiting deposit: <span className="num font-semibold">{usdt(v.balance)} USDT</span></div>
      </Section>
    );
  const now = Date.now() / 1000;
  const live = (v.sessions ?? []).filter((s) => !s.revoked);

  return (
    <div className="space-y-3">
      <div className="px-1">
        <h1 className="text-2xl font-semibold tracking-tight">Limits</h1>
        <p className="mt-1 text-[0.85rem] text-muted-foreground">Lowering a limit or freezing your agent needs only your key. Raising one needs World ID too.</p>
      </div>

      <Section>
        <div className="pt-1">
          <div className="text-[0.78rem] text-muted-foreground">In your vault</div>
          <div className="num text-4xl font-semibold tracking-tight">
            {money(v.balance)} <span className="text-lg font-medium text-muted-foreground">USDT</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat value={money(v.free)} label="Free to spend" />
          <Stat value={money(v.locked)} label="Reserved for open payments" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Copyable value={vault} />
          <a className="text-[0.78rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={`https://explorer.testnet.whitechain.io/address/${vault}`} target="_blank" rel="noreferrer">
            View on explorer ↗
          </a>
        </div>
      </Section>

      <DemoPanel
        vault={vault}
        balance={v.balance}
        hasDemoAgent={Boolean(demoAgent && v.sessions?.some((s) => s.address.toLowerCase() === demoAgent.toLowerCase()))}
        demoState={(() => {
          const d = demoAgent ? v.sessions?.find((s) => s.address.toLowerCase() === demoAgent.toLowerCase()) : undefined;
          return !d ? "missing" : d.revoked ? "revoked" : Number(d.expiry) <= now ? "expired" : "active";
        })()}
        onChange={refresh}
        goRequests={goRequests}
      />

      {breaker?.state === "open" && (
        <Section icon={<Zap className="size-5 text-[var(--bad)]" />} title="Spending stopped automatically" description={`${breaker.detail}. All payments from this vault are paused${breaker.reopensAt ? ` until ${new Date(breaker.reopensAt).toLocaleTimeString()}` : ""}.`}>
          <Button
            variant="destructive"
            size="lg"
            className="w-full"
            disabled={!!busy}
            onClick={() => {
              const s = (breaker.sessionsSeen ?? []).filter((x) => v?.sessions?.some((y) => y.address.toLowerCase() === x.toLowerCase() && !y.revoked));
              const ops = s.map((x) => encode.revokeSession(getAddress(x)));
              if (ops.length) submit(ops.length === 1 ? ops[0] : encode.batch(ops), `Freeze ${ops.length} agent(s)`);
            }}
          >
            <Snowflake /> Freeze the agents involved
          </Button>
        </Section>
      )}

      <Section
        icon={<Bot className="size-5" />}
        title="Agents"
        description="Each agent has its own cap and expiry."
        action={
          <Button
            variant="destructive"
            size="sm"
            disabled={!!busy || live.length === 0}
            onClick={() => {
              const ops = live.map((s) => encode.revokeSession(getAddress(s.address)));
              if (ops.length) submit(ops.length === 1 ? ops[0] : encode.batch(ops), `Freeze all (${ops.length})`);
            }}
          >
            <Snowflake /> Freeze all
          </Button>
        }
      >
        {(v.sessions ?? []).length === 0 && <div className="well p-3 text-[0.82rem] text-muted-foreground">No agents yet.</div>}
        {v.sessions?.map((s) => {
          const active = !s.revoked && Number(s.expiry) > now;
          const used = BigInt(s.spent) + BigInt(s.locked);
          return (
            <div key={s.address} className="well space-y-3 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <Copyable value={s.address} />
                <Pill tone={active ? "ok" : "bad"}>{s.revoked ? "Revoked" : active ? "Active" : "Expired"}</Pill>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between text-[0.82rem]">
                  <span className="text-muted-foreground">Used</span>
                  <span className="num">
                    <span className="font-semibold">{money(used)}</span> <span className="text-muted-foreground">of {money(s.cap)} USDT</span>
                  </span>
                </div>
                <Meter value={used} max={BigInt(s.cap)} />
                <div className="text-[0.72rem] text-muted-foreground">Expires {new Date(Number(s.expiry) * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</div>
              </div>
              {!s.revoked && !active && (
                <Button className="w-full" disabled={!!busy} onClick={() => submit(encode.setSessionLimits(getAddress(s.address), BigInt(Math.floor(now + 24 * 3600)), renewCap(BigInt(s.cap))), "Renew agent for 24 hours")}>
                  Renew for 24 hours · cap {money(renewCap(BigInt(s.cap)))} USDT (needs World ID)
                </Button>
              )}
              {!s.revoked && (
                <div className="flex gap-2">
                  <Input className="h-10" inputMode="decimal" placeholder="New cap" value={capEdit[s.address] ?? ""} onChange={(e) => setCapEdit({ ...capEdit, [s.address]: e.target.value })} />
                  <Button variant="secondary" disabled={!!busy || !capEdit[s.address]} onClick={() => submit(encode.setSessionLimits(getAddress(s.address), BigInt(s.expiry), parseUnits6(capEdit[s.address])), `Set cap to ${capEdit[s.address]} USDT`)}>
                    Set cap
                  </Button>
                  <Button variant="destructive" disabled={!!busy} onClick={() => submit(encode.revokeSession(getAddress(s.address)), `Revoke agent ${short(s.address)}`)}>
                    Revoke
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </Section>

      <Section icon={<Store className="size-5" />} title="Allowed merchants" description="Your agent can only pay these.">
        {v.merchants?.map((m) => (
          <div key={m.address} className="well flex items-center justify-between gap-3 p-3.5">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[0.78rem]">{short(m.address)}</span>
                {m.allowed ? <Pill tone="ok">Allowed</Pill> : <Pill>Removed</Pill>}
              </div>
              <div className="text-[0.72rem] text-muted-foreground">
                Today {usdt(m.spentToday)} / {usdt(m.dailyCap)} USDT · max {usdt(m.maxChannel)} per channel
              </div>
            </div>
            {m.allowed && (
              <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => submit(encode.removeMerchant(getAddress(m.address)), `Remove merchant ${short(m.address)}`)}>
                Remove
              </Button>
            )}
          </div>
        ))}
      </Section>

      <Collapsible title="Add an agent">
        <Field label="Agent session address">
          <Input className="font-mono text-[0.8rem]" placeholder="0x…" value={form.session} onChange={(e) => setForm({ ...form, session: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cap (USDT)">
            <Input inputMode="decimal" value={form.cap} onChange={(e) => setForm({ ...form, cap: e.target.value })} />
          </Field>
          <Field label="Valid for (hours)">
            <Input inputMode="numeric" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />
          </Field>
        </div>
        <Button className="w-full" disabled={!!busy || !isAddress(form.session)} onClick={() => submit(encode.addSession(getAddress(form.session), BigInt(Math.floor(now + Number(form.hours) * 3600)), parseUnits6(form.cap)), "Add agent")}>
          Add agent (needs World ID)
        </Button>
      </Collapsible>

      <Collapsible title="Allow a merchant">
        <Field label="Merchant address">
          <Input className="font-mono text-[0.8rem]" placeholder="0x…" value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Daily cap (USDT)">
            <Input inputMode="decimal" value={form.daily} onChange={(e) => setForm({ ...form, daily: e.target.value })} />
          </Field>
          <Field label="Max per channel">
            <Input inputMode="decimal" value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} />
          </Field>
        </div>
        <Button className="w-full" disabled={!!busy || !isAddress(form.merchant)} onClick={() => submit(encode.setMerchant(getAddress(form.merchant), parseUnits6(form.daily), parseUnits6(form.max)), "Set merchant limits")}>
          Save merchant
        </Button>
      </Collapsible>

      <Collapsible title="Withdraw USDT">
        <Field label="Send to">
          <Input className="font-mono text-[0.8rem]" placeholder="0x…" value={form.withdrawTo} onChange={(e) => setForm({ ...form, withdrawTo: e.target.value })} />
        </Field>
        <Field label="Amount (USDT)" hint="Withdrawals need World ID; large ones also wait a few minutes for safety.">
          <Input inputMode="decimal" value={form.withdrawAmt} onChange={(e) => setForm({ ...form, withdrawAmt: e.target.value })} />
        </Field>
        <Button className="w-full" disabled={!!busy || !isAddress(form.withdrawTo)} onClick={() => submit(encode.withdraw(getAddress(form.withdrawTo), parseUnits6(form.withdrawAmt)), `Withdraw ${form.withdrawAmt} USDT`)}>
          Withdraw
        </Button>
      </Collapsible>

      {pendingApproval && (
        <Section title="Confirm this change" description="It loosens a limit, so it needs a fresh World ID check and your key.">
          <ApprovalRunner approvalId={pendingApproval} vault={vault} chainId={chainId} signer={signer} onDone={refresh} />
        </Section>
      )}
      {busy && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-40 mx-auto flex w-fit items-center gap-2 rounded-full bg-primary px-4 py-2 text-[0.8rem] font-medium text-primary-foreground shadow-[var(--shadow-soft)]">
          <Loader2 className="size-4 animate-spin" /> {busy}…
        </div>
      )}
    </div>
  );
}
