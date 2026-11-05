"use client";
import { useEffect, useMemo, useState } from "react";
import { api, short, usePoll } from "@/lib/client/api";
import { localhostSigner, type OwnerSigner } from "@/lib/client/signer";
import { wasmSigner } from "@/lib/client/wasm-signer";
import { Onboard } from "@/components/Onboard";
import { Mandate } from "@/components/Mandate";
import { Approvals } from "@/components/Approvals";
import { Activity } from "@/components/Activity";
import { Stats } from "@/components/Stats";

type Config = { chainId: number; factory: string; verifier: string; worldMode: "world" | "mock"; signerUrl: string; explorer: string };
const TABS = ["Onboard", "Mandate", "Approvals", "Activity", "Stats"] as const;
type Tab = (typeof TABS)[number];

export default function Home() {
  const [cfg, setCfg] = useState<Config>();
  const [tab, setTab] = useState<Tab>("Onboard");
  const [vault, setVaultState] = useState<string | null>(null);
  const [signer, setSigner] = useState<OwnerSigner | null>(null);
  const [signerError, setSignerError] = useState<string>();
  const [signerKind, setSignerKind] = useState<"wasm" | "localhost">("localhost");

  useEffect(() => {
    api<Config>("/api/config").then(setCfg);
    try {
      const v = localStorage.getItem("leash.vault");
      if (v) (setVaultState(v), setTab("Approvals"));
      const k = localStorage.getItem("leash.signer");
      if (k === "wasm" || k === "localhost") setSignerKind(k);
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    if (!cfg) return;
    const s = signerKind === "wasm" ? wasmSigner() : localhostSigner(cfg.signerUrl);
    s.pubKey()
      .then(() => (setSigner(s), setSignerError(undefined)))
      .catch((e) => (setSigner(null), setSignerError(e instanceof Error ? e.message : String(e))));
  }, [cfg, signerKind]);

  const setVault = (v: string | null) => {
    setVaultState(v);
    try {
      if (v) localStorage.setItem("leash.vault", v);
      else localStorage.removeItem("leash.vault");
    } catch {
      /* ignore */
    }
    if (v) setTab("Mandate");
  };
  const chooseSigner = (k: "wasm" | "localhost") => {
    setSignerKind(k);
    try {
      localStorage.setItem("leash.signer", k);
    } catch {
      /* ignore */
    }
  };

  const pending = usePoll<{ status: string }[]>(vault ? `/api/approvals?vault=${vault}` : null, 3000).data?.filter((a) => a.status === "PENDING").length ?? 0;
  const body = useMemo(() => {
    if (!cfg) return <div className="card muted">Loading…</div>;
    if (tab === "Onboard") return <Onboard chainId={cfg.chainId} factory={cfg.factory} signer={signer} signerError={signerError} vault={vault} setVault={setVault} />;
    if (tab === "Stats") return <Stats />;
    if (!vault) return <div className="card text-sm">Create or select a vault in Onboard first.</div>;
    if (tab === "Mandate") return <Mandate vault={vault} chainId={cfg.chainId} signer={signer} />;
    if (tab === "Approvals") return <Approvals vault={vault} chainId={cfg.chainId} signer={signer} />;
    return <Activity vault={vault} />;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, tab, signer, signerError, vault]);

  return (
    <main className="mx-auto max-w-xl px-4 pb-28 pt-4 space-y-4">
      <header className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xl font-extrabold tracking-tight">Leash</div>
          <div className="text-xs muted">your agents&apos; spending mandate</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {vault && <span className="pill mono">{short(vault)}</span>}
          <div className="flex gap-1">
            <span className="pill">Whitechain {cfg?.chainId}</span>
            {cfg && <span className="pill" style={{ color: cfg.worldMode === "mock" ? "var(--color-warn)" : "var(--color-ok)" }}>World {cfg.worldMode === "mock" ? "MOCKED" : "IdP"}</span>}
          </div>
          <select className="text-xs bg-transparent" value={signerKind} onChange={(e) => chooseSigner(e.target.value as "wasm" | "localhost")}>
            <option value="localhost">Falcon key: local signer</option>
            <option value="wasm">Falcon key: in-browser (WASM)</option>
          </select>
        </div>
      </header>
      {body}
      <nav className="fixed bottom-0 inset-x-0 border-t line" style={{ background: "var(--card)" }}>
        <div className="mx-auto max-w-xl grid grid-cols-5">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`py-3 text-xs font-semibold ${tab === t ? "text-[var(--color-brand)]" : "muted"}`}>
              {t}
              {t === "Approvals" && pending > 0 && <span className="ml-1 rounded-full bg-[var(--color-bad)] text-white px-1.5">{pending}</span>}
            </button>
          ))}
        </div>
      </nav>
    </main>
  );
}
