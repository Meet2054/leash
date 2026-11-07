"use client";
/**
 * Home (Figma 12:8674): blue glow card with the vault balance, "Needs you" alert cards, the agent card(s),
 * allowed merchants, the emergency brake and recent activity. Quick actions open the sheets in home/HomeSheets.
 */
import { useEffect, useState } from "react";
import { getAddress } from "viem";
import { ArrowUpRight, Bot, CheckCircle2, ChevronRight, Clock, ExternalLink, Globe, Loader2, PlusCircle, ShieldAlert, Snowflake, Store, TrendingUp, Upload, Wallet, Zap } from "lucide-react";
import { toast } from "sonner";
import { encode } from "@leash/sdk";
import type { Config } from "@/app/page";
import type { OwnerSigner } from "@/lib/client/signer";
import { api, explorerAddr, explorerTx, friendlyPolicy, money, short, usePoll } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCard, Copyable, DarkCard, GlowCard, IconBubble, Meter, Pill, SectionTitle, Sheet, type Hue } from "@/components/leash/kit";
import { useShell } from "@/components/leash/shell";
import { ApprovalRunner } from "@/components/ApprovalRunner";
import { renewCap, useMandate, type Session } from "@/components/Mandate";
import { HomeSheets, type SheetAction } from "@/components/home/HomeSheets";
import { AddFunds } from "@/components/home/AddFunds";
import { clock, dateTime, dayTime, merchantLabel, merchantNames, until, type Resource } from "@/components/home/format";

type Approval = { id: string; source: "agent" | "owner"; session: string | null; description: string; reason: string; status: string; statusReason: string | null; createdAt: number; txHash: string | null };
type Event = { id: number; at: number; kind: string; amount: string | null; tx: string | null };

const SHEETS: SheetAction[] = ["add-agent", "allow-merchant", "set-cap", "withdraw", "renew", "freeze", "revoke", "demo"];

/** Title + meta for a pending request, read from the server's op description. */
function describe(a: Approval, sessions: Session[]): { title: string; until?: number } {
  const set = a.description.match(/^Set session (0x[0-9a-fA-F]+): cap ([\d.]+) USDT, expires (.*)/);
  if (set) {
    const cur = sessions.find((s) => s.address.toLowerCase() === set[1].toLowerCase());
    const cap = Number(set[2]);
    const raise = !cur || cap * 1e6 > Number(cur.cap);
    return { title: `${raise ? "Raise" : "Set"} cap to ${set[2]} USDT`, until: Math.floor(new Date(set[3]).getTime() / 1000) };
  }
  if (/^Add session/.test(a.description)) return { title: `Add an agent${a.description.match(/cap ([\d.]+ USDT)/) ? ` · ${a.description.match(/cap ([\d.]+ USDT)/)![1]}` : ""}` };
  const w = a.description.match(/^Withdraw ([\d.]+ USDT)/);
  if (w) return { title: `Withdraw ${w[1]}` };
  if (/^Allow merchant/.test(a.description)) return { title: "Allow a merchant" };
  if (/^Batch/i.test(a.description)) return { title: "Change several limits" };
  return { title: a.description.length > 60 ? `${a.description.slice(0, 57)}…` : a.description };
}

const EVENT: Record<string, { label: string; hue: Hue; icon: typeof Bot }> = {
  ChannelOpened: { label: "Payment channel opened", hue: "blue", icon: PlusCircle },
  Claimed: { label: "Merchant paid (batched)", hue: "blue", icon: ArrowUpRight },
  ChannelClosed: { label: "Channel closed", hue: "blue", icon: ExternalLink },
  MandateChanged: { label: "Limits changed", hue: "gold", icon: TrendingUp },
  VaultCreated: { label: "Vault created", hue: "blue", icon: Wallet },
  ApprovalRequested: { label: "Agent asked for more", hue: "gold", icon: TrendingUp },
  ApprovalGranted: { label: "World ID approved", hue: "green", icon: Globe },
  ApprovalDenied: { label: "Request denied", hue: "red", icon: ShieldAlert },
  ApprovalExpired: { label: "Request expired", hue: "grey", icon: Clock },
  LooseningBlocked: { label: "Blocked by safety policy", hue: "red", icon: ShieldAlert },
  LooseningCooldown: { label: "Safety wait started", hue: "gold", icon: Clock },
  LooseningCancelled: { label: "Loosening cancelled", hue: "grey", icon: Clock },
  CircuitTripped: { label: "Spending stopped automatically", hue: "red", icon: Zap },
  DemoFaucet: { label: "Test USDT received", hue: "green", icon: Upload },
};

export function HomeScreen({ vault, cfg, signer }: { vault: string; cfg: Config; signer: OwnerSigner | null }) {
  const { action, startAction, setTab } = useShell();
  const m = useMandate(vault, cfg.chainId, signer);
  const { v, breaker, busy } = m;
  const approvalsQ = usePoll<Approval[]>(`/api/approvals?vault=${vault}`, 3000);
  const services = usePoll<{ items: Resource[] }>(`/api/facilitator/discovery/resources`, 60_000).data;
  const events = usePoll<Event[]>(`/api/facilitator/events?vault=${vault}&limit=12`, 6000).data;
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [addFunds, setAddFunds] = useState(false);
  const [preAgent, setPreAgent] = useState<string>();
  const [, tick] = useState(0);

  useEffect(() => {
    try {
      setDismissed(JSON.parse(localStorage.getItem(`leash.dismissed.${vault}`) ?? "[]"));
    } catch {
      /* storage unavailable */
    }
    const t = setInterval(() => tick((x) => x + 1), 30_000); // keeps "expires in" fresh
    return () => clearInterval(t);
  }, [vault]);
  const dismiss = (ids: string[]) => {
    const next = [...new Set([...dismissed, ...ids])];
    setDismissed(next);
    try {
      localStorage.setItem(`leash.dismissed.${vault}`, JSON.stringify(next.slice(-200)));
    } catch {
      /* ignore */
    }
  };

  const sheet = action && (SHEETS as string[]).includes(action) ? (action as SheetAction) : null;
  const closeSheet = () => (startAction(null), setPreAgent(undefined));
  const names = merchantNames(services?.items);
  const agentName = (a: string) => (cfg.demoAgent && a.toLowerCase() === cfg.demoAgent.toLowerCase() ? "Leash demo agent" : "Agent");

  if (!v)
    return (
      <div className="space-y-4">
        <Skeleton className="h-[364px] rounded-[32px]" />
        <Skeleton className="h-44 rounded-[24px]" />
      </div>
    );

  if (!v.deployed)
    return (
      <div className="space-y-4">
        <GlowCard label="Waiting for your deposit" value={money(v.balance)} unit="USDT" footer={<Copyable value={vault} light />} />
        <div className="surface space-y-1 p-[18px] text-[15px] leading-[22px] text-body">
          <div className="text-[16px] font-semibold text-ink">Vault not created yet</div>
          Finish setup to create it: Settings → Re-run setup.
        </div>
      </div>
    );

  const now = Date.now() / 1000;
  const sessions = v.sessions ?? [];
  const live = sessions.filter((s) => !s.revoked);
  const approvals = approvalsQ.data ?? [];
  const pending = approvals.filter((a) => (a.status === "PENDING" || a.status === "APPROVING") && !dismissed.includes(a.id));
  const blocked = approvals.filter((a) => a.status === "DENIED" && a.statusReason?.startsWith("attestor policy") && a.createdAt > now - 86_400 && !dismissed.includes(a.id));
  const alerts = pending.length + (blocked.length ? 1 : 0) + (breaker?.state === "open" ? 1 : 0);
  const demo = cfg.demoAgent ? sessions.find((s) => s.address.toLowerCase() === cfg.demoAgent!.toLowerCase()) : undefined;
  const demoState = !demo ? "missing" : demo.revoked ? "revoked" : Number(demo.expiry) <= now ? "expired" : "active";
  const allowed = (v.merchants ?? []).filter((x) => x.allowed);
  const ordered = [...sessions].sort((a, b) => Number(a.revoked) - Number(b.revoked) || Number(Number(b.expiry) > now) - Number(Number(a.expiry) > now));

  const deny = async (id: string) => {
    try {
      await api(`/api/approvals/${id}/deny`, {});
      toast("Denied. Nothing changed, and the agent stays capped.");
      approvalsQ.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const freezeAll = () => {
    const ops = live.map((s) => encode.revokeSession(getAddress(s.address)));
    if (ops.length) void m.submit(ops.length === 1 ? ops[0] : encode.batch(ops), `Freeze all (${ops.length})`);
  };

  return (
    <div className="space-y-4">
      <GlowCard
        label="In your vault"
        value={money(v.balance)}
        unit="USDT"
        tiles={[
          { value: money(v.free), label: "Free to spend" },
          { value: money(v.locked), label: "Reserved for open payments" },
        ]}
        action={
          <button type="button" onClick={() => setAddFunds(true)} className="flex h-12 w-full items-center justify-center gap-2 rounded-[16px] bg-white text-[16px] font-semibold tracking-[-0.01em] text-blue shadow-[0_4px_14px_rgb(5_26_115/0.18)] transition-transform hover:bg-blue-tile active:scale-[0.99]">
            <PlusCircle className="size-5" /> Add USDT
          </button>
        }
        footer={
          <>
            <Copyable value={vault} light />
            <a className="inline-flex items-center gap-1 text-[14px] text-white hover:underline" href={explorerAddr(vault)} target="_blank" rel="noreferrer">
              View on explorer <ArrowUpRight className="size-4" />
            </a>
          </>
        }
      />

      <AddFunds open={addFunds} onOpenChange={setAddFunds} vault={vault} chainId={cfg.chainId} onAdded={() => setTimeout(m.refresh, 2500)} />

      <SectionTitle badge={alerts > 0 ? <Pill tone="bad">{alerts}</Pill> : undefined}>Needs you</SectionTitle>
      {breaker?.state === "open" && (
        <AlertCard
          hue="red"
          icon={<Zap />}
          title="Spending stopped automatically"
          body={`${breaker.detail ?? "Unusual spending"}. All payments from this vault are paused${breaker.reopensAt ? ` until ${new Date(breaker.reopensAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}.`}
          actions={
            <Button
              variant="red"
              disabled={!!busy}
              onClick={() => {
                const s = (breaker.sessionsSeen ?? []).filter((x) => sessions.some((y) => y.address.toLowerCase() === x.toLowerCase() && !y.revoked));
                const ops = s.map((x) => encode.revokeSession(getAddress(x)));
                if (ops.length) void m.submit(ops.length === 1 ? ops[0] : encode.batch(ops), `Freeze ${ops.length} agent(s)`);
              }}
            >
              <Snowflake /> Freeze the agents involved
            </Button>
          }
        />
      )}
      {pending.map((a, i) => {
        const d = describe(a, sessions);
        return (
          <AlertCard
            key={a.id}
            stacked={i < pending.length - 1 || blocked.length > 0}
            hue="gold"
            icon={<TrendingUp />}
            title={d.title}
            body={a.source === "agent" ? <>Your agent: &ldquo;{a.reason}&rdquo;</> : "Your own change. Confirm it with World ID."}
            metaIcon={<Clock />}
            meta={a.status === "APPROVING" ? "World check in progress" : d.until ? (d.until > now ? `Expires in ${until(d.until)}` : `Until ${dayTime(d.until)}`) : `Asked ${clock(a.createdAt)}`}
            onDismiss={() => dismiss([a.id])}
            actions={
              <>
                <Button variant="secondary" onClick={() => deny(a.id)}>
                  Deny
                </Button>
                <Button variant="green" onClick={() => setTab("requests")}>
                  <Globe /> Approve
                </Button>
              </>
            }
          />
        );
      })}
      {blocked.length > 0 && (
        <AlertCard
          hue="red"
          icon={<ShieldAlert />}
          title="Blocked: possible prompt injection"
          body={((t) => (/nothing was signed/i.test(t) ? t : `${t} Nothing was signed.`))(friendlyPolicy(blocked[0].statusReason ?? ""))}
          metaIcon={<Clock />}
          meta={`${blocked.length} attempt${blocked.length > 1 ? "s" : ""} · ${blocked
            .slice(0, 3)
            .map((b) => clock(b.createdAt))
            .reverse()
            .join(", ")}`}
          onDismiss={() => dismiss(blocked.map((b) => b.id))}
        />
      )}
      {alerts === 0 && (
        <div className="surface flex items-center gap-3 p-[18px]">
          <IconBubble hue="green">
            <CheckCircle2 />
          </IconBubble>
          <div className="min-w-0">
            <div className="text-[16px] font-semibold leading-[22px] text-ink">All clear</div>
            <div className="text-[13px] leading-[18px] text-addr">Nothing needs you. Your agents are inside their limits.</div>
          </div>
        </div>
      )}

      <SectionTitle>Your agent</SectionTitle>
      {ordered.length === 0 && (
        <div className="surface space-y-3 p-[18px]">
          <div className="text-[15px] text-body">No agents yet. Give an agent its own key and limits.</div>
          <Button variant="gold" className="w-full" onClick={() => startAction("add-agent")}>
            Add agent
          </Button>
        </div>
      )}
      {ordered.map((s) => {
        const active = !s.revoked && Number(s.expiry) > now;
        const expired = !s.revoked && !active;
        const used = BigInt(s.spent) + BigInt(s.locked);
        return (
          <div key={s.address} className={`surface space-y-3.5 p-[18px] ${s.revoked ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-3">
              <IconBubble hue="grey">
                <Bot />
              </IconBubble>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[16px] font-semibold leading-[22px] tracking-[-0.01em] text-ink">{agentName(s.address)}</div>
                <div className="font-mono text-[13px] leading-[18px] text-addr">{short(s.address)}</div>
              </div>
              <Pill tone={active ? "ok" : s.revoked ? "neutral" : "bad"}>{s.revoked ? "Frozen" : active ? "Active" : "Expired"}</Pill>
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2 text-[13px] leading-[18px]">
                <span className="text-body">Cap used</span>
                <span className="num text-ink">
                  {money(used)} / {money(s.cap)} USDT
                </span>
              </div>
              <Meter value={used} max={BigInt(s.cap)} hue="gold" />
              <div className="text-[12px] leading-4 text-addr">
                {s.revoked ? "Frozen: it can never pay again" : `${active ? "Expires" : "Expired"} ${dateTime(Number(s.expiry))}`}
              </div>
            </div>
            {!s.revoked && (
              <div className="flex gap-2.5 [&>*]:flex-1">
                {expired ? (
                  <Button variant="green" disabled={!!busy} onClick={() => void m.submit(encode.setSessionLimits(getAddress(s.address), BigInt(Math.floor(now + 24 * 3600)), renewCap(BigInt(s.cap))), "Renew agent for 24 hours")}>
                    {busy === "Renew agent for 24 hours" ? <Loader2 className="animate-spin" /> : <Globe />} Renew 24 h
                  </Button>
                ) : (
                  <Button variant="destructive" disabled={!!busy} onClick={() => void m.submit(encode.revokeSession(getAddress(s.address)), `Revoke agent ${short(s.address)}`)}>
                    Revoke
                  </Button>
                )}
                <Button variant="secondary" disabled={!!busy} onClick={() => (setPreAgent(s.address), startAction("set-cap"))}>
                  Set cap
                </Button>
              </div>
            )}
          </div>
        );
      })}

      <button type="button" onClick={() => startAction("allow-merchant")} className="surface flex w-full items-center gap-3 p-[18px] text-left">
        <IconBubble hue="gold">
          <Store />
        </IconBubble>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold leading-[22px] tracking-[-0.01em] text-ink">
            {allowed.length} merchant{allowed.length === 1 ? "" : "s"} allowed
          </div>
          <div className="truncate text-[13px] leading-[18px] text-addr">{allowed.map((x) => merchantLabel(names, x.address)).join(" · ") || "Your agent can't pay anyone yet"}</div>
        </div>
        <ChevronRight className="size-5 shrink-0 text-muted-ink" />
      </button>

      <DarkCard className="flex items-center gap-3.5 rounded-[24px] p-[18px]">
        <div className="grid size-11 shrink-0 place-items-center rounded-full bg-[#333] text-white">
          <Snowflake className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold leading-[22px] tracking-[-0.01em]">Freeze all agents</div>
          <div className="text-[13px] leading-[18px] text-white/65">Stops every payment instantly. Only needs your key.</div>
        </div>
        <Button variant="red" className="h-11 px-4" disabled={!!busy || live.length === 0} onClick={freezeAll}>
          {busy?.startsWith("Freeze all") ? <Loader2 className="animate-spin" /> : null} Freeze
        </Button>
      </DarkCard>

      {(events?.length ?? 0) > 0 && (
        <>
          <SectionTitle
            action={
              <button type="button" onClick={() => setTab("activity")} className="inline-flex items-center gap-1 py-3 text-[13px] text-blue">
                See all <ChevronRight className="size-3.5" />
              </button>
            }
          >
            Recent activity
          </SectionTitle>
          <div className="surface px-[18px] py-1.5">
            {events!.slice(0, 3).map((e, i) => {
              const k = EVENT[e.kind] ?? { label: e.kind, hue: "grey" as Hue, icon: Clock };
              const Icon = k.icon;
              const row = (
                <div className="flex items-center gap-3 py-3">
                  <IconBubble hue={k.hue} className="size-9 [&_svg]:size-4">
                    <Icon />
                  </IconBubble>
                  <div className="min-w-0 flex-1 truncate text-[14px] leading-5 tracking-[-0.005em] text-ink">
                    {k.label}
                    {e.amount && Number(e.amount) > 0 ? ` · ${money(e.amount)} USDT` : ""}
                  </div>
                  <div className="shrink-0 text-[12px] text-addr">{clock(e.at)}</div>
                </div>
              );
              return (
                <div key={e.id} className={i > 0 ? "border-t border-[#eef0f5]" : ""}>
                  {e.tx ? (
                    <a href={explorerTx(e.tx)} target="_blank" rel="noreferrer" className="block">
                      {row}
                    </a>
                  ) : (
                    row
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <HomeSheets
        action={sheet}
        close={closeSheet}
        m={m}
        vault={vault}
        agentName={agentName}
        merchantNames={names}
        preAgent={preAgent}
        demo={{ hasDemoAgent: Boolean(demo), demoState, goRequests: () => setTab("requests") }}
      />

      <Sheet open={!!m.pendingApproval} onOpenChange={(o) => !o && m.setPendingApproval(undefined)} title="Confirm with World ID" icon={<Globe />} hue="green" description="This loosens a limit, so it needs a fresh World ID check and your owner key. Nothing changes until both are done.">
        {m.pendingApproval && (
          <ApprovalRunner
            approvalId={m.pendingApproval}
            vault={vault}
            chainId={cfg.chainId}
            signer={signer}
            onDone={() => {
              m.refresh();
              approvalsQ.refresh();
            }}
          />
        )}
      </Sheet>

      {busy && (
        <div className="fixed inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom),18px)+80px)] z-40 mx-auto flex w-fit items-center gap-2 rounded-full bg-dark px-4 py-2 text-[13px] font-medium text-white shadow-[var(--shadow-fab)]">
          <Loader2 className="size-4 animate-spin" /> {busy}…
        </div>
      )}
    </div>
  );
}
