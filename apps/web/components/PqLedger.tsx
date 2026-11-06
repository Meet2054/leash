"use client";
import { explorerTx, short, usePoll } from "@/lib/client/api";

type Entry = {
  kind: string;
  action: string;
  vault: string;
  tx: string;
  timestamp: number;
  gasUsed: string;
  pqVerifyGas: string;
  pqShare: number;
  pubKeyBytes: number;
  sigBytes: number;
  calldataBytes: number;
  loosening?: boolean;
};
type Ledger = {
  entries: Entry[];
  summary: {
    pqVerifiedTxs: number;
    avgPqVerifyGas: number;
    paymentsSettled: number;
    ifEveryPaymentWerePqVerified: { extraGas: number; extraSignatureBytes: number };
    leashActual: { pqTxs: number; pqGas: number; pqSignatureBytes: number };
  };
};

const fmt = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);

/** F1: every onchain post-quantum (ETHFALCON) signature verification, with measured verify gas. */
export function PqLedger() {
  const { data, error } = usePoll<Ledger>("/api/facilitator/pq-ledger", 10000);
  if (error) return <div className="card text-sm text-[var(--color-bad)]">{error}</div>;
  if (!data) return <div className="card muted">Scanning the chain for post-quantum verifications…</div>;
  const s = data.summary;
  return (
    <div className="space-y-4">
      <section className="card space-y-2">
        <h2 className="font-semibold">Post-quantum, verified onchain</h2>
        <p className="text-sm muted">
          Every transaction below carried a Falcon-512 signature (ETHFALCON: 1,064 B signature, 1,024 B public key) that the vault verified in the EVM. The verify cost is measured by re-running the exact signature through the verifier.
        </p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div><div className="text-xl font-bold">{s.pqVerifiedTxs}</div><div className="text-xs muted">PQ-verified txs</div></div>
          <div><div className="text-xl font-bold">{fmt(s.avgPqVerifyGas)}</div><div className="text-xs muted">gas per Falcon verify</div></div>
          <div><div className="text-xl font-bold">{s.paymentsSettled}</div><div className="text-xs muted">payments with no PQ cost</div></div>
        </div>
        <div className="soft rounded-lg p-2 text-sm">
          If each of the {s.paymentsSettled} payments had carried a Falcon signature: <b>{fmt(s.ifEveryPaymentWerePqVerified.extraGas)} gas</b> and {fmt(s.ifEveryPaymentWerePqVerified.extraSignatureBytes)} B of signatures. Leash paid for{" "}
          <b>{s.leashActual.pqTxs}</b> PQ checks: {fmt(s.leashActual.pqGas)} gas, {fmt(s.leashActual.pqSignatureBytes)} B.
        </div>
      </section>
      <section className="card space-y-2">
        {data.entries
          .slice()
          .reverse()
          .map((e) => (
            <div key={e.tx} className="border-b line pb-2 text-sm">
              <div className="flex justify-between gap-2">
                <div>
                  <b>{e.action}</b> {e.loosening === true && <span className="pill" style={{ color: "var(--color-warn)" }}>loosening · World-gated</span>}
                  {e.loosening === false && <span className="pill">tightening</span>}
                  {e.kind === "createVault" && <span className="pill">vault created</span>}
                </div>
                <a className="underline shrink-0" href={explorerTx(e.tx)} target="_blank" rel="noreferrer">tx</a>
              </div>
              <div className="h-2 rounded bg-[var(--line)] overflow-hidden mt-1">
                <div className="h-2 bg-[var(--color-brand)]" style={{ width: `${Math.round(e.pqShare * 100)}%` }} />
              </div>
              <div className="text-xs muted mt-1">
                Falcon verify {fmt(Number(e.pqVerifyGas))} of {fmt(Number(e.gasUsed))} gas ({Math.round(e.pqShare * 100)}%) · sig {e.sigBytes} B · key {e.pubKeyBytes} B · vault <span className="mono">{short(e.vault)}</span> · {new Date(e.timestamp * 1000).toLocaleString()}
              </div>
            </div>
          ))}
      </section>
    </div>
  );
}
