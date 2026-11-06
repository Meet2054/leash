"use client";
import { Fuel, Gauge, Globe2 } from "lucide-react";
import { usePoll } from "@/lib/client/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill, Section, Stat } from "./leash/kit";

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

const bytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} kB` : `${n} B`);

export function Stats() {
  const s = usePoll<Stats>("/api/facilitator/stats", 4000).data;
  const t = usePoll<Tank>("/api/facilitator/gas-tank", 6000).data;
  if (!s) return <Skeleton className="h-64 rounded-2xl" />;
  const l = s.live;
  const p = s.projection;
  return (
    <div className="space-y-3">
      <Section icon={<Gauge className="size-5" />} title="Live, from real payments" description="Counted from what actually settled on Whitechain.">
        <div className="grid grid-cols-3 gap-2">
          <Stat value={l.vouchersServed.toLocaleString()} label="paid requests" />
          <Stat value={l.claimTxs.toLocaleString()} label="settlement txs" />
          <Stat value={l.txReductionFactor ? `${l.txReductionFactor.toFixed(0)}×` : "–"} label="fewer txs" />
        </div>
        <div className="well space-y-1.5 p-3.5 text-[0.82rem] leading-relaxed">
          <div>
            Signature data with Leash: <span className="num font-semibold">{bytes(l.signatureBytes.leash)}</span>
          </div>
          <div>
            If every payment carried a Falcon signature: <span className="num font-semibold">{bytes(l.signatureBytes.pqPerPaymentEthFalcon)}</span>, that&apos;s <span className="font-semibold">{l.signatureBytes.reductionVsEthFalcon?.toFixed(0) ?? "–"}× more</span>
          </div>
          <div className="text-muted-foreground">vs ML-DSA-44 per payment: {l.signatureBytes.reductionVsMlDsa44?.toFixed(0) ?? "–"}× · settlement calldata {bytes(l.claimCalldataBytes)}</div>
        </div>
      </Section>

      <Section icon={<Globe2 className="size-5" />} title="At scale" description={`${p.workload.agents.toLocaleString()} agents, each paying once a minute.`}>
        <div className="grid grid-cols-2 gap-2">
          <Stat value={bytes(p.falconBaseline.pqPerPaymentBytes)} label="per day if every payment is post-quantum signed" />
          <Stat value={bytes(p.falconBaseline.leashBytes)} label="per day with Leash" />
        </div>
        <div className="rounded-2xl bg-primary px-4 py-4 text-center text-primary-foreground">
          <div className="num text-3xl font-semibold tracking-tight">{p.falconBaseline.factor.toFixed(0)}×</div>
          <div className="text-[0.78rem] opacity-70">less signature data</div>
        </div>
        <div className="text-center text-[0.72rem] text-muted-foreground">
          Against ML-DSA-44: {bytes(p.mlDsaBaseline.pqPerPaymentBytes)} vs {bytes(p.mlDsaBaseline.leashBytes)} → {p.mlDsaBaseline.factor.toFixed(0)}×
        </div>
      </Section>

      {t && (
        <Section icon={<Fuel className="size-5" />} title="Who pays the gas" description="Our relayer pays it and earns 0.001 USDT per settlement. Every transaction is simulated first, so failing ones are never sent." action={t.paused ? <Pill tone="bad">Paused</Pill> : <Pill tone="ok">Active</Pill>}>
          <div className="grid grid-cols-3 gap-2">
            <Stat value={Number(t.balance).toFixed(3)} label="WBT in tank" />
            <Stat value={t.estOpsRemaining?.toLocaleString() ?? "–"} label="ops left" />
            <Stat value={t.opsToday} label="ops today" />
          </div>
        </Section>
      )}
    </div>
  );
}
