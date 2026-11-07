"use client";
/** Plays the vault-creation loader through its stages (sign → deploy → ready) without creating a vault. */
import { useEffect, useState } from "react";
import { VaultLoader } from "@/components/onboard/VaultLoader";

export default function LoaderPreview() {
  const [stage, setStage] = useState<"sign" | "deploy" | "done" | null>(null);
  const run = () => {
    setStage("sign");
    setTimeout(() => setStage("deploy"), 3500);
    setTimeout(() => setStage("done"), 8500);
  };
  useEffect(() => {
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="grid min-h-dvh place-items-center bg-white p-6 text-center">
      <div className="space-y-3">
        <h1 className="text-[32px] font-bold tracking-[-0.04em]">Create your vault</h1>
        <p className="mx-auto max-w-[300px] text-[15px] text-body">We pay the network fee. Your agent never holds gas or a seed phrase.</p>
        <button type="button" className="h-[52px] rounded-[18px] bg-red px-7 text-[16px] font-semibold text-white" onClick={run}>
          Play again
        </button>
      </div>
      <VaultLoader stage={stage} chips={[{ dot: "#a16b08", label: "5 USDT · 24 h" }, { dot: "#096c37", label: "World ID" }, { dot: "#0643d2", label: "0xda31…f9f2", mono: true }]} onGo={() => setStage(null)} />
    </div>
  );
}
