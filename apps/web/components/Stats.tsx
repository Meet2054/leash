"use client";
import { usePoll } from "@/lib/client/api";

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
const Big = ({ v, l }: { v: string; l: string }) => (
  <div>
    <div className="text-2xl font-bold">{v}</div>
    <div className="text-xs muted">{l}</div>
  </div>
);

export function Stats() {
  const s = usePoll<Stats>("/api/facilitator/stats", 4000).data;
  const t = usePoll<Tank>("/api/facilitator/gas-tank", 6000).data;
  if (!s) return <div className="card muted">Loading…</div>;
  const l = s.live;
  const p = s.projection;
  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <h2 className="font-semibold">Live, from real counts</h2>
        <div className="grid grid-cols-3 gap-3 text-center">
          <Big v={String(l.vouchersServed)} l="paid requests" />
          <Big v={String(l.claimTxs)} l="claim txs" />
          <Big v={l.txReductionFactor ? `${l.txReductionFactor.toFixed(0)}×` : "–"} l="fewer txs" />
        </div>
        <div className="text-sm space-y-1">
          <div>Signature bytes, Leash (65 B per claim + Falcon per owner action): <b>{bytes(l.signatureBytes.leash)}</b></div>
          <div>If every payment were PQ-signed (ML-DSA-44, 2,420 B): <b>{bytes(l.signatureBytes.pqPerPaymentMlDsa44)}</b> → <b>{l.signatureBytes.reductionVsMlDsa44?.toFixed(0) ?? "–"}×</b> less</div>
          <div className="muted">vs ETHFALCON per payment (1,064 B): {l.signatureBytes.reductionVsEthFalcon?.toFixed(0) ?? "–"}× less · onchain claim calldata {bytes(l.claimCalldataBytes)}</div>
        </div>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">At scale ({p.workload.agents.toLocaleString()} agents × 1 paid request/min)</h2>
        <div className="grid grid-cols-2 gap-3 text-center">
          <Big v={bytes(p.mlDsaBaseline.pqPerPaymentBytes)} l="per day, PQ signature on every payment (ML-DSA-44)" />
          <Big v={bytes(p.mlDsaBaseline.leashBytes)} l="per day, Leash (hourly claims + 1 PQ owner action/agent)" />
        </div>
        <div className="text-center text-lg font-bold">{p.mlDsaBaseline.factor.toFixed(0)}× less signature data</div>
        <div className="text-xs muted text-center">Same math with a Falcon baseline on both sides: {bytes(p.falconBaseline.pqPerPaymentBytes)} vs {bytes(p.falconBaseline.leashBytes)} → {p.falconBaseline.factor.toFixed(0)}×</div>
      </section>

      {t && (
        <section className="card space-y-1 text-sm">
          <h2 className="font-semibold">Relayer gas tank</h2>
          <div>
            <span className="mono">{t.address}</span> {t.paused ? <span className="pill" style={{ color: "var(--color-bad)" }}>paused: {t.pauseReason}</span> : <span className="pill" style={{ color: "var(--color-ok)" }}>active</span>}
          </div>
          <div>{Number(t.balance).toFixed(4)} WBT · ~{t.estOpsRemaining ?? "–"} ops left · {t.opsToday} ops today</div>
          <div className="muted text-xs">{Object.entries(t.opsByLabel).map(([k, v]) => `${k} ${v.count}`).join(" · ")}</div>
          <p className="text-xs muted">The relayer pays WBT gas and earns a 0.001 USDT fee per claim from merchant revenue. Every tx is simulated first; reverting txs are never sent.</p>
        </section>
      )}
    </div>
  );
}
