"use client";
/** The bottom sheets the Quick actions card (and the Home cards) open. Figma: Sheet · Add an agent / Allow a merchant / Withdraw USDT. */
import { useEffect, useState } from "react";
import { getAddress, isAddress } from "viem";
import { Ban, Clock, Globe, KeyRound, Loader2, Play, QrCode, RefreshCw, SlidersHorizontal, Snowflake, Store, Trash2, Upload, UserPlus, Wallet } from "lucide-react";
import { encode, parseUnits6 } from "@leash/sdk";
import { money, short } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Pill, Sheet } from "@/components/leash/kit";
import type { QuickAction } from "@/components/leash/shell";
import { DemoPanel } from "@/components/DemoPanel";
import { renewCap, type MandateOps, type Session } from "@/components/Mandate";
import { cn } from "@/lib/utils";
import { dateTime, merchantLabel } from "./format";

export type SheetAction = Exclude<QuickAction, "copy" | "explorer" | "world-id" | "settings">;

function Tags({ loosen }: { loosen: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Pill tone="warn">
        <SlidersHorizontal className="size-3.5" /> Limit
      </Pill>
      {loosen ? (
        <Pill tone="ok">
          <Globe className="size-3.5" /> Needs World ID
        </Pill>
      ) : (
        <Pill tone="blue">
          <KeyRound className="size-3.5" /> Owner key only
        </Pill>
      )}
    </div>
  );
}

/** Address input with the QR glyph from the design (decorative). */
function AddressInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Input className="pr-12 font-mono text-[15px]" placeholder="0x…" value={value} onChange={(e) => onChange(e.target.value.trim())} autoComplete="off" spellCheck={false} />
      <QrCode aria-hidden className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-muted-ink" />
    </div>
  );
}

function AgentPicker({ agents, value, onChange, names }: { agents: Session[]; value?: string; onChange: (a: string) => void; names: (a: string) => string }) {
  if (agents.length <= 1) return null;
  return (
    <div className="space-y-2">
      <div className="text-[14px] text-body">Agent</div>
      <div className="space-y-2">
        {agents.map((s) => (
          <button
            key={s.address}
            type="button"
            onClick={() => onChange(s.address)}
            className={cn("flex w-full items-center justify-between rounded-[16px] px-4 py-3 text-left ring-inset", value?.toLowerCase() === s.address.toLowerCase() ? "bg-amber-bg ring-[1.5px] ring-amber" : "bg-surface")}
          >
            <span className="text-[15px] font-medium text-ink">{names(s.address)}</span>
            <span className="font-mono text-[13px] text-addr">{short(s.address)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const Spin = ({ on, icon }: { on: boolean; icon: React.ReactNode }) => (on ? <Loader2 className="animate-spin" /> : <>{icon}</>);

export function HomeSheets(props: {
  action: SheetAction | null;
  close: () => void;
  m: MandateOps;
  vault: string;
  agentName: (a: string) => string;
  merchantNames: Map<string, string>;
  preAgent?: string;
  demo: { hasDemoAgent: boolean; demoState: "active" | "expired" | "revoked" | "missing"; goRequests: () => void };
}) {
  const { action, close, m, vault } = props;
  const v = m.v;
  const now = Date.now() / 1000;
  const sessions = v?.sessions ?? [];
  const live = sessions.filter((s) => !s.revoked);
  const [f, setF] = useState({ session: "", cap: "5", hours: "24", merchant: "", daily: "10", max: "1", withdrawTo: "", withdrawAmt: "1", newCap: "" });
  const [agent, setAgent] = useState<string>();

  useEffect(() => {
    if (!action) return;
    setAgent(props.preAgent ?? live[0]?.address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, props.preAgent]);

  const run = async (p: ReturnType<MandateOps["submit"]>) => {
    const r = await p;
    if (r !== "error") close();
  };
  const busy = !!m.busy;
  const picked = live.find((s) => s.address.toLowerCase() === agent?.toLowerCase()) ?? live[0];

  const open = (a: SheetAction) => action === a;
  const onOpenChange = (o: boolean) => !o && close();

  return (
    <>
      <Sheet open={open("add-agent")} onOpenChange={onOpenChange} title="Add an agent" icon={<UserPlus />} hue="gold" description="Give another agent its own session key, cap and expiry. It never holds gas or a seed phrase.">
        <Field label="Agent session address">
          <AddressInput value={f.session} onChange={(x) => setF({ ...f, session: x })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cap (USDT)">
            <Input inputMode="decimal" value={f.cap} onChange={(e) => setF({ ...f, cap: e.target.value })} />
          </Field>
          <Field label="Valid for (hours)">
            <Input inputMode="numeric" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />
          </Field>
        </div>
        <Tags loosen />
        <Button variant="green" className="w-full" disabled={busy || !isAddress(f.session) || !(Number(f.cap) > 0) || !(Number(f.hours) > 0)} onClick={() => run(m.submit(encode.addSession(getAddress(f.session), BigInt(Math.floor(now + Number(f.hours) * 3600)), parseUnits6(f.cap)), "Add agent"))}>
          <Spin on={m.busy === "Add agent"} icon={<Globe />} /> Add agent
        </Button>
      </Sheet>

      <Sheet open={open("allow-merchant")} onOpenChange={onOpenChange} title="Allow a merchant" icon={<Store />} hue="gold" description="Your agent can only pay merchants on this list. Removing one needs only your key.">
        {(v?.merchants ?? []).filter((x) => x.allowed).length > 0 && (
          <div className="space-y-2">
            {(v?.merchants ?? [])
              .filter((x) => x.allowed)
              .map((x) => (
                <div key={x.address} className="flex items-center gap-3 rounded-[16px] bg-surface px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold text-ink">{merchantLabel(props.merchantNames, x.address)}</div>
                    <div className="font-mono text-[12px] text-addr">
                      {short(x.address)} · today {money(x.spentToday)} / {money(x.dailyCap)} · max {money(x.maxChannel)}
                    </div>
                  </div>
                  <Button variant="destructive" size="sm" disabled={busy} onClick={() => run(m.submit(encode.removeMerchant(getAddress(x.address)), `Remove merchant ${short(x.address)}`))}>
                    <Trash2 /> Remove
                  </Button>
                </div>
              ))}
          </div>
        )}
        <Field label="Merchant address">
          <AddressInput value={f.merchant} onChange={(x) => setF({ ...f, merchant: x })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Daily cap (USDT)">
            <Input inputMode="decimal" value={f.daily} onChange={(e) => setF({ ...f, daily: e.target.value })} />
          </Field>
          <Field label="Max per channel">
            <Input inputMode="decimal" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
          </Field>
        </div>
        <Tags loosen />
        <Button variant="gold" className="w-full" disabled={busy || !isAddress(f.merchant)} onClick={() => run(m.submit(encode.setMerchant(getAddress(f.merchant), parseUnits6(f.daily), parseUnits6(f.max)), "Set merchant limits"))}>
          <Spin on={m.busy === "Set merchant limits"} icon={null} /> Save merchant
        </Button>
      </Sheet>

      <Sheet open={open("set-cap")} onOpenChange={onOpenChange} title="Set cap" icon={<SlidersHorizontal />} hue="gold" description="Lowering a cap needs only your key. Raising it needs World ID too.">
        {!picked ? (
          <div className="rounded-[16px] bg-surface p-4 text-[14px] text-body">No active agent. Add one first.</div>
        ) : (
          <>
            <AgentPicker agents={live} value={picked.address} onChange={setAgent} names={props.agentName} />
            <div className="flex items-center justify-between rounded-[16px] bg-amber-bg px-4 py-3.5">
              <span className="text-[15px] text-body">Current cap</span>
              <span className="text-[15px] text-ink">
                <b className="num text-[20px] font-semibold tracking-[-0.02em]">{money(picked.cap)}</b> USDT
              </span>
            </div>
            <Field label="New cap (USDT)">
              <Input inputMode="decimal" placeholder={money(picked.cap)} value={f.newCap} onChange={(e) => setF({ ...f, newCap: e.target.value })} />
            </Field>
            <Tags loosen={Number(f.newCap) * 1e6 > Number(picked.cap)} />
            <Button variant="gold" className="w-full" disabled={busy || !(Number(f.newCap) > 0)} onClick={() => run(m.submit(encode.setSessionLimits(getAddress(picked.address), BigInt(picked.expiry), parseUnits6(f.newCap)), `Set cap to ${f.newCap} USDT`))}>
              <Spin on={busy} icon={null} /> Set cap
            </Button>
          </>
        )}
      </Sheet>

      <Sheet open={open("withdraw")} onOpenChange={onOpenChange} title="Withdraw USDT" icon={<Upload />} hue="blue">
        <div className="flex items-center justify-between rounded-[16px] bg-blue-bg px-4 py-3.5">
          <span className="text-[15px] text-body">Free to spend</span>
          <span className="text-[18px] text-body">
            <b className="num text-[20px] font-semibold tracking-[-0.02em] text-ink">{money(v?.free)}</b> USDT
          </span>
        </div>
        <Field label="Send to">
          <AddressInput value={f.withdrawTo} onChange={(x) => setF({ ...f, withdrawTo: x })} />
        </Field>
        <Field label="Amount (USDT)">
          <div className="relative">
            <Input className="pr-12" inputMode="decimal" value={f.withdrawAmt} onChange={(e) => setF({ ...f, withdrawAmt: e.target.value })} />
            <button type="button" aria-label="Use everything free" className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-ink hover:text-ink" onClick={() => setF({ ...f, withdrawAmt: String(Number(v?.free ?? 0) / 1e6) })}>
              <Wallet className="size-5" />
            </button>
          </div>
        </Field>
        <div className="flex gap-3 rounded-[16px] bg-surface p-3.5 text-[14px] leading-5 text-body">
          <Clock className="mt-0.5 size-[18px] shrink-0 text-muted-ink" />
          <span>Withdrawals need World ID; large ones also wait a few minutes for safety.</span>
        </div>
        <Button variant="green" className="w-full" disabled={busy || !isAddress(f.withdrawTo) || !(Number(f.withdrawAmt) > 0)} onClick={() => run(m.submit(encode.withdraw(getAddress(f.withdrawTo), parseUnits6(f.withdrawAmt)), `Withdraw ${f.withdrawAmt} USDT`))}>
          <Spin on={busy} icon={<Globe />} /> Withdraw
        </Button>
      </Sheet>

      <Sheet open={open("renew")} onOpenChange={onOpenChange} title="Renew agent" icon={<RefreshCw />} hue="green" description="Gives an agent another 24 hours. A tiny cap is lifted to 2 USDT so it can open a payment.">
        {live.length === 0 && <div className="rounded-[16px] bg-surface p-4 text-[14px] text-body">No agents to renew.</div>}
        {live.map((s) => {
          const cap = renewCap(BigInt(s.cap));
          const expired = Number(s.expiry) <= now;
          return (
            <div key={s.address} className="space-y-3 rounded-[16px] bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold text-ink">{props.agentName(s.address)}</span>
                <Pill tone={expired ? "bad" : "ok"}>{expired ? "Expired" : "Active"}</Pill>
              </div>
              <div className="text-[13px] text-body">
                {expired ? "Expired" : "Expires"} {dateTime(Number(s.expiry))} · cap {money(s.cap)} USDT
              </div>
              <Button variant="green" className="w-full" disabled={busy} onClick={() => run(m.submit(encode.setSessionLimits(getAddress(s.address), BigInt(Math.floor(now + 24 * 3600)), cap), "Renew agent for 24 hours"))}>
                <Spin on={busy} icon={<Globe />} /> Renew 24 h · cap {money(cap)} USDT
              </Button>
            </div>
          );
        })}
        <Tags loosen />
      </Sheet>

      <Sheet open={open("freeze")} onOpenChange={onOpenChange} title="Freeze all" icon={<Snowflake />} hue="red" description="Stops every payment instantly. Only needs your key; no World ID.">
        <div className="flex items-center justify-between rounded-[16px] bg-red-bg px-4 py-3.5">
          <span className="text-[15px] text-body">Agents that can pay now</span>
          <b className="num text-[20px] font-semibold text-red">{live.filter((s) => Number(s.expiry) > now).length}</b>
        </div>
        <Tags loosen={false} />
        <Button
          variant="red"
          className="w-full"
          disabled={busy || live.length === 0}
          onClick={() => {
            const ops = live.map((s) => encode.revokeSession(getAddress(s.address)));
            if (ops.length) void run(m.submit(ops.length === 1 ? ops[0] : encode.batch(ops), `Freeze all (${ops.length})`));
          }}
        >
          <Spin on={busy} icon={<Snowflake />} /> Freeze all agents
        </Button>
      </Sheet>

      <Sheet open={open("revoke")} onOpenChange={onOpenChange} title="Revoke an agent" icon={<Ban />} hue="red" description="A revoked agent can never pay again. Only needs your key.">
        {live.length === 0 && <div className="rounded-[16px] bg-surface p-4 text-[14px] text-body">No agents to revoke.</div>}
        {live.map((s) => (
          <div key={s.address} className="flex items-center gap-3 rounded-[16px] bg-surface px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-ink">{props.agentName(s.address)}</div>
              <div className="font-mono text-[12px] text-addr">{short(s.address)}</div>
            </div>
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => run(m.submit(encode.revokeSession(getAddress(s.address)), `Revoke agent ${short(s.address)}`))}>
              <Ban /> Revoke
            </Button>
          </div>
        ))}
        <Tags loosen={false} />
      </Sheet>

      <Sheet open={open("demo")} onOpenChange={onOpenChange} title="Demo run" icon={<Play />} hue="blue" description="Our demo agent has a session key in your vault. It never holds gas, and it can only do what your limits allow.">
        <DemoPanel vault={vault} balance={v?.balance} hasDemoAgent={props.demo.hasDemoAgent} demoState={props.demo.demoState} onChange={m.refresh} goRequests={() => (close(), props.demo.goRequests())} />
      </Sheet>
    </>
  );
}
