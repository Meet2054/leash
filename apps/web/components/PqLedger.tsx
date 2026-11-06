"use client";
import { ArrowUpRight, Atom } from "lucide-react";
import { explorerTx, usePoll } from "@/lib/client/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Meter, Pill, Section, Stat } from "./leash/kit";

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
const actionLabel = (a: string) => a.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** F1: every onchain post-quantum (ETHFALCON) signature verification, with measured verify gas. */
export function PqLedger() {
  const { data, error } = usePoll<Ledger>("/api/facilitator/pq-ledger", 10000);
  if (error) return <Section title="Couldn't load the ledger" description={error} />;
  if (!data) return <Skeleton className="h-64 rounded-2xl" />;
  const s = data.summary;
  return (
    <div className="space-y-3">
      <Section icon={<Atom className="size-5" />} title="Post-quantum, verified onchain" description="Each transaction below carried a Falcon-512 signature that the vault checked inside the EVM. Payments themselves don't need one.">
        <div className="grid grid-cols-3 gap-2">
          <Stat value={s.pqVerifiedTxs} label="PQ-checked txs" />
          <Stat value={fmt(s.avgPqVerifyGas)} label="gas per check" />
          <Stat value={s.paymentsSettled} label="payments, no PQ cost" />
        </div>
        <div className="well p-3.5 text-[0.82rem] leading-relaxed">
          Signing each of the {s.paymentsSettled} payments post-quantum would cost <span className="num font-semibold">{fmt(s.ifEveryPaymentWerePqVerified.extraGas)} gas</span>. Leash needed{" "}
          <span className="font-semibold">{s.leashActual.pqTxs}</span> checks ({fmt(s.leashActual.pqGas)} gas).
        </div>
      </Section>
      <Section title="Ledger">
        {data.entries
          .slice()
          .reverse()
          .map((e) => (
            <a key={e.tx} href={explorerTx(e.tx)} target="_blank" rel="noreferrer" className="well block space-y-2 p-3.5 hover:bg-accent">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[0.88rem] font-medium">{e.kind === "createVault" ? "Vault created" : actionLabel(e.action)}</span>
                  {e.loosening === true && <Pill tone="warn">World-gated</Pill>}
                  {e.loosening === false && <Pill>Tightening</Pill>}
                </div>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
              </div>
              <Meter value={Math.round(e.pqShare * 100)} max={100} />
              <div className="num text-[0.72rem] text-muted-foreground">
                Falcon check {fmt(Number(e.pqVerifyGas))} of {fmt(Number(e.gasUsed))} gas ({Math.round(e.pqShare * 100)}%) · {new Date(e.timestamp * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
              </div>
            </a>
          ))}
      </Section>
    </div>
  );
}
