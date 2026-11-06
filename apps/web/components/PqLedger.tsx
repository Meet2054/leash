"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, Atom, BarChart3, Layers, ShieldCheck } from "lucide-react";
import { explorerTx, short, usePoll } from "@/lib/client/api";
import { wasmSigner } from "@/lib/client/wasm-signer";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill } from "./leash/kit";
import { BarRow, CardHead, DarkStat } from "./Stats";

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

// Falcon-512 reference sizes (NIST round-3 spec) and the baselines the design compares against
const ECDSA_SIG = 65;
const FALCON_SIG = 666;
const MLDSA44_SIG = 2420;

/** Owner key (vault's onchain key hash) + whether the in-browser key is passkey-protected. */
function useOwnerKey() {
  const [vault, setVault] = useState<string | null>(null);
  const [prot, setProt] = useState<"none" | "passkey" | null>(null);
  useEffect(() => {
    try {
      setVault(localStorage.getItem("leash.vault"));
    } catch {
      /* storage unavailable */
    }
    wasmSigner()
      .protection()
      .then(setProt)
      .catch(() => setProt(null));
  }, []);
  const v = usePoll<{ pqPubKeyHash?: string }>(vault ? `/api/vault/${vault}` : null, 30000).data;
  return { hash: v?.pqPubKeyHash && !/^0x0*$/.test(v.pqPubKeyHash) ? v.pqPubKeyHash : null, prot };
}

const HOW = [
  { n: 1, title: "Your owner key signs limits", body: "Set once, and again only when you change them.", bg: "bg-blue-bg", num: "bg-blue" },
  { n: 2, title: "Your agent signs running totals", body: "Off-chain, inside a channel that can never exceed what was reserved.", bg: "bg-amber-bg", num: "bg-amber" },
  { n: 3, title: "One settlement per channel", body: "Hundreds of requests land as a single transaction.", bg: "bg-green-bg", num: "bg-green" },
];

/** F1: the post-quantum view. Owner key facts, signature sizes, how Leash keeps it small, and the live ledger of every onchain ETHFALCON verification. */
export function PqLedger() {
  const { data, error } = usePoll<Ledger>("/api/facilitator/pq-ledger", 10000);
  const key = useOwnerKey();
  return (
    <div className="space-y-3.5">
      {/* Owner key: dark card */}
      <div className="dark-card space-y-3.5 p-6">
        <div className="flex gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-full bg-[#333333] text-white">
            <Atom className="size-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="text-[16px] font-semibold leading-[22px] tracking-[-0.01em]">Your owner key is post-quantum</div>
            <div className="text-[14px] leading-5 text-white/70">Falcon-512, a NIST-selected signature scheme. Built to stay safe against future quantum computers.</div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-[14px] bg-[#2e2e2e] px-3.5 py-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] leading-[18px] text-white">{key.hash ? short(key.hash) : "—"}</span>
          {key.prot === "passkey" ? <Pill tone="ok">Protected</Pill> : key.prot === "none" ? <Pill>In this browser</Pill> : null}
        </div>
        <div className="flex gap-2.5">
          <DarkStat value="897 B" label="public key" />
          <DarkStat value={`~${FALCON_SIG} B`} label="signature" />
          <DarkStat value="Level 1" label="NIST security" />
        </div>
      </div>

      {/* Signature size per payment */}
      <div className="surface space-y-3.5 p-5">
        <CardHead icon={BarChart3} title="Signature size per payment" description="Post-quantum signatures are big. Signing every payment on-chain would be costly." />
        <div className="space-y-3">
          <BarRow label="ECDSA (today's wallets)" value={`${ECDSA_SIG} B`} share={ECDSA_SIG / MLDSA44_SIG} />
          <BarRow label="Falcon-512 (Leash owner key)" value={`~${FALCON_SIG} B`} share={FALCON_SIG / MLDSA44_SIG} strong />
          <BarRow label="ML-DSA-44" value={`${MLDSA44_SIG.toLocaleString()} B`} share={1} />
        </div>
      </div>

      {/* How */}
      <div className="surface space-y-3 p-5">
        <CardHead icon={Layers} title="How Leash keeps it small" description="Only the rare decisions carry a post-quantum signature." />
        {HOW.map((h) => (
          <div key={h.n} className={`flex gap-3 rounded-[16px] p-3.5 ${h.bg}`}>
            <div className={`grid size-[26px] shrink-0 place-items-center rounded-full text-[12px] text-white ${h.num}`}>{h.n}</div>
            <div className="min-w-0 space-y-[3px]">
              <div className="text-[16px] font-semibold leading-[22px] tracking-[-0.01em] text-ink">{h.title}</div>
              <div className="text-[13px] leading-[18px] text-body">{h.body}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Live ledger: every onchain Falcon verification */}
      {error ? (
        <div className="surface p-5 text-[14px] text-body">Couldn&apos;t load the ledger: {error}</div>
      ) : !data ? (
        <Skeleton className="h-48 rounded-[22px]" />
      ) : (
        <div className="surface space-y-3.5 p-5">
          <CardHead icon={ShieldCheck} title="Verified onchain" description="Each transaction below carried a Falcon-512 signature that the vault checked inside the EVM. Payments themselves don't need one." />
          <div className="flex gap-2.5">
            {[
              [data.summary.pqVerifiedTxs, "PQ-checked txs"],
              [fmt(data.summary.avgPqVerifyGas), "gas per check"],
              [data.summary.paymentsSettled, "payments, no PQ cost"],
            ].map(([v, l]) => (
              <div key={l as string} className="min-w-0 flex-1 space-y-[3px] rounded-[16px] bg-surface p-3.5">
                <div className="num text-[20px] font-semibold leading-[26px] tracking-[-0.015em] text-ink">{v}</div>
                <div className="text-[12px] leading-4 text-body">{l}</div>
              </div>
            ))}
          </div>
          <p className="text-[13px] leading-[18px] text-ink">
            Signing each of the {data.summary.paymentsSettled} payments post-quantum would cost <b className="font-semibold">{fmt(data.summary.ifEveryPaymentWerePqVerified.extraGas)} gas</b>. Leash needed <b className="font-semibold">{data.summary.leashActual.pqTxs}</b> checks ({fmt(data.summary.leashActual.pqGas)} gas).
          </p>
          <div className="space-y-2">
            {data.entries
              .slice()
              .reverse()
              .map((e) => (
                <a key={e.tx} href={explorerTx(e.tx)} target="_blank" rel="noreferrer" className="block space-y-2 rounded-[16px] bg-blue-bg px-4 py-3.5 transition-colors hover:bg-accent">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{e.kind === "createVault" ? "Vault created" : actionLabel(e.action)}</span>
                      {e.loosening === true && <Pill tone="warn">World-gated</Pill>}
                      {e.loosening === false && <Pill>Tightening</Pill>}
                    </div>
                    <ArrowUpRight className="size-[18px] shrink-0 text-blue" />
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white">
                    <div className="h-full min-w-2 rounded-full bg-blue" style={{ width: `${Math.round(e.pqShare * 100)}%` }} />
                  </div>
                  <div className="num text-[12px] leading-4 text-body">
                    Falcon check {fmt(Number(e.pqVerifyGas))} of {fmt(Number(e.gasUsed))} gas ({Math.round(e.pqShare * 100)}%) · {new Date(e.timestamp * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                  </div>
                </a>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
