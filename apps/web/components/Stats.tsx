"use client";
import { ArrowUpRight, Fuel, Gauge, Globe2 } from "lucide-react";
import { usePoll } from "@/lib/client/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill } from "./leash/kit";

type Stats = {
  live: {
    vouchersServed: number;
    claimTxs: number;
    channelsOpened: number;
    pqOwnerActions: number;
    claimCalldataBytes: number;
    paidToMerchantsAtomic: string;
    txReductionFactor: number | null;
    signatureBytes: { leash: number; pqPerPaymentMlDsa44: number; pqPerPaymentEthFalcon: number; reductionVsMlDsa44: number | null; reductionVsEthFalcon: number | null };
  };
  projection: {
    workload: { agents: number; requestsPerDay: number; claimsPerDay: number; ownerActionsPerDay: number };
    mlDsaBaseline: { pqPerPaymentBytes: number; leashBytes: number; factor: number };
    falconBaseline: { pqPerPaymentBytes: number; leashBytes: number; factor: number };
  };
};
type Tank = { address: string; balance: string; paused: boolean; pauseReason?: string; opsToday: number; spentTodayWei: string; estOpsRemaining: number | null; opsByLabel: Record<string, { count: number }> };

export const bytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} kB` : `${n} B`);

/** White card header: 44px blue-tile bubble, 18px title, 14px description (Figma "Card header"). */
export function CardHead({ icon: Icon, title, description, action }: { icon: typeof Gauge; title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex gap-3.5">
      <div className="grid size-11 shrink-0 place-items-center rounded-full bg-blue-tile text-blue">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-[18px] font-semibold leading-6 tracking-[-0.015em] text-[#1f2230]">{title}</div>
        {description && <div className="text-[14px] leading-5 text-[#4a4f5e]">{description}</div>}
      </div>
      {action}
    </div>
  );
}

/** Labelled comparison bar (Figma "Bar compare"). */
export function BarRow({ label, value, share, strong }: { label: string; value: string; share: number; strong?: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-[13px] leading-[18px] text-body">{label}</div>
        <div className={`num text-[16px] font-semibold leading-[22px] tracking-[-0.01em] ${strong ? "text-blue" : "text-ink"}`}>{value}</div>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-[5px] bg-[#eef0f5]">
        <div className={`h-full min-w-2.5 rounded-[5px] ${strong ? "bg-blue" : "bg-[#b8becc]"}`} style={{ width: `${Math.max(0, Math.min(100, share * 100))}%` }} />
      </div>
    </div>
  );
}

/** Small stat tile in dark cards. */
export function DarkStat({ value, label }: { value: React.ReactNode; label: React.ReactNode }) {
  return (
    <div className="min-w-0 flex-1 space-y-[3px] rounded-[16px] bg-[#2e2e2e] p-3.5">
      <div className="num text-[20px] font-semibold leading-[26px] tracking-[-0.015em] text-white">{value}</div>
      <div className="text-[12px] leading-4 text-white/60">{label}</div>
    </div>
  );
}

function LightStat({ value, label }: { value: React.ReactNode; label: React.ReactNode }) {
  return (
    <div className="min-w-0 flex-1 space-y-[3px] rounded-[16px] bg-surface p-3.5">
      <div className="num text-[20px] font-semibold leading-[26px] tracking-[-0.015em] text-ink">{value}</div>
      <div className="text-[12px] leading-4 text-body">{label}</div>
    </div>
  );
}

export function Stats() {
  const s = usePoll<Stats>("/api/facilitator/stats", 4000).data;
  const t = usePoll<Tank>("/api/facilitator/gas-tank", 6000).data;
  if (!s) return <Skeleton className="h-[319px] rounded-[32px]" />;
  const l = s.live;
  const p = s.projection;
  const sb = l.signatureBytes;
  return (
    <div className="space-y-3.5">
      {/* Glow card: paid requests, settled live */}
      <div className="glow-card px-6 pb-6 pt-9">
        <div className="text-center text-[14px] leading-[19px] text-white">Paid requests, settled live</div>
        <div className="num mt-3 text-center text-[78px] font-bold leading-[78px] tracking-[-0.05em] text-white">{l.vouchersServed.toLocaleString()}</div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="glow-tile space-y-1 p-3.5">
            <div className="num text-[32px] font-semibold leading-8 tracking-[-0.035em] text-[#1f2230]">{l.claimTxs.toLocaleString()}</div>
            <div className="text-[12px] leading-[17px] text-[#4a4f5e]">settlement txs</div>
          </div>
          <div className="glow-tile space-y-1 p-3.5">
            <div className="num text-[32px] font-semibold leading-8 tracking-[-0.035em] text-[#1f2230]">{l.txReductionFactor ? `${l.txReductionFactor.toFixed(0)}×` : "–"}</div>
            <div className="text-[12px] leading-[17px] text-[#4a4f5e]">fewer transactions</div>
          </div>
        </div>
        <div className="mt-3.5 flex items-center justify-between gap-2">
          <span className="rounded-[10px] bg-blue-tile px-2.5 py-1.5 font-mono text-[13px] leading-[18px] text-[#1f2230]">Whitechain</span>
          <a href="/api/facilitator/claims?limit=100" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[14px] leading-[19px] text-white hover:underline">
            Counted from settlements <ArrowUpRight className="size-4" />
          </a>
        </div>
      </div>

      {/* Signature data */}
      <div className="surface space-y-3.5 p-5">
        <CardHead icon={Gauge} title="Signature data" description="How much post-quantum signature data your payments needed." />
        <div className="space-y-3">
          <BarRow label="With Leash" value={bytes(sb.leash)} share={sb.pqPerPaymentEthFalcon ? sb.leash / sb.pqPerPaymentEthFalcon : 0} strong />
          <BarRow label="If every payment carried a Falcon signature" value={bytes(sb.pqPerPaymentEthFalcon)} share={1} />
        </div>
        <p className="text-[13px] leading-[18px] text-ink">
          That&apos;s <b className="font-semibold">{sb.reductionVsEthFalcon?.toFixed(0) ?? "–"}× more</b> without Leash. vs ML-DSA-44 per payment: {sb.reductionVsMlDsa44?.toFixed(0) ?? "–"}× · settlement calldata {bytes(l.claimCalldataBytes)}
        </p>
      </div>

      {/* At scale: dark card */}
      <div className="dark-card space-y-3.5 p-6">
        <div className="flex gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-full bg-[#333333] text-white">
            <Globe2 className="size-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="text-[16px] font-semibold leading-[22px] tracking-[-0.01em]">At scale</div>
            <div className="text-[14px] leading-5 text-white/70">{p.workload.agents.toLocaleString()} agents, each paying once a minute.</div>
          </div>
        </div>
        <div className="space-y-0.5 py-2 text-center">
          <div className="num text-[64px] font-bold leading-[66px] tracking-[-0.05em]">{p.falconBaseline.factor.toFixed(0)}×</div>
          <div className="text-[14px] leading-5 text-white/70">less signature data</div>
        </div>
        <div className="flex gap-2.5">
          <DarkStat value={bytes(p.falconBaseline.pqPerPaymentBytes)} label="per day if every payment is post-quantum signed" />
          <DarkStat value={bytes(p.falconBaseline.leashBytes)} label="per day with Leash" />
        </div>
        <div className="text-center text-[12px] leading-4 text-white/55">
          Against ML-DSA-44: {bytes(p.mlDsaBaseline.pqPerPaymentBytes)} vs {bytes(p.mlDsaBaseline.leashBytes)} → {p.mlDsaBaseline.factor.toFixed(0)}×
        </div>
      </div>

      {/* Gas */}
      {t && (
        <div className="surface space-y-3.5 p-5">
          <CardHead
            icon={Fuel}
            title="Who pays the gas"
            description="Our relayer pays it and earns 0.001 USDT per settlement. Every transaction is simulated first, so failing ones are never sent."
            action={t.paused ? <Pill tone="bad">Paused</Pill> : <Pill tone="ok">Active</Pill>}
          />
          <div className="flex gap-2.5">
            <LightStat value={Number(t.balance).toFixed(3)} label="WBT in tank" />
            <LightStat value={t.estOpsRemaining?.toLocaleString() ?? "–"} label="ops left" />
            <LightStat value={t.opsToday} label="ops today" />
          </div>
        </div>
      )}
    </div>
  );
}
